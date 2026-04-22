import { useEffect, useMemo, useState } from "react";
import { Bell, AlertTriangle, TrendingUp, Package, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchNotificationLogsApi, type NotificationLog } from "@/lib/api";
import { parseBusinessDate } from "@/lib/reporting";

const NOTIFICATION_READ_IDS = "sp_notification_read_ids";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: "low_stock" | "sales_summary" | "audit" | "info";
  time: string;
  timestamp: string;
  read: boolean;
}

function loadReadIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFICATION_READ_IDS) || "[]");
  } catch {
    return [];
  }
}

function persistReadIds(ids: string[]) {
  localStorage.setItem(NOTIFICATION_READ_IDS, JSON.stringify(ids));
}

function formatRelativeTime(timestamp: string) {
  const date = new Date(timestamp);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.max(Math.floor(diffMs / 60000), 0);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} mins`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"}`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function groupLabel(timestamp: string) {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfItemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - startOfItemDay.getTime()) / 86400000);

  if (diffDays <= 0) return "Today";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function NotificationCenter() {
  const { products, sales, profile, activities } = useStore();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [history, setHistory] = useState<AppNotification[]>([]);
  const [readIds, setReadIds] = useState<string[]>(() => loadReadIds());
  const [open, setOpen] = useState(false);
  const sym = profile.currencySymbol || "R";

  useEffect(() => {
    fetchNotificationLogsApi()
      .then((logs) => {
        const mapped = logs.map((log: NotificationLog) => ({
          id: `server-${log.id}`,
          title: log.type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
          message: log.message,
          type: /stock/i.test(log.type) ? "low_stock" : /audit|discrepancy/i.test(log.type) ? "audit" : /sale|summary/i.test(log.type) ? "sales_summary" : ("info" as AppNotification["type"]),
          time: formatRelativeTime(log.sent_at),
          timestamp: log.sent_at,
          read: readIds.includes(`server-${log.id}`),
        }));
        setHistory(mapped);
      })
      .catch(() => setHistory([]));
  }, [readIds]);

  const isTodaySale = (dateValue: string) => {
    const parsed = parseBusinessDate(dateValue);
    return !!parsed && parsed.toDateString() === new Date().toDateString();
  };

  useEffect(() => {
    const nowIso = new Date().toISOString();
    const notifs: AppNotification[] = [];

    if (profile.lowStockAlerts) {
      const lowStock = products.filter((p) => p.status === "low" || p.status === "out");
      lowStock.forEach((p) => {
        notifs.push({
          id: `low-${p.id}`,
          title: p.status === "out" ? "Out of Stock" : "Low Stock Alert",
          message: `${p.name} has ${p.stock} units remaining (reorder level: ${p.reorder})`,
          type: "low_stock",
          time: "Just now",
          timestamp: nowIso,
          read: readIds.includes(`low-${p.id}`),
        });
      });
    }

    const todaySales = sales.filter((sale) => isTodaySale(sale.date));
    const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
    if (todaySales.length > 0) {
      notifs.push({
        id: "daily-summary",
        title: "Daily Sales Summary",
        message: `Today's total: ${sym}${todayTotal.toLocaleString()} from ${todaySales.length} transactions`,
        type: "sales_summary",
        time: "Just now",
        timestamp: nowIso,
        read: readIds.includes("daily-summary"),
      });
    }

    if (profile.discrepancyAlerts) {
      activities
        .filter((a) => a.type === "alert" && /audit|discrepancy/i.test(a.text))
        .slice(0, 20)
        .forEach((a) => {
          notifs.push({
            id: `activity-${a.id}`,
            title: /resolved/i.test(a.text) ? "Issue Resolved" : "Audit Update",
            message: a.text,
            type: "audit",
            time: a.time,
            timestamp: nowIso,
            read: readIds.includes(`activity-${a.id}`),
          });
        });
    }

    const merged = [...history, ...notifs]
      .filter((notification, index, array) => array.findIndex((item) => item.id === notification.id) === index)
      .map((notification) => ({
        ...notification,
        time: formatRelativeTime(notification.timestamp),
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    setNotifications(merged);
  }, [products, sales, activities, profile.lowStockAlerts, profile.discrepancyAlerts, sym, readIds, history]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const groupedNotifications = useMemo(() => {
    const groups = new Map<string, AppNotification[]>();
    notifications.forEach((notification) => {
      const label = groupLabel(notification.timestamp);
      groups.set(label, [...(groups.get(label) || []), notification]);
    });
    return Array.from(groups.entries());
  }, [notifications]);

  const markAllRead = () => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      const ids = updated.map((n) => n.id);
      setReadIds(ids);
      persistReadIds(ids);
      return updated;
    });
  };

  const markRead = (id: string) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => n.id === id ? { ...n, read: true } : n);
      const ids = updated.filter((n) => n.read).map((n) => n.id);
      setReadIds(ids);
      persistReadIds(ids);
      return updated;
    });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "low_stock":
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case "sales_summary":
        return <TrendingUp className="h-4 w-4 text-success" />;
      case "audit":
        return <ClipboardCheck className="h-4 w-4 text-primary" />;
      default:
        return <Package className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="relative rounded-lg p-2 transition-colors hover:bg-muted">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="font-display">Notifications</DialogTitle>
                <DialogDescription>Recent alerts and saved notification history.</DialogDescription>
              </div>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs">
                  Mark all read
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="max-h-[400px] space-y-4 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              groupedNotifications.map(([label, items]) => (
                <div key={label} className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
                  {items.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={`flex w-full cursor-pointer gap-3 rounded-lg p-3 text-left transition-colors ${
                        n.read ? "bg-muted/30" : "border border-primary/10 bg-primary/5 hover:bg-primary/10"
                      }`}
                    >
                      <div className="mt-0.5">{getIcon(n.type)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{n.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{n.message}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{n.time}</p>
                      </div>
                      {!n.read && <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

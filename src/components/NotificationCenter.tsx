import { useState, useEffect } from "react";
import { Bell, AlertTriangle, TrendingUp, Package, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchNotificationLogsApi, type NotificationLog } from "@/lib/api";
import { parseBusinessDate } from "@/lib/reporting";

const NOTIFICATION_READ_IDS = "sp_notification_read_ids";

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: "low_stock" | "sales_summary" | "audit" | "info";
  time: string;
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
          type: /stock/i.test(log.type) ? "low_stock" : /audit|discrepancy/i.test(log.type) ? "audit" : /sale|summary/i.test(log.type) ? "sales_summary" : "info" as AppNotification["type"],
          time: new Date(log.sent_at).toLocaleString(),
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
    const notifs: AppNotification[] = [];

    if (profile.lowStockAlerts) {
      const lowStock = products.filter(p => p.status === "low" || p.status === "out");
      lowStock.forEach(p => {
        notifs.push({
          id: `low-${p.id}`,
          title: p.status === "out" ? "Out of Stock" : "Low Stock Alert",
          message: `${p.name} has ${p.stock} units remaining (reorder level: ${p.reorder})`,
          type: "low_stock",
          time: "Just now",
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
        time: "Updated",
        read: readIds.includes("daily-summary"),
      });
    }

    if (profile.discrepancyAlerts) {
      activities
        .filter((a) => a.type === "alert" && /audit|discrepancy/i.test(a.text))
        .slice(0, 5)
        .forEach((a) => {
          notifs.push({
            id: `activity-${a.id}`,
            title: /resolved/i.test(a.text) ? "Issue Resolved" : "Audit Update",
            message: a.text,
            type: "audit",
            time: a.time,
            read: readIds.includes(`activity-${a.id}`),
          });
        });
    }
    const merged = [...history, ...notifs].filter(
      (notification, index, array) => array.findIndex((item) => item.id === notification.id) === index
    );
    setNotifications(merged);
  }, [products, sales, activities, profile.lowStockAlerts, profile.discrepancyAlerts, sym, readIds, history]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, read: true }));
      const ids = updated.map(n => n.id);
      setReadIds(ids);
      persistReadIds(ids);
      return updated;
    });
  };

  const markRead = (id: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, read: true } : n);
      const ids = updated.filter(n => n.read).map(n => n.id);
      setReadIds(ids);
      persistReadIds(ids);
      return updated;
    });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "low_stock": return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case "sales_summary": return <TrendingUp className="h-4 w-4 text-success" />;
      case "audit": return <ClipboardCheck className="h-4 w-4 text-primary" />;
      default: return <Package className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="relative p-2 rounded-lg hover:bg-muted transition-colors">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="font-display">Notifications</DialogTitle>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs">
                  Mark all read
                </Button>
              )}
            </div>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No notifications</p>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={`w-full text-left flex gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
                    n.read ? "bg-muted/30" : "bg-primary/5 border border-primary/10 hover:bg-primary/10"
                  }`}
                >
                  <div className="mt-0.5">{getIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{n.time}</p>
                  </div>
                  {!n.read && <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

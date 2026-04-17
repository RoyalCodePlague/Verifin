import { useMemo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, Package, ShoppingCart, AlertTriangle,
  Receipt, ScanBarcode, ClipboardCheck, Plus, MessageSquare, Share2, HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart } from "recharts";
import { AdminAssistant } from "@/components/dashboard/AdminAssistant";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { pushOfflineActions } from "@/lib/api";
import { clearOfflineQueue, getOfflineQueue, hadOfflineSession, setupOfflineSync } from "@/lib/offlineQueue";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const Dashboard = () => {
  const { products, sales, expenses, discrepancies, activities, profile, generateWhatsAppSummary } = useStore();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const sym = profile.currencySymbol || "R";
  const [syncing, setSyncing] = useState(false);

  const todaySales = sales.filter(s => s.date === "Today");
  const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  
  // Calculate percentage change in sales
  const yesterdayTotal = sales.filter(s => s.date !== "Today").slice(0, 10).reduce((sum, s) => sum + s.total, 0);
  const salesChange = yesterdayTotal > 0 ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100) : 0;
  
  const inventoryValue = products.reduce((sum, p) => sum + p.stock * p.price, 0);
  const lowStockCount = products.filter(p => p.status === "low" || p.status === "out").length;
  const todayExpenses = expenses.filter(e => e.date === "Today").reduce((sum, e) => sum + e.amount, 0);

  const displayName = profile.name || "there";

  // Calculate percentage change in expenses
  const yesterdayExpenses = expenses.filter(e => e.date !== "Today").slice(0, 10).reduce((sum, e) => sum + e.amount, 0);
  const expensesChange = yesterdayExpenses > 0 ? Math.round(((todayExpenses - yesterdayExpenses) / yesterdayExpenses) * 100) : 0;

  const syncOfflineActions = async () => {
    const queue = getOfflineQueue();
    if (queue.length === 0) {
      return true;
    }

    setSyncing(true);
    try {
      const result = await pushOfflineActions(queue);
      toast.success(`Synced ${result.processed} offline actions when back online`);
      await refreshUser();
      return true;
    } catch (error) {
      console.warn("Offline sync failed", error);
      toast.error("Offline sync failed. Your queued changes will retry when online.");
      return false;
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const maybeSync = async () => {
      if (!navigator.onLine) return;
      if (!hadOfflineSession()) return;
      const queue = getOfflineQueue();
      if (queue.length === 0) {
        clearOfflineQueue();
        return;
      }
      await syncOfflineActions();
    };

    const cleanup = setupOfflineSync(async (actions) => {
      if (actions.length === 0) return true;
      try {
        const result = await pushOfflineActions(actions);
        toast.success(`Synced ${result.processed} offline actions`);
        await refreshUser();
        return true;
      } catch (error) {
        console.warn("Offline sync failed", error);
        toast.error("Failed to sync queued edits. We will retry automatically.");
        return false;
      }
    });

    void maybeSync();
    return cleanup;
  }, [refreshUser]);

  const salesData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    
    // Group sales by day of week
    const dayTotals: Record<string, number> = {
      Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0
    };
    
    sales.forEach(s => {
      try {
        const rawDate = s.date === "Today" ? new Date().toISOString() : (s.date.includes("T") ? s.date : `${s.date}T12:00:00`);
        const d = new Date(rawDate);
        const dayIndex = (d.getDay() + 6) % 7; // Convert to Monday=0
        const dayName = days[dayIndex];
        dayTotals[dayName] += s.total;
      } catch {
        // If date parsing fails, skip
      }
    });
    
    // If no data, show zero values
    if (Object.values(dayTotals).every(v => v === 0)) {
      return days.map((day) => ({ day, sales: 0 }));
    }
    
    return days.map((day) => ({ day, sales: dayTotals[day] || 0 }));
  }, [sales]);

  const weeklySalesTotal = useMemo(() => salesData.reduce((sum, item) => sum + item.sales, 0), [salesData]);

  const salesVsExpensesData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    
    // Group sales and expenses by day of week
    const dayTotals: Record<string, { sales: number; expenses: number }> = {
      Mon: { sales: 0, expenses: 0 },
      Tue: { sales: 0, expenses: 0 },
      Wed: { sales: 0, expenses: 0 },
      Thu: { sales: 0, expenses: 0 },
      Fri: { sales: 0, expenses: 0 },
      Sat: { sales: 0, expenses: 0 },
      Sun: { sales: 0, expenses: 0 },
    };
    
    // Add sales data
    sales.forEach(s => {
      try {
        const rawDate = s.date === "Today" ? new Date().toISOString() : (s.date.includes("T") ? s.date : `${s.date}T12:00:00`);
        const d = new Date(rawDate);
        const dayIndex = (d.getDay() + 6) % 7; // Convert to Monday=0
        const dayName = days[dayIndex];
        dayTotals[dayName].sales += s.total;
      } catch {
        // Skip if date parsing fails
      }
    });
    
    // Add expenses data
    expenses.forEach(e => {
      try {
        const d = new Date(e.date.includes("T") ? e.date : `${e.date}T12:00:00`);
        const dayIndex = (d.getDay() + 6) % 7; // Convert to Monday=0
        const dayName = days[dayIndex];
        dayTotals[dayName].expenses += e.amount;
      } catch {
        // Skip if date parsing fails
      }
    });
    
    return days.map((day) => ({ 
      day, 
      sales: dayTotals[day].sales || 0,
      expenses: dayTotals[day].expenses || 0
    }));
  }, [sales, expenses]);

  const metrics = [
    { label: "Today's Sales", value: `${sym}${todayTotal.toLocaleString()}`, change: `${salesChange > 0 ? '+' : ''}${salesChange}%`, up: salesChange >= 0, icon: ShoppingCart },
    { label: "This Week", value: `${sym}${weeklySalesTotal.toLocaleString()}`, change: `${weeklySalesTotal >= todayTotal ? 'Up' : 'Down'}`, up: weeklySalesTotal >= todayTotal, icon: TrendingUp },
    { label: "Inventory Value", value: `${sym}${inventoryValue.toLocaleString()}`, change: `${lowStockCount} low`, up: lowStockCount === 0, icon: Package },
    { label: "Low Stock Items", value: String(lowStockCount), change: `${lowStockCount}`, up: false, icon: AlertTriangle },
    { label: "Today's Expenses", value: `${sym}${todayExpenses.toLocaleString()}`, change: `${expensesChange > 0 ? '+' : ''}${expensesChange}%`, up: expensesChange <= 0, icon: Receipt },
  ];

  const topProduct = useMemo(() => {
    const salesCount: Record<string, number> = {};
    sales.forEach((sale) => {
      sale.items.split(",").forEach((item) => {
        const trimmed = item.trim();
        if (!trimmed) return;
        const parsed = trimmed.match(/^(\d+)\s*(.+)$/);
        const qty = parsed ? Number(parsed[1]) : 1;
        const name = parsed ? parsed[2].trim() : trimmed;
        if (!name) return;
        salesCount[name] = (salesCount[name] || 0) + qty;
      });
    });
    return Object.entries(salesCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [sales]);

  const expenseAlert = todayExpenses > todayTotal * 0.5 ? `Expenses are running high today at ${sym}${todayExpenses.toLocaleString()}` : null;

  const quickActions = [
    { label: "Record Sale", icon: ShoppingCart, color: "bg-primary/10 text-primary", to: "/sales" },
    { label: "Add Expense", icon: Receipt, color: "bg-accent/10 text-accent", to: "/expenses" },
    { label: "Restock", icon: Plus, color: "bg-success/10 text-success", to: "/inventory" },
    { label: "Scan Product", icon: ScanBarcode, color: "bg-primary/10 text-primary", to: "/inventory" },
    { label: "Run Audit", icon: ClipboardCheck, color: "bg-warning/10 text-warning", to: "/audits" },
    { label: "Help", icon: HelpCircle, color: "bg-muted text-muted-foreground", to: "/help-dashboard" },
  ];

  const insights = [
    ...(lowStockCount > 0 ? [{ text: `You are running low on ${lowStockCount} key items`, type: "alert" }] : []),
    ...(topProduct ? [{ text: `Top selling product this week: ${topProduct}`, type: "insight" }] : []),
    { text: salesChange >= 0 ? `Sales are ${salesChange}% above the previous period` : `Sales are ${Math.abs(salesChange)}% below the previous period`, type: salesChange >= 0 ? "insight" : "warning" },
    ...(expenseAlert ? [{ text: expenseAlert, type: "alert" }] : []),
    ...(discrepancies.filter(d => d.status !== "resolved").length > 0 ? [{ text: `${discrepancies.filter(d => d.status !== "resolved").length} stock discrepancies still need attention`, type: "warning" }] : []),
  ];

  const handleWhatsAppShare = () => {
    const summary = generateWhatsAppSummary();
    const url = `https://wa.me/?text=${encodeURIComponent(summary)}`;
    window.open(url, "_blank");
    toast.success("Opening WhatsApp with daily summary!");
  };


  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground mb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            Currency: {profile.currency}
          </div>
          <h2 className="text-xl font-display font-bold">Welcome back, {displayName}!</h2>
          <p className="text-sm text-muted-foreground">Here's what's happening with your business today.</p>
          {syncing && <p className="text-xs text-success mt-1">Syncing offline changes. Changes queued while offline are being pushed now.</p>}
        </div>
        <Button variant="outline" size="sm" onClick={handleWhatsAppShare} className="hidden sm:flex gap-2">
          <Share2 className="h-4 w-4" /> Share via WhatsApp
        </Button>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, i) => (
          <motion.div key={m.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="shadow-soft">
              <CardContent className="p-4 lg:p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <m.icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className={`text-xs font-medium flex items-center gap-0.5 ${m.up ? "text-success" : "text-destructive"}`}>
                    {m.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {m.change}
                  </span>
                </div>
                <p className="text-2xl font-display font-bold">{m.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{m.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="shadow-soft">
        <CardContent className="p-4 lg:p-5">
          <p className="text-sm font-medium text-muted-foreground mb-3">Quick Actions</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {quickActions.map((a) => (
              <button key={a.label} onClick={() => a.to === "/help-dashboard" ? navigate("/help") : navigate(a.to)} className="flex flex-col items-center gap-2 min-w-[80px] p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
                <div className={`h-10 w-10 rounded-xl ${a.color} flex items-center justify-center`}>
                  <a.icon className="h-4.5 w-4.5" />
                </div>
                <span className="text-xs font-medium whitespace-nowrap">{a.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Sales This Week</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={salesData}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(152 55% 28%)" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="hsl(152 55% 28%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip />
                <Area type="monotone" dataKey="sales" stroke="hsl(152 55% 28%)" fill="url(#salesGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-accent" /> Smart Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-3">
            {insights.map((ins, i) => (
              <div key={i} className={`p-3 rounded-lg text-sm ${
                ins.type === "warning" ? "bg-warning/10 text-warning"
                  : ins.type === "alert" ? "bg-destructive/10 text-destructive"
                  : "bg-primary/10 text-primary"
              }`}>
                {ins.text}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-soft">
        <CardHeader className="pb-2"><CardTitle className="text-base font-display">Sales vs Expenses (Weekly)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={salesVsExpensesData}>
              <defs>
                <linearGradient id="salesGrad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(152 55% 28%)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(152 55% 28%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip 
                formatter={(value) => `${sym}${Number(value).toLocaleString()}`}
              />
              <Legend />
              <Bar dataKey="sales" fill="hsl(152 55% 28%)" name="Sales" />
              <Bar dataKey="expenses" fill="hsl(0 84% 60%)" name="Expenses" />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="shadow-soft">
        <CardHeader className="pb-2"><CardTitle className="text-base font-display">Live Activity</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-3">
            {activities.slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  a.type === "sale" ? "bg-success" : a.type === "restock" ? "bg-primary" : a.type === "alert" ? "bg-destructive" : "bg-accent"
                }`} />
                <span className="flex-1">{a.text}</span>
                <span className="text-muted-foreground text-xs whitespace-nowrap">{a.time}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;

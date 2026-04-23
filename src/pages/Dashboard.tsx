import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, Package, ShoppingCart, AlertTriangle,
  Receipt, ScanBarcode, ClipboardCheck, Plus, MessageSquare, Share2, HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useStore } from "@/lib/store";
import { buildWeeklyFinanceData, expenseBaseAmount, formatMoney, parseBusinessDate, supplyInvoiceAmountBase } from "@/lib/reporting";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { fetchRuleInsightsApi, fetchWhatsAppSummaryApi } from "@/lib/api";
import { useFeatureAccess, useUpgradePrompt, LockedBadge } from "@/lib/features";
import { useQuery } from "@tanstack/react-query";
import { symbolForCurrency } from "@/lib/currency";

const Dashboard = () => {
  const { products, sales, expenses, discrepancies, activities, profile, generateWhatsAppSummary, supplyEntries } = useStore();
  const navigate = useNavigate();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const ruleInsights = useQuery({
    queryKey: ["rule-insights"],
    queryFn: fetchRuleInsightsApi,
    enabled: canUse("rule_insights"),
  });
  const sym = profile.currencySymbol || "R";
  const secondaryCurrency = profile.enabledCurrencies?.find((code) => code !== profile.currency) || "";
  const secondaryRate = secondaryCurrency ? profile.exchangeRates?.[secondaryCurrency] || 0 : 0;

  const isSameCalendarDay = (value: string, reference: Date) => {
    const parsed = parseBusinessDate(value);
    return !!parsed && parsed.toDateString() === reference.toDateString();
  };

  const previousDay = new Date();
  previousDay.setDate(previousDay.getDate() - 1);

  const formatSecondaryMoney = (amountBase: number) => {
    if (!secondaryCurrency || !secondaryRate) return null;
    const converted = amountBase / secondaryRate;
    return `${symbolForCurrency(secondaryCurrency)}${converted.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const todaySales = sales.filter((sale) => isSameCalendarDay(sale.date, new Date()));
  const todayTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  const todaySupplyEntries = supplyEntries.filter((entry) => isSameCalendarDay(entry.movementDate, new Date()));
  const todayPaidSupply = todaySupplyEntries
    .filter((entry) => entry.direction === "outgoing" && entry.paymentStatus === "paid")
    .reduce((sum, entry) => sum + supplyInvoiceAmountBase(entry, profile.currency), 0);
  const openSupplyInvoiceValue = supplyEntries
    .filter((entry) => entry.direction === "outgoing" && entry.paymentStatus !== "paid")
    .reduce((sum, entry) => sum + supplyInvoiceAmountBase(entry, profile.currency), 0);
  const outstandingSupplyCount = supplyEntries.filter((entry) => entry.direction === "outgoing" && entry.paymentStatus !== "paid").length;
  
  const yesterdayTotal = sales
    .filter((sale) => isSameCalendarDay(sale.date, previousDay))
    .reduce((sum, s) => sum + s.total, 0);
  const yesterdayPaidSupply = supplyEntries
    .filter((entry) => isSameCalendarDay(entry.movementDate, previousDay) && entry.direction === "outgoing" && entry.paymentStatus === "paid")
    .reduce((sum, entry) => sum + supplyInvoiceAmountBase(entry, profile.currency), 0);
  const salesChange = yesterdayTotal > 0 ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100) : null;
  const supplyRevenueChange = yesterdayPaidSupply > 0 ? Math.round(((todayPaidSupply - yesterdayPaidSupply) / yesterdayPaidSupply) * 100) : null;
  const paidSupplyRevenue = supplyEntries
    .filter((entry) => entry.direction === "outgoing" && entry.paymentStatus === "paid")
    .map((entry) => ({
      date: entry.movementDate,
      total: supplyInvoiceAmountBase(entry, profile.currency),
    }));
  
  const inventoryValue = products.reduce((sum, p) => sum + p.stock * p.costPrice, 0);
  const lowStockCount = products.filter(p => p.status === "low" || p.status === "out").length;
  const todayExpenses = expenses.filter((expense) => isSameCalendarDay(expense.date, new Date())).reduce((sum, e) => sum + expenseBaseAmount(e), 0);

  const displayName = profile.name || "there";

  // Calculate percentage change in expenses
  const yesterdayExpenses = expenses
    .filter((expense) => isSameCalendarDay(expense.date, previousDay))
    .reduce((sum, e) => sum + expenseBaseAmount(e), 0);
  const expensesChange = yesterdayExpenses > 0 ? Math.round(((todayExpenses - yesterdayExpenses) / yesterdayExpenses) * 100) : null;

  const changeLabel = (value: number | null, currentTotal: number, previousTotal: number) => {
    if (value == null) {
      if (currentTotal > 0 && previousTotal <= 0) return "New";
      return "0%";
    }
    return `${value > 0 ? "+" : ""}${value}%`;
  };

  const changeTrendUp = (value: number | null, currentTotal: number, previousTotal: number) => {
    if (value == null) return currentTotal >= previousTotal;
    return value >= 0;
  };

  const salesData = useMemo(() => {
    return buildWeeklyFinanceData(sales, [], new Date(), paidSupplyRevenue).map(({ day, sales }) => ({ day, sales }));
  }, [paidSupplyRevenue, sales]);

  const weeklySalesTotal = useMemo(() => salesData.reduce((sum, item) => sum + item.sales, 0), [salesData]);

  const salesVsExpensesData = useMemo(
    () => buildWeeklyFinanceData(sales, expenses, new Date(), paidSupplyRevenue),
    [expenses, paidSupplyRevenue, profile.currency, sales]
  );

  const metrics = [
    { label: "Today's Sales", value: formatMoney(todayTotal, sym), secondaryValue: formatSecondaryMoney(todayTotal), change: changeLabel(salesChange, todayTotal, yesterdayTotal), up: changeTrendUp(salesChange, todayTotal, yesterdayTotal), icon: ShoppingCart },
    { label: "Paid Supply Today", value: formatMoney(todayPaidSupply, sym), secondaryValue: formatSecondaryMoney(todayPaidSupply), change: changeLabel(supplyRevenueChange, todayPaidSupply, yesterdayPaidSupply), up: changeTrendUp(supplyRevenueChange, todayPaidSupply, yesterdayPaidSupply), icon: TrendingUp },
    { label: "This Week", value: formatMoney(weeklySalesTotal, sym), secondaryValue: formatSecondaryMoney(weeklySalesTotal), change: `${weeklySalesTotal >= todayTotal ? 'Up' : 'Down'}`, up: weeklySalesTotal >= todayTotal, icon: TrendingUp },
    { label: "Inventory Value", value: formatMoney(inventoryValue, sym), secondaryValue: formatSecondaryMoney(inventoryValue), change: `${lowStockCount} low`, up: lowStockCount === 0, icon: Package },
    { label: "Open Supply Invoices", value: formatMoney(openSupplyInvoiceValue, sym), secondaryValue: outstandingSupplyCount > 0 ? `${outstandingSupplyCount} open` : null, change: outstandingSupplyCount > 0 ? `${outstandingSupplyCount} pending` : "0 pending", up: outstandingSupplyCount === 0, icon: Receipt },
    { label: "Low Stock Items", value: String(lowStockCount), secondaryValue: null, change: `${lowStockCount}`, up: false, icon: AlertTriangle },
    { label: "Today's Expenses", value: formatMoney(todayExpenses, sym), secondaryValue: formatSecondaryMoney(todayExpenses), change: changeLabel(expensesChange, todayExpenses, yesterdayExpenses), up: expensesChange == null ? todayExpenses <= yesterdayExpenses : expensesChange <= 0, icon: Receipt },
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

  const expenseAlert = todayExpenses > todayTotal * 0.5 ? `Expenses are running high today at ${formatMoney(todayExpenses, sym)}` : null;

  const quickActions = [
    { label: "Record Sale", icon: ShoppingCart, color: "bg-primary/10 text-primary", to: "/sales" },
    { label: "Add Expense", icon: Receipt, color: "bg-accent/10 text-accent", to: "/expenses" },
    { label: "Restock", icon: Plus, color: "bg-success/10 text-success", to: "/inventory" },
    { label: "Scan Product", icon: ScanBarcode, color: "bg-primary/10 text-primary", to: "/inventory", feature: "barcode_scanning" },
    { label: "Run Audit", icon: ClipboardCheck, color: "bg-warning/10 text-warning", to: "/audits", feature: "audits" },
    { label: "Help", icon: HelpCircle, color: "bg-muted text-muted-foreground", to: "/help-dashboard" },
  ];

  const insights = [
    ...(lowStockCount > 0 ? [{ text: `You are running low on ${lowStockCount} key items`, type: "alert" }] : []),
    ...(todayPaidSupply > 0 ? [{ text: `Paid supply invoices brought in ${formatMoney(todayPaidSupply, sym)} today`, type: "insight" }] : []),
    ...(outstandingSupplyCount > 0 ? [{ text: `${outstandingSupplyCount} supply invoice${outstandingSupplyCount === 1 ? "" : "s"} still need payment follow-up`, type: "warning" }] : []),
    ...(todaySupplyEntries.length > 0 ? [{ text: `${todaySupplyEntries.length} supplier movement${todaySupplyEntries.length === 1 ? "" : "s"} recorded today`, type: "insight" }] : []),
    ...(topProduct ? [{ text: `Top selling product this week: ${topProduct}`, type: "insight" }] : []),
    { text: salesChange == null ? (todayTotal > 0 ? "Sales started coming in today." : "No sales recorded for today yet.") : salesChange >= 0 ? `Sales are ${salesChange}% above yesterday` : `Sales are ${Math.abs(salesChange)}% below yesterday`, type: salesChange == null ? "insight" : salesChange >= 0 ? "insight" : "warning" },
    ...(expenseAlert ? [{ text: expenseAlert, type: "alert" }] : []),
    ...(discrepancies.filter(d => d.status !== "resolved").length > 0 ? [{ text: `${discrepancies.filter(d => d.status !== "resolved").length} stock discrepancies still need attention`, type: "warning" }] : []),
  ];

  const handleWhatsAppShare = () => {
    if (!canUse("whatsapp_reports")) {
      promptUpgrade("whatsapp_reports", "WhatsApp summaries");
      return;
    }
    fetchWhatsAppSummaryApi()
      .then((summary) => window.open(`https://wa.me/?text=${encodeURIComponent(summary.message)}`, "_blank"))
      .catch(() => window.open(`https://wa.me/?text=${encodeURIComponent(generateWhatsAppSummary())}`, "_blank"));
    toast.success("Opening WhatsApp with daily summary!");
  };


  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground mb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-success" />
            Currency: {profile.currency}{secondaryCurrency ? ` | ${secondaryCurrency}` : ""}
          </div>
          <h2 className="text-xl font-display font-bold">Welcome back, {displayName}!</h2>
          <p className="text-sm text-muted-foreground">Here's what's happening with your business today.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleWhatsAppShare} className="hidden sm:flex gap-2">
          <Share2 className="h-4 w-4" /> Share via WhatsApp
        </Button>
      </motion.div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
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
                <p className="text-lg font-display font-bold leading-tight break-words sm:text-2xl">{m.value}</p>
                {m.secondaryValue ? <p className="mt-1 text-[11px] leading-tight text-muted-foreground break-words">{m.secondaryValue}</p> : null}
                <p className="mt-1 text-xs leading-tight text-muted-foreground">{m.label}</p>
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
              <button key={a.label} onClick={() => {
                if (a.feature && !canUse(a.feature)) {
                  promptUpgrade(a.feature, a.label);
                  return;
                }
                a.to === "/help-dashboard" ? navigate("/help") : navigate(a.to);
              }} className="relative flex flex-col items-center gap-2 min-w-[80px] p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
                {a.feature && !canUse(a.feature) && <span className="absolute right-1 top-1"><LockedBadge label="" /></span>}
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
            {(ruleInsights.data?.insights.map((item) => ({ text: item.message, type: item.severity })) ?? insights).map((ins, i) => (
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
            <BarChart data={salesVsExpensesData} barCategoryGap={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip 
                formatter={(value) => formatMoney(Number(value), sym)}
              />
              <Legend />
              <Bar dataKey="sales" fill="hsl(152 55% 28%)" name="Sales" radius={[4, 4, 0, 0]} minPointSize={3} />
              <Bar dataKey="expenses" fill="hsl(0 84% 60%)" name="Expenses" radius={[4, 4, 0, 0]} minPointSize={3} />
            </BarChart>
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

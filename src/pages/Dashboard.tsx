import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp, TrendingDown, Package, ShoppingCart, AlertTriangle,
  Receipt, ScanBarcode, ClipboardCheck, Plus, MessageSquare, Share2, HelpCircle,
  WalletCards, HandCoins, Truck, HeartPulse,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useStore } from "@/lib/store";
import {
  buildBusinessHealthScore,
  buildCashflowForecast,
  buildDebtorFollowUps,
  buildPeriodFinanceData,
  buildProfitLeaks,
  buildReorderSuggestions,
  buildWeeklyFinanceData,
  expenseBaseAmount,
  formatMoney,
  parseBusinessDate,
  supplyInvoiceAmountBase,
  type FinancePeriod,
} from "@/lib/reporting";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { fetchRuleInsightsApi, fetchWhatsAppSummaryApi } from "@/lib/api";
import { useFeatureAccess, useUpgradePrompt, LockedBadge } from "@/lib/features";
import { useQuery } from "@tanstack/react-query";
import { symbolForCurrency } from "@/lib/currency";

const Dashboard = () => {
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>("months");
  const { products, sales, expenses, discrepancies, activities, profile, generateWhatsAppSummary, supplyEntries, customers } = useStore();
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
    [expenses, paidSupplyRevenue, sales]
  );

  const periodSalesVsExpensesData = useMemo(
    () => buildPeriodFinanceData(sales, expenses, financePeriod, new Date(), paidSupplyRevenue),
    [expenses, financePeriod, paidSupplyRevenue, sales]
  );
  const cashflowForecast = useMemo(
    () => buildCashflowForecast(sales, expenses, customers, supplyEntries, profile.currency),
    [customers, expenses, profile.currency, sales, supplyEntries]
  );
  const debtorFollowUps = useMemo(() => buildDebtorFollowUps(customers, sym), [customers, sym]);
  const reorderSuggestions = useMemo(() => buildReorderSuggestions(products, sales), [products, sales]);
  const profitLeaks = useMemo(
    () => buildProfitLeaks(products, sales, expenses, customers, discrepancies, sym),
    [customers, discrepancies, expenses, products, sales, sym]
  );
  const businessHealth = useMemo(
    () => buildBusinessHealthScore({ products, sales, expenses, customers, discrepancies, cashflow: cashflowForecast }),
    [cashflowForecast, customers, discrepancies, expenses, products, sales]
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

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="shadow-soft xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <WalletCards className="h-4 w-4 text-primary" /> Cashflow Forecast
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {cashflowForecast.map((point) => (
              <div key={point.label} className={`rounded-lg border p-4 ${point.projectedNet < 0 ? "border-destructive/40 bg-destructive/10" : "border-border bg-muted/30"}`}>
                <p className="text-xs text-muted-foreground">{point.label}</p>
                <p className={`mt-1 font-display text-lg font-bold ${point.projectedNet < 0 ? "text-destructive" : "text-success"}`}>{formatMoney(point.projectedNet, sym)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">In {formatMoney(point.projectedIn, sym)} | Out {formatMoney(point.projectedOut, sym)}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-primary" /> Business Health
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-8 border-primary/20 bg-primary/10">
                <span className="font-display text-2xl font-bold">{businessHealth.score}</span>
              </div>
              <div>
                <p className="font-display text-lg font-semibold">{businessHealth.label}</p>
                <p className="text-sm text-muted-foreground">{businessHealth.summary}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {businessHealth.drivers.slice(0, 3).map((driver) => (
                <p key={driver} className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{driver}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-amber-600" /> Debtor Follow-Up
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {debtorFollowUps.length === 0 ? <p className="text-sm text-muted-foreground">No customer debt to follow up.</p> : debtorFollowUps.slice(0, 3).map((item) => (
              <div key={`${item.customer}-${item.phone}`} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.customer}</p>
                  <span className="text-xs font-semibold text-amber-600">{formatMoney(item.amount, sym)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.ageDays} day{item.ageDays === 1 ? "" : "s"} old | {item.phone || "No phone"}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" /> Supplier Reorders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {reorderSuggestions.length === 0 ? <p className="text-sm text-muted-foreground">No urgent reorder suggestions.</p> : reorderSuggestions.slice(0, 3).map((item) => (
              <div key={item.product} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.product}</p>
                  <span className="text-xs font-semibold text-primary">Order {item.suggestedOrder}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.stock} in stock | {item.daysLeft == null ? "No velocity yet" : `${item.daysLeft} days left`} | {item.supplier}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Profit Leaks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4 pt-0">
            {profitLeaks.length === 0 ? <p className="text-sm text-muted-foreground">No major leaks detected.</p> : profitLeaks.slice(0, 3).map((item) => (
              <div key={item.title} className={`rounded-lg border p-3 ${item.severity === "high" ? "border-destructive/40 bg-destructive/10" : "border-amber-300/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"}`}>
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-xs opacity-80">{item.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

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
        <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base font-display">Sales vs Expenses (Monthly / Yearly)</CardTitle>
          <div className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-1">
            {(["months", "years"] as FinancePeriod[]).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setFinancePeriod(period)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  financePeriod === period ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {period === "months" ? "Months" : "Years"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={periodSalesVsExpensesData} barCategoryGap={18}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="period" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
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

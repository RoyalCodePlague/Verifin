import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, BarChart3, Package, AlertTriangle, Users, Receipt, TrendingUp, Calendar } from "lucide-react";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { buildWeeklyFinanceData, csvCell, expenseBaseAmount, formatMoney, salePaymentBreakdown } from "@/lib/reporting";
import { LockedBadge, useFeatureAccess, useUpgradePrompt } from "@/lib/features";
import { symbolForCurrency } from "@/lib/currency";

const COLORS = ["hsl(152 55% 28%)", "hsl(38 92% 50%)", "hsl(0 72% 51%)", "hsl(200 70% 50%)", "hsl(280 60% 50%)"];

const Reports = () => {
  const { sales, expenses, products, discrepancies, customers, profile } = useStore();
  const { canUse } = useFeatureAccess();
  const promptUpgrade = useUpgradePrompt();
  const sym = profile.currencySymbol || "R";
  const todaySales = sales.filter((s) => s.date === "Today");
  const todaySalesTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + expenseBaseAmount(e), 0);
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const totalCostOfGoods = sales.reduce((sum, s) => sum + (s.totalCost || 0), 0);
  const grossProfit = sales.reduce((sum, s) => sum + (s.grossProfit ?? s.total), 0);
  const inventoryCost = products.reduce((sum, p) => sum + p.stock * (p.costPrice || 0), 0);
  const inventoryMarginValue = products.reduce((sum, p) => sum + p.stock * (p.price - (p.costPrice || 0)), 0);
  const weeklyData = buildWeeklyFinanceData(sales, expenses);
  const weeklySalesTotal = weeklyData.reduce((sum, d) => sum + d.sales, 0);
  const weeklyExpensesTotal = weeklyData.reduce((sum, d) => sum + d.expenses, 0);
  const paymentBreakdown = salePaymentBreakdown(sales);

  const categoryData = profile.categories.map(cat => {
    const catProducts = products.filter(p => p.category === cat);
    return { name: cat, value: catProducts.reduce((sum, p) => sum + p.stock * p.price, 0), count: catProducts.length };
  }).filter(c => c.value > 0);

  const expenseByCat = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + expenseBaseAmount(e);
    return acc;
  }, {} as Record<string, number>);

  const reports = [
    { title: "Daily Sales Summary", desc: `${todaySales.length} transactions - ${formatMoney(todaySalesTotal, sym)} total`, icon: FileText },
    { title: "Weekly Performance", desc: `Sales: ${formatMoney(weeklySalesTotal, sym)} - Expenses: ${formatMoney(weeklyExpensesTotal, sym)} - Net: ${formatMoney(weeklySalesTotal - weeklyExpensesTotal, sym)}`, icon: BarChart3, feature: "advanced_reports" },
    { title: "Stock Movement Report", desc: `${products.length} products tracked - ${products.filter(p => p.status !== "ok").length} need attention`, icon: Package, feature: "advanced_reports" },
    { title: "Discrepancy Report", desc: `${discrepancies.filter(d => d.status !== "resolved").length} open issues`, icon: AlertTriangle, feature: "discrepancy_tracking" },
    { title: "Customer Report", desc: `${customers.length} customers - ${formatMoney(customers.reduce((s, c) => s + c.totalSpent, 0), sym)} total revenue`, icon: Users, feature: "advanced_reports" },
    { title: "Expense Analysis", desc: `${expenses.length} expenses across ${Object.keys(expenseByCat).length} categories`, icon: Receipt },
    { title: "Profit & Loss", desc: `Revenue: ${formatMoney(totalSales, sym)} - COGS: ${formatMoney(totalCostOfGoods, sym)} - Gross profit: ${formatMoney(grossProfit, sym)}`, icon: TrendingUp, feature: "advanced_analytics" },
    { title: "Monthly Overview", desc: "Full month breakdown of sales, expenses, and stock", icon: Calendar, feature: "advanced_reports" },
  ];

  const row = (values: unknown[]) => values.map(csvCell).join(",");

  const exportToExcel = (title: string) => {
    const report = reports.find((item) => item.title === title);
    if (report?.feature && !canUse(report.feature)) {
      promptUpgrade(report.feature, report.title);
      return;
    }
    if (!canUse("excel_exports") && !title.includes("Sales") && !title.includes("Expense")) {
      promptUpgrade("excel_exports", "Advanced exports");
      return;
    }
    let csvRows: string[] = [];
    const date = new Date().toISOString().slice(0, 10);

    if (title.includes("Sales")) {
      csvRows = [
        "Currency,Date,Time,Items,Total,Payment Method",
        ...sales.map(s => row([profile.currency, s.date, s.time, s.items, formatMoney(s.total, sym), s.method])),
      ];
    } else if (title.includes("Performance")) {
      csvRows = [
        "Currency,Metric,Value",
        row([profile.currency, "Weekly Sales", formatMoney(weeklySalesTotal, sym)]),
        row([profile.currency, "Weekly Expenses", formatMoney(weeklyExpensesTotal, sym)]),
        row([profile.currency, "Weekly Net", formatMoney(weeklySalesTotal - weeklyExpensesTotal, sym)]),
        "",
        "Currency,Day,Sales,Expenses,Net",
        ...weeklyData.map(d => row([profile.currency, d.day, formatMoney(d.sales, sym), formatMoney(d.expenses, sym), formatMoney(d.sales - d.expenses, sym)])),
      ];
    } else if (title.includes("Profit")) {
      csvRows = [
        "Currency,Metric,Value",
        row([profile.currency, "Total Sales", formatMoney(totalSales, sym)]),
        row([profile.currency, "Cost of Goods Sold", formatMoney(totalCostOfGoods, sym)]),
        row([profile.currency, "Gross Profit", formatMoney(grossProfit, sym)]),
        row([profile.currency, "Expenses", formatMoney(totalExpenses, sym)]),
        row([profile.currency, "Net Profit", formatMoney(grossProfit - totalExpenses, sym)]),
      ];
    } else if (title.includes("Stock")) {
      csvRows = [
        "Currency,Product,SKU,Category,Stock,Reorder Level,Cost,Price,Margin %,Status,Value,Cost Value,Added Date,Last Restocked",
        ...products.map(p => row([profile.currency, p.name, p.sku, p.category, p.stock, p.reorder, formatMoney(p.costPrice || 0, sym), formatMoney(p.price, sym), p.price ? (((p.price - (p.costPrice || 0)) / p.price) * 100).toFixed(1) : "0.0", p.status, formatMoney(p.stock * p.price, sym), formatMoney(p.stock * (p.costPrice || 0), sym), p.addedDate || "N/A", p.lastRestocked || "N/A"])),
      ];
    } else if (title.includes("Discrepancy")) {
      csvRows = [
        "Product,Expected,Actual,Difference,Status",
        ...discrepancies.map(d => row([d.product, d.expected, d.actual, d.diff, d.status])),
      ];
    } else if (title.includes("Customer")) {
      csvRows = [
        "Currency,Name,Phone,Total Spent,Visits,Loyalty Points,Credits,Last Visit",
        ...customers.map(c => row([profile.currency, c.name, c.phone, formatMoney(c.totalSpent, sym), c.visits, c.loyaltyPoints, formatMoney(c.credits || 0, sym), c.lastVisit])),
      ];
    } else if (title.includes("Expense")) {
      csvRows = [
        "Base Currency,Entry Currency,Description,Original Amount,Base Amount,Date,Category",
        ...expenses.map(e => row([profile.currency, e.currency || profile.currency, e.desc, formatMoney(e.amount, symbolForCurrency(e.currency || profile.currency)), formatMoney(expenseBaseAmount(e), sym), e.date, e.category])),
      ];
    } else {
      csvRows = [
        "Currency,Metric,Value",
        row([profile.currency, "Total Sales", formatMoney(totalSales, sym)]),
        row([profile.currency, "Total Expenses", formatMoney(totalExpenses, sym)]),
        row([profile.currency, "Inventory Cost", formatMoney(inventoryCost, sym)]),
        row([profile.currency, "Inventory Margin Value", formatMoney(inventoryMarginValue, sym)]),
        row([profile.currency, "Total Products", products.length]),
        row([profile.currency, "Total Customers", customers.length]),
        row([profile.currency, "Net Profit", formatMoney(totalSales - totalExpenses, sym)]),
      ];
    }

    const bom = "\uFEFF";
    const blob = new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/ /g, "-")}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${title} exported as spreadsheet!`);
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">Generate and export business reports</p>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="shadow-soft lg:col-span-2">
          <CardContent className="p-5 grid sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Gross Profit</p>
              <p className="text-xl font-display font-bold">{formatMoney(grossProfit, sym)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cost of Goods</p>
              <p className="text-xl font-display font-bold">{formatMoney(totalCostOfGoods, sym)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inventory Cost</p>
              <p className="text-xl font-display font-bold">{formatMoney(inventoryCost, sym)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inventory Margin</p>
              <p className="text-xl font-display font-bold">{formatMoney(inventoryMarginValue, sym)}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Sales vs Expenses (Weekly)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(value) => formatMoney(Number(value), sym)} />
                <Bar dataKey="sales" fill="hsl(152 55% 28%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="hsl(38 92% 50%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Inventory by Category</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {categoryData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatMoney(Number(value), sym)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-soft lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Sales by Payment Currency</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {paymentBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales recorded yet.</p>
            ) : (
              paymentBreakdown.map((entry) => (
                <div key={entry.currency} className="rounded-lg border border-border p-4">
                  <p className="text-xs text-muted-foreground">{entry.currency}</p>
                  <p className="text-lg font-display font-bold mt-1">
                    {symbolForCurrency(entry.currency)}{entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {entry.currency !== profile.currency ? (
                    <p className="text-xs text-muted-foreground mt-1">Base: {formatMoney(entry.amountBase, sym)}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Base currency</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Card key={r.title} className="shadow-soft hover:shadow-elevated transition-shadow">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0"><r.icon className="h-5 w-5 text-primary" /></div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display font-semibold text-sm">{r.title}</h3>
                  {r.feature && !canUse(r.feature) && <LockedBadge />}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => exportToExcel(r.title)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Reports;

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, BarChart3, Package, AlertTriangle, Users, Receipt, TrendingUp, Calendar } from "lucide-react";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(152 55% 28%)", "hsl(38 92% 50%)", "hsl(0 72% 51%)", "hsl(200 70% 50%)", "hsl(280 60% 50%)"];

const Reports = () => {
  const { sales, expenses, products, discrepancies, customers, profile } = useStore();
  const sym = profile.currencySymbol || "R";
  const todaySalesTotal = sales.filter(s => s.date === "Today").reduce((sum, s) => sum + s.total, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);

  const categoryData = profile.categories.map(cat => {
    const catProducts = products.filter(p => p.category === cat);
    return { name: cat, value: catProducts.reduce((sum, p) => sum + p.stock * p.price, 0), count: catProducts.length };
  }).filter(c => c.value > 0);

  const expenseByCat = expenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {} as Record<string, number>);

  const weeklyData = [
    { day: "Mon", sales: 3200, expenses: 800 },
    { day: "Tue", sales: 2800, expenses: 1200 },
    { day: "Wed", sales: 4100, expenses: 600 },
    { day: "Thu", sales: 3600, expenses: 900 },
    { day: "Fri", sales: 5200, expenses: 700 },
    { day: "Sat", sales: 4800, expenses: 500 },
    { day: "Sun", sales: todaySalesTotal || 4280, expenses: 200 },
  ];

  const reports = [
    { title: "Daily Sales Summary", desc: `${sales.filter(s => s.date === "Today").length} transactions · ${sym}${todaySalesTotal.toLocaleString()} total`, icon: FileText },
    { title: "Weekly Performance", desc: `Sales: ${sym}${totalSales.toLocaleString()} · Expenses: ${sym}${totalExpenses.toLocaleString()} · Net: ${sym}${(totalSales - totalExpenses).toLocaleString()}`, icon: BarChart3 },
    { title: "Stock Movement Report", desc: `${products.length} products tracked · ${products.filter(p => p.status !== "ok").length} need attention`, icon: Package },
    { title: "Discrepancy Report", desc: `${discrepancies.filter(d => d.status !== "resolved").length} open issues`, icon: AlertTriangle },
    { title: "Customer Report", desc: `${customers.length} customers · ${sym}${customers.reduce((s, c) => s + c.totalSpent, 0).toLocaleString()} total revenue`, icon: Users },
    { title: "Expense Analysis", desc: `${expenses.length} expenses across ${Object.keys(expenseByCat).length} categories`, icon: Receipt },
    { title: "Profit & Loss", desc: `Revenue: ${sym}${totalSales.toLocaleString()} · Costs: ${sym}${totalExpenses.toLocaleString()} · Net: ${sym}${(totalSales - totalExpenses).toLocaleString()}`, icon: TrendingUp },
    { title: "Monthly Overview", desc: `Full month breakdown of sales, expenses, and stock`, icon: Calendar },
  ];

  const exportToExcel = (title: string) => {
    let csvRows: string[] = [];
    const date = new Date().toLocaleDateString();

    if (title.includes("Sales")) {
      csvRows = [
        "Date,Time,Items,Total,Payment Method",
        ...sales.map(s => `${s.date},${s.time},"${s.items}",${s.total},${s.method}`)
      ];
    } else if (title.includes("Performance") || title.includes("Profit")) {
      csvRows = [
        "Metric,Value",
        `Total Sales,${totalSales}`,
        `Total Expenses,${totalExpenses}`,
        `Net Profit,${totalSales - totalExpenses}`,
        "",
        "Day,Sales,Expenses",
        ...weeklyData.map(d => `${d.day},${d.sales},${d.expenses}`)
      ];
    } else if (title.includes("Stock")) {
      csvRows = [
        "Product,SKU,Category,Stock,Reorder Level,Price,Status,Value,Added Date,Last Restocked",
        ...products.map(p => `"${p.name}",${p.sku},${p.category},${p.stock},${p.reorder},${p.price},${p.status},${p.stock * p.price},${p.addedDate || "N/A"},${p.lastRestocked || "N/A"}`)
      ];
    } else if (title.includes("Discrepancy")) {
      csvRows = [
        "Product,Expected,Actual,Difference,Status",
        ...discrepancies.map(d => `"${d.product}",${d.expected},${d.actual},${d.diff},${d.status}`)
      ];
    } else if (title.includes("Customer")) {
      csvRows = [
        "Name,Phone,Total Spent,Visits,Loyalty Points,Credits,Last Visit",
        ...customers.map(c => `"${c.name}",${c.phone},${c.totalSpent},${c.visits},${c.loyaltyPoints},${c.credits || 0},${c.lastVisit}`)
      ];
    } else if (title.includes("Expense")) {
      csvRows = [
        "Description,Amount,Date,Category",
        ...expenses.map(e => `"${e.desc}",${e.amount},${e.date},${e.category}`)
      ];
    } else {
      csvRows = [
        "Metric,Value",
        `Total Sales,${totalSales}`,
        `Total Expenses,${totalExpenses}`,
        `Total Products,${products.length}`,
        `Total Customers,${customers.length}`,
        `Net Profit,${totalSales - totalExpenses}`,
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
        <Card className="shadow-soft">
          <CardHeader className="pb-2"><CardTitle className="text-base font-display">Sales vs Expenses (Weekly)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip />
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
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {reports.map((r) => (
          <Card key={r.title} className="shadow-soft hover:shadow-elevated transition-shadow">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0"><r.icon className="h-5 w-5 text-primary" /></div>
              <div className="flex-1">
                <h3 className="font-display font-semibold text-sm">{r.title}</h3>
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, BarChart3, Package, AlertTriangle, Users, Receipt, TrendingUp, Calendar, WalletCards, HandCoins, Truck, HeartPulse } from "lucide-react";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import {
  buildBusinessHealthScore,
  buildCashflowForecast,
  buildDebtorFollowUps,
  buildPeriodFinanceData,
  buildProfitLeaks,
  buildReorderSuggestions,
  buildWeeklyFinanceData,
  csvCell,
  expenseBaseAmount,
  formatCompactMoney,
  formatMoney,
  parseBusinessDate,
  salePaymentBreakdown,
  supplyInvoiceAmountBase,
  supplyInvoiceCostAmountBase,
  type FinancePeriod,
} from "@/lib/reporting";
import { LockedBadge, useFeatureAccess, useUpgradePrompt } from "@/lib/features";
import { symbolForCurrency } from "@/lib/currency";
import {
  createOtherIncomeApi,
  createSaleReturnApi,
  createCustomReportApi,
  deleteCustomReportApi,
  fetchBranchOverviewApi,
  fetchProfitLossApi,
  getAccessToken,
  listCustomReportsApi,
  runCustomReportApi,
  downloadCustomReportApi,
  updateCustomReportApi,
  type ApiCustomReport,
  type ApiCustomReportMetric,
  type ApiProfitLossSummary,
} from "@/lib/api";

const COLORS = ["hsl(152 55% 28%)", "hsl(38 92% 50%)", "hsl(0 72% 51%)", "hsl(200 70% 50%)", "hsl(280 60% 50%)"];

type SavedCustomReport = {
  id?: number;
  name: string;
  metric: ApiCustomReportMetric;
  metrics: ApiCustomReportMetric[];
  group: "day" | "month" | "year";
  sort: "asc" | "desc";
  start: string;
  end: string;
  branchFilter: string;
};

type CustomReportRow = { period: string; values: Partial<Record<ApiCustomReportMetric, number>> };

const CUSTOM_REPORT_METRICS: { value: ApiCustomReportMetric; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "profit", label: "Gross profit" },
  { value: "transactions", label: "Transactions" },
];

type ProfitLossPeriod = "today" | "this_week" | "this_month" | "previous_month" | "this_quarter" | "this_year" | "custom";

function mapSavedCustomReport(report: ApiCustomReport): SavedCustomReport {
  return {
    id: report.id,
    name: report.name,
    metric: report.metric,
    metrics: report.metrics?.length ? report.metrics : [report.metric],
    group: report.group_by,
    sort: report.sort_order || "asc",
    start: report.start_date || "",
    end: report.end_date || "",
    branchFilter: report.branch_filter === "branch" && report.branch
      ? String(report.branch)
      : report.branch_filter,
  };
}

const Reports = () => {
  const queryClient = useQueryClient();
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>("months");
  const { sales, expenses, products, discrepancies, customers, profile, supplyEntries, branches } = useStore();
  const approvedExpenses = useMemo(
    () => expenses.filter((expense) => (expense.approvalStatus || "approved") === "approved"),
    [expenses],
  );
  const access = useFeatureAccess();
  const { canUse } = access;
  const customReportsEnabled = canUse("custom_reports");
  const profitLossEnabled = canUse("advanced_analytics");
  const promptUpgrade = useUpgradePrompt();
  const [profitLossPeriod, setProfitLossPeriod] = useState<ProfitLossPeriod>("this_month");
  const [profitLossStart, setProfitLossStart] = useState("");
  const [profitLossEnd, setProfitLossEnd] = useState("");
  const [branchOverviewPeriod, setBranchOverviewPeriod] = useState<ProfitLossPeriod>("this_month");
  const [branchOverviewStart, setBranchOverviewStart] = useState("");
  const [branchOverviewEnd, setBranchOverviewEnd] = useState("");
  const [branchOverviewSelection, setBranchOverviewSelection] = useState<string[] | "all">("all");
  const [returnSaleId, setReturnSaleId] = useState("");
  const [returnItemId, setReturnItemId] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("1");
  const [refundMethod, setRefundMethod] = useState<"Cash" | "EFT" | "Card">("Cash");
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnedQuantities, setReturnedQuantities] = useState<Record<string, number>>({});
  const [incomeForm, setIncomeForm] = useState({ description: "", amount: "", date: new Date().toISOString().slice(0, 10) });
  const [incomeSaving, setIncomeSaving] = useState(false);
  const profitLossQuery = useQuery({
    queryKey: ["profit-loss", profitLossPeriod, profitLossStart, profitLossEnd],
    queryFn: () => fetchProfitLossApi(profitLossPeriod, profitLossStart, profitLossEnd),
    enabled: profitLossEnabled && (profitLossPeriod !== "custom" || (!!profitLossStart && !!profitLossEnd)),
    retry: false,
  });
  const branchOverviewQuery = useQuery({
    queryKey: ["branch-overview", branchOverviewPeriod, branchOverviewSelection, branchOverviewStart, branchOverviewEnd],
    queryFn: () => fetchBranchOverviewApi(
      branchOverviewPeriod,
      branchOverviewSelection,
      branchOverviewStart,
      branchOverviewEnd,
    ),
    enabled: canUse("multi_branch")
      && branches.length > 0
      && (branchOverviewPeriod !== "custom" || (!!branchOverviewStart && !!branchOverviewEnd)),
    retry: false,
  });
  const sym = profile.currencySymbol || "R";
  const returnSale = sales.find((sale) => sale.id === returnSaleId);
  const returnableItems = (returnSale?.saleItems || []).filter((item) => {
    if (!item.id) return false;
    const alreadyReturned = (item.returnedQuantity || 0) + (returnedQuantities[item.id] || 0);
    return item.quantity > alreadyReturned;
  });
  const selectedReturnItem = returnableItems.find((item) => item.id === returnItemId);
  const profitLossRows: Array<{ key: keyof ApiProfitLossSummary; label: string }> = [
    { key: "gross_sales", label: "Gross sales" },
    { key: "discounts", label: "Discounts" },
    { key: "sales_returns", label: "Sales returns / refunds" },
    { key: "net_sales", label: "Net sales" },
    { key: "cost_of_goods_sold", label: "Cost of goods sold" },
    { key: "gross_profit", label: "Gross profit" },
    { key: "operating_expenses", label: "Operating expenses" },
    { key: "other_income", label: "Other income" },
    { key: "other_expenses", label: "Other expenses" },
    { key: "net_profit", label: "Net profit / loss" },
    { key: "cash_received", label: "Cash received" },
    { key: "supplier_payments", label: "Supplier payments (cash outflow)" },
  ];
  const isToday = (value: string) => {
    const parsed = parseBusinessDate(value);
    return !!parsed && parsed.toDateString() === new Date().toDateString();
  };
  const todaySales = sales.filter((sale) => isToday(sale.date));
  const todaySalesTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  const totalExpenses = approvedExpenses.reduce((sum, e) => sum + expenseBaseAmount(e), 0);
  const paidSupplyRevenue = supplyEntries
    .filter((entry) => entry.direction === "outgoing" && entry.paymentStatus === "paid")
    .map((entry) => ({
      date: entry.movementDate,
      total: supplyInvoiceAmountBase(entry, profile.currency),
    }));
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0) + paidSupplyRevenue.reduce((sum, entry) => sum + entry.total, 0);
  const supplyCost = supplyEntries.filter(entry => entry.direction === "outgoing" && entry.paymentStatus === "paid").reduce((sum, entry) => sum + supplyInvoiceCostAmountBase(entry, profile.currency), 0);
  const totalCostOfGoods = sales.reduce((sum, s) => sum + (s.totalCost || 0), 0) + supplyCost;
  const grossProfit = totalSales - totalCostOfGoods;
  const inventoryCost = products.reduce((sum, p) => sum + p.stock * (p.costPrice || 0), 0);
  const inventoryMarginValue = products.reduce((sum, p) => sum + p.stock * (p.price - (p.costPrice || 0)), 0);
  const weeklyData = buildWeeklyFinanceData(sales, approvedExpenses, new Date(), paidSupplyRevenue);
  const weeklySalesTotal = weeklyData.reduce((sum, d) => sum + d.sales, 0);
  const weeklyExpensesTotal = weeklyData.reduce((sum, d) => sum + d.expenses, 0);
  const monthlyFinanceData = buildPeriodFinanceData(sales, approvedExpenses, "months", new Date(), paidSupplyRevenue);
  const periodFinanceData = buildPeriodFinanceData(sales, approvedExpenses, financePeriod, new Date(), paidSupplyRevenue);
  const monthlySalesTotal = monthlyFinanceData.reduce((sum, d) => sum + d.sales, 0);
  const monthlyExpensesTotal = monthlyFinanceData.reduce((sum, d) => sum + d.expenses, 0);
  const paymentBreakdown = salePaymentBreakdown(sales, profile.currency);
  const customerDebtTotal = customers.reduce((sum, c) => sum + (c.debtAmount || 0), 0);
  const cashflowForecast = buildCashflowForecast(sales, approvedExpenses, customers, supplyEntries, profile.currency);
  const debtorFollowUps = buildDebtorFollowUps(customers, sym);
  const reorderSuggestions = buildReorderSuggestions(products, sales);
  const profitLeaks = buildProfitLeaks(products, sales, approvedExpenses, customers, discrepancies, sym);
  const businessHealth = buildBusinessHealthScore({ products, sales, expenses: approvedExpenses, customers, discrepancies, cashflow: cashflowForecast });
  const [customMetrics, setCustomMetrics] = useState<ApiCustomReportMetric[]>(["sales"]);
  const [customGroup, setCustomGroup] = useState<SavedCustomReport["group"]>("month");
  const [customSort, setCustomSort] = useState<SavedCustomReport["sort"]>("asc");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [savedReports, setSavedReports] = useState<SavedCustomReport[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("verifin_custom_reports") || "[]") as Array<Partial<SavedCustomReport>>;
      return Array.isArray(stored) ? stored.filter((report) => typeof report.name === "string")
        .map((report) => {
          const legacyMetric: ApiCustomReportMetric = report.metric === "profit" || report.metric === "transactions" ? report.metric : "sales";
          const metrics = Array.isArray(report.metrics)
            ? report.metrics.filter((metric): metric is ApiCustomReportMetric => metric === "sales" || metric === "profit" || metric === "transactions")
            : [legacyMetric];
          const selectedMetrics = metrics.length ? metrics : [legacyMetric];
          return {
            id: report.id,
            name: report.name as string,
            metric: selectedMetrics[0],
            metrics: selectedMetrics,
            group: report.group === "day" || report.group === "year" ? report.group : "month",
            sort: report.sort === "desc" ? "desc" : "asc",
            start: report.start || "",
            end: report.end || "",
            branchFilter: report.branchFilter || "all",
          };
        }) : [];
    } catch { return []; }
  });
  const [serverCustomRows, setServerCustomRows] = useState<CustomReportRow[]>([]);
  const [serverCustomRunKey, setServerCustomRunKey] = useState("");
  const [customReportRunning, setCustomReportRunning] = useState(false);
  const legacySavedReports = useRef(savedReports.filter((report) => !report.id));
  const customRows = useMemo(() => {
    const rows = sales.filter((sale) => (!customStart || sale.date >= customStart) && (!customEnd || sale.date <= customEnd) && (branchFilter === "all" || (branchFilter === "unassigned" ? !sale.branchId : sale.branchId === branchFilter)));
    const grouped = new Map<string, Partial<Record<ApiCustomReportMetric, number>>>();
    for (const sale of rows) {
      const date = parseBusinessDate(sale.date);
      const key = !date ? "Unknown" : customGroup === "day" ? sale.date : customGroup === "year" ? String(date.getFullYear()) : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
      const values = grouped.get(key) || {};
      for (const metric of customMetrics) {
        const value = metric === "transactions" ? 1 : metric === "profit" ? (sale.grossProfit ?? (sale.total - (sale.totalCost || 0))) : sale.total;
        values[metric] = (values[metric] || 0) + value;
      }
      grouped.set(key, values);
    }
    return [...grouped].sort(([a],[b]) => customSort === "desc" ? b.localeCompare(a) : a.localeCompare(b)).map(([period,values]) => ({period,values}));
  }, [sales, customMetrics, customGroup, customStart, customEnd, branchFilter, customSort]);
  const forecastWindow = sales.filter(sale => { const date = parseBusinessDate(sale.date); const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30); return date && date >= cutoff; });
  const averageDailySales = forecastWindow.reduce((sum,sale)=>sum+sale.total,0)/30;
  const projectedWeek = averageDailySales * 7;
  const projectedMonth = averageDailySales * 30;
  useEffect(() => {
    if (!customReportsEnabled || !getAccessToken()) return;
    let cancelled = false;
    void listCustomReportsApi()
      .then((reports) => {
        if (cancelled) return;
        const saved = reports.map(mapSavedCustomReport);
        const names = new Set(saved.map((report) => report.name));
        const legacy = legacySavedReports.current.filter((report) => !names.has(report.name));
        const merged = [...saved, ...legacy];
        setSavedReports(merged);
        localStorage.setItem("verifin_custom_reports", JSON.stringify(merged));
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load saved report templates.");
      });
    return () => { cancelled = true; };
  }, [customReportsEnabled]);

  const saveCustomReport = async (showToast = true): Promise<number | null> => {
    if (!canUse("custom_reports")) { promptUpgrade("custom_reports", "Custom Reports"); return null; }
    if (!customMetrics.length) {
      toast.error("Select at least one report field.");
      return null;
    }
    const metricLabels = Object.fromEntries(CUSTOM_REPORT_METRICS.map((item) => [item.value, item.label])) as Record<ApiCustomReportMetric, string>;
    const item: SavedCustomReport = {
      name: `${customMetrics.map((metric) => metricLabels[metric]).join(" + ")} by ${customGroup}`,
      metric: customMetrics[0],
      metrics: [...customMetrics],
      group: customGroup,
      sort: customSort,
      start: customStart,
      end: customEnd,
      branchFilter,
    };
    const existing = savedReports.find((report) => report.name === item.name);
    const branchFilterKind = branchFilter === "all" || branchFilter === "unassigned" ? branchFilter : "branch";
    try {
      const payload = {
        name: item.name,
        metric: item.metric,
        metrics: item.metrics,
        group_by: item.group,
        sort_order: item.sort,
        start_date: item.start || null,
        end_date: item.end || null,
        branch_filter: branchFilterKind as ApiCustomReport["branch_filter"],
        branch: branchFilterKind === "branch" ? Number(branchFilter) : null,
      };
      const saved = existing?.id
        ? await updateCustomReportApi(existing.id, payload)
        : await createCustomReportApi(payload);
      const next = [mapSavedCustomReport(saved), ...savedReports.filter((report) => report.name !== item.name)].slice(0, 20);
      setSavedReports(next);
      localStorage.setItem("verifin_custom_reports", JSON.stringify(next));
      if (showToast) toast.success("Report template saved to your account.");
      return saved.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save report template.");
      return null;
    }
  };

  const currentCustomRunKey = JSON.stringify({ customMetrics, customGroup, customSort, customStart, customEnd, branchFilter });
  const displayedCustomRows = serverCustomRunKey === currentCustomRunKey
    ? serverCustomRows
    : customRows;

  const runCustomReport = async () => {
    if (!canUse("custom_reports")) { promptUpgrade("custom_reports", "Custom Reports"); return; }
    setCustomReportRunning(true);
    try {
      const id = await saveCustomReport(false);
      if (!id) return;
      const result = await runCustomReportApi(id);
      setServerCustomRows(result.rows.map((row) => {
        const values = row.values || { [result.report.metric]: row.value };
        return {
          period: row.period,
          values: Object.fromEntries(Object.entries(values).map(([metric, value]) => [metric, Number(value)])) as Partial<Record<ApiCustomReportMetric, number>>,
        };
      }));
      setServerCustomRunKey(currentCustomRunKey);
      toast.success("Report refreshed from the server.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run the custom report.");
    } finally {
      setCustomReportRunning(false);
    }
  };

  const loadCustomReport = (report: SavedCustomReport) => {
    setCustomMetrics(report.metrics?.length ? report.metrics : [report.metric]);
    setCustomGroup(report.group);
    setCustomSort(report.sort);
    setCustomStart(report.start);
    setCustomEnd(report.end);
    setBranchFilter(report.branchFilter);
  };

  const removeCustomReport = async (report: SavedCustomReport) => {
    if (!report.id) {
      const next = savedReports.filter((item) => item.name !== report.name);
      setSavedReports(next);
      localStorage.setItem("verifin_custom_reports", JSON.stringify(next));
      return;
    }
    try {
      await deleteCustomReportApi(report.id);
      const next = savedReports.filter((item) => item.id !== report.id);
      setSavedReports(next);
      localStorage.setItem("verifin_custom_reports", JSON.stringify(next));
      toast.success("Report template deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete report template.");
    }
  };

  const recordSaleReturn = async () => {
    if (!returnSaleId || !selectedReturnItem?.id) {
      toast.error("Choose a sale item to return.");
      return;
    }
    const saleItemId = selectedReturnItem.id;
    const quantity = Number(returnQuantity);
    const available = selectedReturnItem.quantity - (selectedReturnItem.returnedQuantity || 0) - (returnedQuantities[saleItemId] || 0);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > available) {
      toast.error(`Enter a return quantity between 1 and ${available}.`);
      return;
    }
    setReturnSaving(true);
    try {
      const saved = await createSaleReturnApi(returnSaleId, {
        sale_item: Number(selectedReturnItem.id),
        quantity,
        refund_method: refundMethod,
      });
      setReturnedQuantities((previous) => ({
        ...previous,
        [saleItemId]: (previous[saleItemId] || 0) + quantity,
      }));
      setReturnItemId("");
      setReturnQuantity("1");
      await queryClient.invalidateQueries({ queryKey: ["profit-loss"] });
      toast.success(`Return recorded. Refund: ${formatMoney(Number(saved.refund_amount), sym)}. Returned stock is available again.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the return.");
    } finally {
      setReturnSaving(false);
    }
  };

  const recordOtherIncome = async () => {
    const amount = Number(incomeForm.amount);
    if (!incomeForm.description.trim() || !Number.isFinite(amount) || amount <= 0 || !incomeForm.date) {
      toast.error("Enter a description, a positive amount, and a date.");
      return;
    }
    setIncomeSaving(true);
    try {
      await createOtherIncomeApi({
        description: incomeForm.description.trim(),
        amount,
        currency: profile.currency,
        date: incomeForm.date,
      });
      setIncomeForm({ description: "", amount: "", date: new Date().toISOString().slice(0, 10) });
      await queryClient.invalidateQueries({ queryKey: ["profit-loss"] });
      toast.success("Other income recorded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record other income.");
    } finally {
      setIncomeSaving(false);
    }
  };

  const exportCustomReport = async (format: "csv" | "xlsx" | "pdf") => {
    if (!canUse("custom_reports")) { promptUpgrade("custom_reports", "Custom Reports"); return; }
    if (format === "xlsx" && !canUse("excel_exports")) { promptUpgrade("excel_exports", "Excel exports"); return; }
    const id = await saveCustomReport(false);
    if (!id) return;
    try {
      const blob = await downloadCustomReportApi(id, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `custom-report-${customMetrics.join("-")}-${customGroup}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${format.toUpperCase()} report exported.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export the custom report.");
    }
  };

  const categoryData = Array.from(
    products.reduce((acc, product) => {
      const key = product.category?.trim() || "Uncategorized";
      const current = acc.get(key) || { name: key, value: 0, count: 0 };
      current.value += product.stock * product.price;
      current.count += 1;
      acc.set(key, current);
      return acc;
    }, new Map<string, { name: string; value: number; count: number }>())
      .values()
  ).filter((category) => category.value > 0 || category.count > 0);

  const expenseByCat = approvedExpenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + expenseBaseAmount(e);
    return acc;
  }, {} as Record<string, number>);

  const reports = [
    { title: "Daily Sales Summary", desc: `${todaySales.length} transactions - ${formatMoney(todaySalesTotal, sym)} total`, icon: FileText },
    { title: "Weekly Performance", desc: `Sales: ${formatMoney(weeklySalesTotal, sym)} - Expenses: ${formatMoney(weeklyExpensesTotal, sym)} - Net: ${formatMoney(weeklySalesTotal - weeklyExpensesTotal, sym)}`, icon: BarChart3, feature: "advanced_reports" },
    { title: "Stock Movement Report", desc: `${products.length} products tracked - ${products.filter(p => p.status !== "ok").length} need attention`, icon: Package, feature: "advanced_reports" },
    { title: "Discrepancy Report", desc: `${discrepancies.filter(d => d.status !== "resolved").length} open issues`, icon: AlertTriangle, feature: "discrepancy_tracking" },
    { title: "Customer Report", desc: `${customers.length} customers - ${formatMoney(customers.reduce((s, c) => s + c.totalSpent, 0), sym)} revenue - ${formatMoney(customerDebtTotal, sym)} owed`, icon: Users, feature: "advanced_reports" },
    { title: "Expense Analysis", desc: `${approvedExpenses.length} approved expenses across ${Object.keys(expenseByCat).length} categories`, icon: Receipt },
    { title: "Profit & Loss", desc: `Revenue: ${formatMoney(totalSales, sym)} - COGS: ${formatMoney(totalCostOfGoods, sym)} - Gross profit: ${formatMoney(grossProfit, sym)}`, icon: TrendingUp, feature: "advanced_analytics" },
    { title: "Monthly Overview", desc: `12-month sales: ${formatMoney(monthlySalesTotal, sym)} - expenses: ${formatMoney(monthlyExpensesTotal, sym)}`, icon: Calendar, feature: "advanced_reports" },
    { title: "Cashflow Forecast", desc: `90-day net: ${formatMoney(cashflowForecast.find((point) => point.days === 90)?.projectedNet || 0, sym)}`, icon: WalletCards, feature: "advanced_analytics" },
    { title: "Debtor Follow-Up", desc: `${debtorFollowUps.length} customer${debtorFollowUps.length === 1 ? "" : "s"} need payment follow-up`, icon: HandCoins, feature: "advanced_reports" },
    { title: "Supplier Reorder Suggestions", desc: `${reorderSuggestions.length} product${reorderSuggestions.length === 1 ? "" : "s"} suggested for reorder`, icon: Truck, feature: "reorder_suggestions" },
    { title: "Profit Leak Detector", desc: `${profitLeaks.length} leak${profitLeaks.length === 1 ? "" : "s"} detected`, icon: AlertTriangle, feature: "advanced_analytics" },
    { title: "Business Health Score", desc: `${businessHealth.score}/100 - ${businessHealth.label}`, icon: HeartPulse, feature: "advanced_analytics" },
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
    if (title === "Profit & Loss" && !profitLossQuery.data) {
      toast.info("Wait for the selected Profit & Loss period to finish loading before exporting.");
      return;
    }
    let csvRows: string[] = [];
    const date = new Date().toISOString().slice(0, 10);

    if (title.includes("Sales")) {
      csvRows = [
        "Currency,Date,Time,Items,Total,Payment Method",
        ...sales.map(s => row([profile.currency, s.date, s.time, s.items, formatMoney(s.total, sym), s.method])),
        "",
        "Currency,Date,Source,Total",
        ...paidSupplyRevenue.map((entry) => row([profile.currency, entry.date, "Paid Supply Invoice", formatMoney(entry.total, sym)])),
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
    } else if (title.includes("Monthly")) {
      csvRows = [
        "Currency,Period,Sales,Expenses,Net",
        ...monthlyFinanceData.map(d => row([profile.currency, d.period, formatMoney(d.sales, sym), formatMoney(d.expenses, sym), formatMoney(d.sales - d.expenses, sym)])),
      ];
    } else if (title === "Profit & Loss") {
      const report = profitLossQuery.data!;
      csvRows = [
        "Currency,Metric,Current Period,Previous Period,Change",
        ...profitLossRows.map((item) => row([
          report.currency,
          item.label,
          report.current[item.key],
          report.previous[item.key],
          report.comparison[item.key].change,
        ])),
      ];
    } else if (title.includes("Cashflow")) {
      csvRows = [
        "Currency,Horizon,Projected In,Projected Out,Projected Net",
        ...cashflowForecast.map((point) => row([profile.currency, point.label, formatMoney(point.projectedIn, sym), formatMoney(point.projectedOut, sym), formatMoney(point.projectedNet, sym)])),
      ];
    } else if (title.includes("Debtor")) {
      csvRows = [
        "Currency,Customer,Phone,Amount,Age Days,Message",
        ...debtorFollowUps.map((item) => row([profile.currency, item.customer, item.phone, formatMoney(item.amount, sym), item.ageDays, item.message])),
      ];
    } else if (title.includes("Reorder")) {
      csvRows = [
        "Product,Supplier,Stock,Reorder Level,Sold Last 30,Days Left,Suggested Order",
        ...reorderSuggestions.map((item) => row([item.product, item.supplier, item.stock, item.reorderLevel, item.soldLast30, item.daysLeft ?? "N/A", item.suggestedOrder])),
      ];
    } else if (title.includes("Leak")) {
      csvRows = [
        "Severity,Title,Detail",
        ...profitLeaks.map((item) => row([item.severity, item.title, item.detail])),
      ];
    } else if (title.includes("Health")) {
      csvRows = [
        "Metric,Value",
        row(["Score", businessHealth.score]),
        row(["Label", businessHealth.label]),
        row(["Summary", businessHealth.summary]),
        "",
        "Driver",
        ...businessHealth.drivers.map((driver) => row([driver])),
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
        "Currency,Name,Phone,Total Spent,Visits,Loyalty Points,Credits,Debt Balance,Debt Started,Debt Notes,Last Visit",
        ...customers.map(c => row([profile.currency, c.name, c.phone, formatMoney(c.totalSpent, sym), c.visits, c.loyaltyPoints, formatMoney(c.credits || 0, sym), formatMoney(c.debtAmount || 0, sym), c.debtStartedAt || "", c.debtNotes || "", c.lastVisit])),
      ];
    } else if (title.includes("Expense")) {
      csvRows = [
        "Base Currency,Entry Currency,Description,Original Amount,Base Amount,Date,Category",
        ...approvedExpenses.map(e => row([profile.currency, e.currency || profile.currency, e.desc, formatMoney(e.amount, symbolForCurrency(e.currency || profile.currency)), formatMoney(expenseBaseAmount(e), sym), e.date, e.category])),
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

  const toggleBranchOverviewBranch = (branchId: string, checked: boolean) => {
    const current = branchOverviewSelection === "all"
      ? branches.map((branch) => branch.id)
      : branchOverviewSelection;
    const next = checked
      ? [...new Set([...current, branchId])]
      : current.filter((id) => id !== branchId);
    setBranchOverviewSelection(next.length === branches.length ? "all" : next);
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">Generate and export business reports</p>

      {profitLossEnabled ? (
        <Card className="shadow-soft">
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="font-display">Profit &amp; Loss</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Transaction-based reporting with period comparison and historical sale costs.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Profit and loss period"
                value={profitLossPeriod}
                onChange={(event) => setProfitLossPeriod(event.target.value as ProfitLossPeriod)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="today">Today</option>
                <option value="this_week">This week</option>
                <option value="this_month">This month</option>
                <option value="previous_month">Previous month</option>
                <option value="this_quarter">This quarter</option>
                <option value="this_year">This year</option>
                <option value="custom">Custom range</option>
              </select>
              <Button variant="outline" onClick={() => exportToExcel("Profit & Loss")}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {profitLossPeriod === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Start date
                  <input type="date" value={profitLossStart} onChange={(event) => setProfitLossStart(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" />
                </label>
                <label className="text-sm">
                  End date
                  <input type="date" value={profitLossEnd} onChange={(event) => setProfitLossEnd(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" />
                </label>
              </div>
            ) : null}
            {profitLossQuery.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {profitLossQuery.error instanceof Error ? profitLossQuery.error.message : "Could not load the Profit & Loss report."}
              </p>
            ) : null}
            {profitLossPeriod === "custom" && (!profitLossStart || !profitLossEnd) ? (
              <p className="text-sm text-muted-foreground">Choose both dates to run a custom report.</p>
            ) : null}
            {profitLossQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading financial transactions…</p> : null}
            {profitLossQuery.data ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Current period: {profitLossQuery.data.start_date} – {profitLossQuery.data.end_date}
                  {" · "}Comparison: {profitLossQuery.data.previous_start_date} – {profitLossQuery.data.previous_end_date}
                </p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="p-3 font-medium">Financial line</th>
                        <th className="p-3 text-right font-medium">Current</th>
                        <th className="p-3 text-right font-medium">Previous</th>
                        <th className="p-3 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {profitLossRows.map(({ key, label }) => {
                        const deduction = ["discounts", "sales_returns", "cost_of_goods_sold", "operating_expenses", "other_expenses", "supplier_payments"].includes(key);
                        const currentValue = Number(profitLossQuery.data.current[key]);
                        const previousValue = Number(profitLossQuery.data.previous[key]);
                        const change = Number(profitLossQuery.data.comparison[key].change);
                        const amount = (value: number) => formatMoney(deduction ? -value : value, sym);
                        const isTotal = ["net_sales", "gross_profit", "net_profit"].includes(key);
                        return (
                          <tr key={key} className={isTotal ? "font-semibold" : ""}>
                            <td className="p-3">{label}</td>
                            <td className="p-3 text-right tabular-nums">{amount(currentValue)}</td>
                            <td className="p-3 text-right tabular-nums">{amount(previousValue)}</td>
                            <td className="p-3 text-right tabular-nums">
                              {formatMoney(change, sym)}
                              {profitLossQuery.data.comparison[key].change_percent != null
                                ? ` (${Number(profitLossQuery.data.comparison[key].change_percent).toFixed(1)}%)`
                                : " (no prior baseline)"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">
                  Cash received is shown separately from sales revenue. Supplier payments are cash outflows and inventory purchases are not expensed here; cost of goods sold uses each sale’s saved cost.
                </p>
              </>
            ) : null}

            <div className="grid gap-5 border-t border-border pt-5 md:grid-cols-2">
              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold">Record a sales return</h3>
                  <p className="text-xs text-muted-foreground">Refunds use the original sale price and return the quantity to stock.</p>
                </div>
                <label className="block text-sm">
                  Sale
                  <select
                    value={returnSaleId}
                    onChange={(event) => { setReturnSaleId(event.target.value); setReturnItemId(""); }}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                  >
                    <option value="">Choose a sale</option>
                    {sales.filter((sale) => Number.isSafeInteger(Number(sale.id)) && Number(sale.id) > 0 && sale.saleItems?.some((item) => item.id)).map((sale) => (
                      <option key={sale.id} value={sale.id}>{sale.date} · {sale.items} · {formatMoney(sale.total, sym)}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  Item
                  <select value={returnItemId} onChange={(event) => setReturnItemId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3">
                    <option value="">Choose an item</option>
                    {returnableItems.map((item) => {
                      const remaining = item.quantity - (item.returnedQuantity || 0) - (item.id ? returnedQuantities[item.id] || 0 : 0);
                      return <option key={item.id} value={item.id}>{item.productName} · {remaining} available</option>;
                    })}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Quantity
                    <input type="number" min="1" max={selectedReturnItem ? selectedReturnItem.quantity - (selectedReturnItem.returnedQuantity || 0) - (selectedReturnItem.id ? returnedQuantities[selectedReturnItem.id] || 0 : 0) : 1} value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" />
                  </label>
                  <label className="text-sm">
                    Refund method
                    <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as "Cash" | "EFT" | "Card")} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3">
                      <option value="Cash">Cash</option><option value="EFT">EFT</option><option value="Card">Card</option>
                    </select>
                  </label>
                </div>
                <Button onClick={() => void recordSaleReturn()} disabled={returnSaving || !returnSaleId || !returnItemId}>
                  {returnSaving ? "Recording…" : "Record return"}
                </Button>
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="font-semibold">Record other income</h3>
                  <p className="text-xs text-muted-foreground">Income is recorded in your base currency and included in the selected P&amp;L period by date.</p>
                </div>
                <label className="block text-sm">
                  Description
                  <input value={incomeForm.description} onChange={(event) => setIncomeForm((form) => ({ ...form, description: event.target.value }))} placeholder="e.g. Interest received" className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    Amount ({profile.currency})
                    <input type="number" min="0.01" step="0.01" value={incomeForm.amount} onChange={(event) => setIncomeForm((form) => ({ ...form, amount: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" />
                  </label>
                  <label className="text-sm">
                    Date
                    <input type="date" value={incomeForm.date} onChange={(event) => setIncomeForm((form) => ({ ...form, date: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" />
                  </label>
                </div>
                <Button onClick={() => void recordOtherIncome()} disabled={incomeSaving || !incomeForm.description.trim() || !incomeForm.amount}>
                  {incomeSaving ? "Recording…" : "Record other income"}
                </Button>
              </section>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-soft">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="font-display font-semibold">Profit &amp; Loss</h2>
              <p className="text-sm text-muted-foreground">Period-based financial reporting is available with Advanced Analytics.</p>
            </div>
            <Button variant="outline" onClick={() => promptUpgrade("advanced_analytics", "Profit & Loss")}>View plans</Button>
          </CardContent>
        </Card>
      )}

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

        <Card className="shadow-soft lg:col-span-2">
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs text-muted-foreground">Health Score</p>
              <p className="text-xl font-display font-bold">{businessHealth.score}/100</p>
              <p className="text-xs text-muted-foreground">{businessHealth.label}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">90-Day Cashflow</p>
              <p className={`text-xl font-display font-bold ${(cashflowForecast.find((point) => point.days === 90)?.projectedNet || 0) < 0 ? "text-destructive" : "text-success"}`}>
                {formatMoney(cashflowForecast.find((point) => point.days === 90)?.projectedNet || 0, sym)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Debtor Follow-Ups</p>
              <p className="text-xl font-display font-bold">{debtorFollowUps.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Reorder Suggestions</p>
              <p className="text-xl font-display font-bold">{reorderSuggestions.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Profit Leaks</p>
              <p className={`text-xl font-display font-bold ${profitLeaks.length ? "text-destructive" : "text-success"}`}>{profitLeaks.length}</p>
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
                <YAxis width={64} tick={{ fontSize: 12 }} tickFormatter={(value) => formatCompactMoney(Number(value), sym)} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(value) => formatMoney(Number(value), sym)} />
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
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={periodFinanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis width={64} tick={{ fontSize: 12 }} tickFormatter={(value) => formatCompactMoney(Number(value), sym)} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(value) => formatMoney(Number(value), sym)} />
                <Legend />
                <Bar dataKey="sales" fill="hsl(152 55% 28%)" name="Sales" radius={[4, 4, 0, 0]} minPointSize={3} />
                <Bar dataKey="expenses" fill="hsl(0 84% 60%)" name="Expenses" radius={[4, 4, 0, 0]} minPointSize={3} />
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

      <Card className="shadow-soft">
        <CardHeader><CardTitle className="font-display flex items-center gap-2">Custom Reports {!canUse("custom_reports") && <LockedBadge />}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose one or more fields, a date range, branch, and time grouping. Saved templates sync to your account.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <fieldset className="rounded-md border p-3 sm:col-span-2 lg:col-span-5">
              <legend className="px-1 text-sm font-medium">Report fields</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {CUSTOM_REPORT_METRICS.map((item) => (
                  <label key={item.value} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={customMetrics.includes(item.value)}
                      onChange={() => setCustomMetrics((current) => current.includes(item.value)
                        ? (current.length > 1 ? current.filter((metric) => metric !== item.value) : current)
                        : [...current, item.value])}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <select aria-label="Group by" className="h-10 rounded-md border bg-background px-3 text-sm" value={customGroup} onChange={e=>setCustomGroup(e.target.value as SavedCustomReport["group"])}><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option></select>
            <select aria-label="Sort order" className="h-10 rounded-md border bg-background px-3 text-sm" value={customSort} onChange={e=>setCustomSort(e.target.value as SavedCustomReport["sort"])}><option value="asc">Oldest first</option><option value="desc">Newest first</option></select>
            <select aria-label="Branch filter" className="h-10 rounded-md border bg-background px-3 text-sm" value={branchFilter} onChange={e=>setBranchFilter(e.target.value)}><option value="all">All branches</option><option value="unassigned">No branch</option>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
            <input aria-label="Start date" type="date" className="h-10 rounded-md border bg-background px-3 text-sm" value={customStart} onChange={e=>setCustomStart(e.target.value)} />
            <input aria-label="End date" type="date" className="h-10 rounded-md border bg-background px-3 text-sm" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} />
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void saveCustomReport()}>Save template</Button><Button variant="outline" disabled={customReportRunning} onClick={() => void runCustomReport()}>{customReportRunning ? "Running…" : "Run report"}</Button><Button onClick={() => void exportCustomReport("csv")}>CSV</Button><Button variant="outline" onClick={() => void exportCustomReport("xlsx")}>Excel</Button><Button variant="outline" onClick={() => void exportCustomReport("pdf")}>PDF</Button></div>
          </div>
          {displayedCustomRows.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[540px] text-sm">
                <thead><tr className="border-b bg-muted/50"><th className="p-3 text-left font-medium">Period</th>{customMetrics.map((metric) => <th key={metric} className="p-3 text-right font-medium">{CUSTOM_REPORT_METRICS.find((item) => item.value === metric)?.label}</th>)}</tr></thead>
                <tbody>{displayedCustomRows.slice(-20).map((row) => (
                  <tr key={row.period} className="border-b last:border-0">
                    <td className="p-3">{row.period}</td>
                    {customMetrics.map((metric) => {
                      const value = row.values[metric] ?? 0;
                      return <td key={metric} className="p-3 text-right tabular-nums">{metric === "transactions" ? value.toLocaleString() : formatMoney(value, sym)}</td>;
                    })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="rounded-md border p-4 text-sm text-muted-foreground">No sales match this date range.</p>}
          {savedReports.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Saved templates</p>
              {savedReports.map((report) => (
                <div key={report.id ?? report.name} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span className="text-sm">{report.name}</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => loadCustomReport(report)}>Load</Button>
                    <Button variant="ghost" size="sm" onClick={() => void removeCustomReport(report)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-soft"><CardHeader><CardTitle className="font-display">Forecast {!canUse("forecasting") && <LockedBadge />}</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Straight-line estimate from the last 30 days of recorded sales.</p><div className="grid grid-cols-2 gap-3"><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Next 7 days</p><p className="font-semibold">{formatMoney(projectedWeek,sym)}</p></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Next 30 days</p><p className="font-semibold">{formatMoney(projectedMonth,sym)}</p></div></div><p className="text-xs text-muted-foreground">{forecastWindow.length} sales included; estimates do not adjust for seasonality.</p></CardContent></Card>
        <Card className="shadow-soft lg:col-span-2">
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="font-display flex items-center gap-2">Branch Comparison {!canUse("multi_branch") && <LockedBadge />}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Consolidated and branch-level profit, expenses, inventory, and outstanding balances.</p>
            </div>
            {canUse("multi_branch") && branches.length > 0 && (
              <select
                aria-label="Branch comparison period"
                value={branchOverviewPeriod}
                onChange={(event) => setBranchOverviewPeriod(event.target.value as ProfitLossPeriod)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="today">Today</option>
                <option value="this_week">This week</option>
                <option value="this_month">This month</option>
                <option value="previous_month">Previous month</option>
                <option value="this_quarter">This quarter</option>
                <option value="this_year">This year</option>
                <option value="custom">Custom range</option>
              </select>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!canUse("multi_branch") ? (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">Branch reporting is available on an eligible plan.</p>
            ) : branches.length === 0 ? (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">Create branches in Settings to compare branch performance.</p>
            ) : (
              <>
                {branchOverviewPeriod === "custom" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">Start date<input aria-label="Branch comparison start date" type="date" value={branchOverviewStart} onChange={(event) => setBranchOverviewStart(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" /></label>
                    <label className="text-sm">End date<input aria-label="Branch comparison end date" type="date" value={branchOverviewEnd} onChange={(event) => setBranchOverviewEnd(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3" /></label>
                  </div>
                )}
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Branches to include</legend>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input type="checkbox" checked={branchOverviewSelection === "all"} onChange={(event) => setBranchOverviewSelection(event.target.checked ? "all" : [])} />
                      <span>Entire business, including unassigned records</span>
                    </label>
                    {branches.map((branch) => {
                      const checked = branchOverviewSelection === "all" || branchOverviewSelection.includes(branch.id);
                      return (
                        <label key={branch.id} className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                          <input type="checkbox" checked={checked} onChange={(event) => toggleBranchOverviewBranch(branch.id, event.target.checked)} />
                          <span>{branch.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {branchOverviewQuery.isLoading && <p className="text-sm text-muted-foreground">Loading branch figures…</p>}
                {branchOverviewQuery.isError && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{branchOverviewQuery.error instanceof Error ? branchOverviewQuery.error.message : "Branch figures could not be loaded."}</p>}
                {branchOverviewPeriod === "custom" && (!branchOverviewStart || !branchOverviewEnd) && (
                  <p className="text-sm text-muted-foreground">Choose both dates to load the custom comparison.</p>
                )}
                {branchOverviewQuery.data && branchOverviewSelection !== "all" && branchOverviewSelection.length === 0 ? (
                  <p className="rounded-md border p-4 text-sm text-muted-foreground">Select one or more branches, or choose the entire business.</p>
                ) : branchOverviewQuery.data && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      {branchOverviewQuery.data.start_date} to {branchOverviewQuery.data.end_date}
                      {branchOverviewQuery.data.includes_unassigned_records ? " · Entire business includes unassigned records" : " · Only selected branches are included"}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ["Net sales", branchOverviewQuery.data.total.net_sales],
                        ["Gross profit", branchOverviewQuery.data.total.gross_profit],
                        ["Operating expenses", branchOverviewQuery.data.total.operating_expenses],
                        ["Other expenses", branchOverviewQuery.data.total.other_expenses],
                        ["Net profit / loss", branchOverviewQuery.data.total.net_profit],
                        ["Inventory at cost", branchOverviewQuery.data.inventory.cost_value],
                        ["Inventory at retail", branchOverviewQuery.data.inventory.retail_value],
                        ["Customer debt (current)", branchOverviewQuery.data.customer_outstanding],
                        ["Supplier debt (current)", branchOverviewQuery.data.supplier_outstanding],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">{label}</p>
                          <p className="mt-1 font-semibold">{formatMoney(Number(value), sym)}</p>
                        </div>
                      ))}
                    </div>
                    {branchOverviewQuery.data.branches.length === 0 ? (
                      <p className="rounded-md border p-4 text-sm text-muted-foreground">No branch figures match this selection and period.</p>
                    ) : (
                      <div className="grid gap-3 xl:grid-cols-2">
                        {branchOverviewQuery.data.branches.map((branch) => (
                          <div key={branch.id} className="space-y-3 rounded-lg border p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <h3 className="font-semibold">{branch.name}</h3>
                                <p className="text-xs text-muted-foreground">{branch.current_period.start_date} to {branch.current_period.end_date} · {branch.current_operating_days} operating days</p>
                              </div>
                              {branch.comparisons.sales.change_percent != null && (
                                <span className="rounded-full bg-muted px-2.5 py-1 text-xs">Sales per operating day: {Number(branch.comparisons.sales.change_percent).toFixed(1)}% vs prior period</span>
                              )}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-3">
                              {[
                                ["Net sales", branch.current.net_sales],
                                ["Gross profit", branch.current.gross_profit],
                                ["Net profit / loss", branch.current.net_profit],
                                ["Operating expenses", branch.current.operating_expenses],
                                ["Inventory at cost", branch.inventory.cost_value],
                                ["Customer debt (current)", branch.customer_outstanding],
                                ["Supplier debt (current)", branch.supplier_outstanding],
                                ["Stock in transit", String(branch.outgoing_stock_in_transit)],
                              ].map(([label, value]) => (
                                <div key={label} className="rounded-md bg-muted/50 p-2.5">
                                  <p className="text-xs text-muted-foreground">{label}</p>
                                  <p className="mt-1 text-sm font-medium">{label === "Stock in transit" ? value : formatMoney(Number(value), sym)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Reports;

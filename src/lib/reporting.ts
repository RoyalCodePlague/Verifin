import type { Customer, Discrepancy, Expense, Product, Sale, SupplyEntry } from "@/lib/store";

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type WeeklyFinancePoint = {
  day: string;
  sales: number;
  expenses: number;
};

export type FinancePeriod = "months" | "years";

export type PeriodFinancePoint = {
  period: string;
  sales: number;
  expenses: number;
};

export type WeeklyRevenueEntry = {
  date: string;
  total: number;
};

export type CashflowForecastPoint = {
  label: string;
  days: number;
  projectedIn: number;
  projectedOut: number;
  projectedNet: number;
};

export type DebtorFollowUp = {
  customer: string;
  phone: string;
  amount: number;
  ageDays: number;
  message: string;
};

export type ReorderSuggestion = {
  product: string;
  supplier: string;
  stock: number;
  reorderLevel: number;
  soldLast30: number;
  daysLeft: number | null;
  suggestedOrder: number;
};

export type ProfitLeak = {
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
  value?: number;
};

export type BusinessHealth = {
  score: number;
  label: string;
  summary: string;
  drivers: string[];
};

export type SupplyAmountEntry = {
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  currency: string;
  fxRateToBase?: number;
};

export function parseBusinessDate(value?: string): Date | null {
  if (!value) return null;
  if (value === "Today") return new Date();

  const normalized = value.includes("T") ? value : `${value}T12:00:00`;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const displayParsed = new Date(value);
  return Number.isNaN(displayParsed.getTime()) ? null : displayParsed;
}

export function isSameBusinessDay(value: string | undefined, reference = new Date()) {
  const parsed = parseBusinessDate(value);
  return !!parsed && parsed.toDateString() === reference.toDateString();
}

export function displayBusinessDate(value: string | undefined, reference = new Date()) {
  if (!value) return "";
  const parsed = parseBusinessDate(value);
  if (!parsed) return value;
  if (parsed.toDateString() === reference.toDateString()) return "Today";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function formatWeekBucket(date: Date) {
  return `${WEEK_DAYS[(date.getDay() + 6) % 7]} ${date.getDate()}`;
}

function buildRollingWeek(reference = new Date()) {
  const end = startOfDay(reference);
  const start = addDays(end, -6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const labels = new Map(
    days.map((date) => [startOfDay(date).getTime(), formatWeekBucket(date)])
  );

  return { start, end, labels };
}

export function buildWeeklyFinanceData(
  sales: Sale[],
  expenses: Expense[],
  reference = new Date(),
  extraRevenue: WeeklyRevenueEntry[] = []
): WeeklyFinancePoint[] {
  const { start, end, labels } = buildRollingWeek(reference);
  const totals = Object.fromEntries(
    Array.from(labels.values()).map((day) => [day, { sales: 0, expenses: 0 }])
  ) as Record<string, { sales: number; expenses: number }>;

  const resolveBucket = (value?: string) => {
    const date = parseBusinessDate(value);
    if (!date) return null;
    const normalized = startOfDay(date);
    if (normalized < start || normalized > end) return null;
    const key = labels.get(normalized.getTime());
    return key ? { date: normalized, key } : null;
  };

  sales.forEach((sale) => {
    const bucket = resolveBucket(sale.date);
    if (!bucket) return;
    totals[bucket.key].sales += sale.total;
  });

  extraRevenue.forEach((entry) => {
    const bucket = resolveBucket(entry.date);
    if (!bucket) return;
    totals[bucket.key].sales += entry.total;
  });

  expenses.forEach((expense) => {
    const bucket = resolveBucket(expense.date);
    if (!bucket) return;
    totals[bucket.key].expenses += expense.amountBase ?? expense.amount;
  });

  return Array.from(labels.values()).map((day) => ({
    day,
    sales: totals[day].sales,
    expenses: totals[day].expenses,
  }));
}

export function buildPeriodFinanceData(
  sales: Sale[],
  expenses: Expense[],
  period: FinancePeriod,
  reference = new Date(),
  extraRevenue: WeeklyRevenueEntry[] = []
): PeriodFinancePoint[] {
  const points = period === "months"
    ? Array.from({ length: 12 }, (_, index) => {
        const date = addMonths(reference, index - 11);
        return {
          key: `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`,
          label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        };
      })
    : Array.from({ length: 5 }, (_, index) => {
        const year = reference.getFullYear() - 4 + index;
        return { key: String(year), label: String(year) };
      });

  const labels = new Map(points.map((point) => [point.key, point.label]));
  const totals = Object.fromEntries(
    points.map((point) => [point.key, { sales: 0, expenses: 0 }])
  ) as Record<string, { sales: number; expenses: number }>;

  const resolveKey = (value?: string) => {
    const date = parseBusinessDate(value);
    if (!date) return null;
    return period === "months"
      ? `${date.getFullYear()}-${String(date.getMonth()).padStart(2, "0")}`
      : String(date.getFullYear());
  };

  sales.forEach((sale) => {
    const key = resolveKey(sale.date);
    if (!key || !totals[key]) return;
    totals[key].sales += sale.total;
  });

  extraRevenue.forEach((entry) => {
    const key = resolveKey(entry.date);
    if (!key || !totals[key]) return;
    totals[key].sales += entry.total;
  });

  expenses.forEach((expense) => {
    const key = resolveKey(expense.date);
    if (!key || !totals[key]) return;
    totals[key].expenses += expenseBaseAmount(expense);
  });

  return points.map((point) => ({
    period: labels.get(point.key) || point.key,
    sales: totals[point.key].sales,
    expenses: totals[point.key].expenses,
  }));
}

function daysAgo(days: number, reference = new Date()) {
  const date = startOfDay(reference);
  date.setDate(date.getDate() - days);
  return date;
}

function isWithinLastDays(value: string | undefined, days: number, reference = new Date()) {
  const parsed = parseBusinessDate(value);
  if (!parsed) return false;
  const normalized = startOfDay(parsed);
  return normalized >= daysAgo(days, reference) && normalized <= startOfDay(reference);
}

function saleUnitsByProduct(sales: Sale[], days = 30, reference = new Date()) {
  const totals: Record<string, number> = {};
  sales
    .filter((sale) => isWithinLastDays(sale.date, days, reference))
    .forEach((sale) => {
      if (sale.saleItems?.length) {
        sale.saleItems.forEach((item) => {
          const key = item.productName.trim().toLowerCase();
          totals[key] = (totals[key] || 0) + item.quantity;
        });
        return;
      }

      sale.items.split(",").forEach((item) => {
        const trimmed = item.trim();
        if (!trimmed) return;
        const parsed = trimmed.match(/^(\d+)\s*(.+)$/);
        const quantity = parsed ? Number(parsed[1]) : 1;
        const name = parsed ? parsed[2].trim() : trimmed;
        if (!name) return;
        const key = name.toLowerCase();
        totals[key] = (totals[key] || 0) + quantity;
      });
    });
  return totals;
}

export function buildReorderSuggestions(products: Product[], sales: Sale[], reference = new Date()): ReorderSuggestion[] {
  const unitsSold = saleUnitsByProduct(sales, 30, reference);

  return products
    .map((product) => {
      const soldLast30 = unitsSold[product.name.toLowerCase()] || 0;
      const dailyVelocity = soldLast30 / 30;
      const daysLeft = dailyVelocity > 0 ? Math.floor(product.stock / dailyVelocity) : null;
      const targetStock = Math.max(product.reorder * 2, Math.ceil(dailyVelocity * 21));
      const suggestedOrder = Math.max(0, targetStock - product.stock);
      return {
        product: product.name,
        supplier: product.supplierName || "No supplier set",
        stock: product.stock,
        reorderLevel: product.reorder,
        soldLast30,
        daysLeft,
        suggestedOrder,
      };
    })
    .filter((item) => item.suggestedOrder > 0 && (item.stock <= item.reorder || (item.daysLeft != null && item.daysLeft <= 14)))
    .sort((a, b) => {
      const aDays = a.daysLeft ?? 999;
      const bDays = b.daysLeft ?? 999;
      return aDays - bDays || b.soldLast30 - a.soldLast30;
    })
    .slice(0, 6);
}

export function buildDebtorFollowUps(customers: Customer[], symbol: string): DebtorFollowUp[] {
  return customers
    .filter((customer) => (customer.debtAmount || 0) > 0)
    .map((customer) => {
      const started = customer.debtStartedAt ? parseBusinessDate(customer.debtStartedAt) : null;
      const ageDays = started ? Math.max(0, Math.floor((Date.now() - started.getTime()) / 86400000)) : 0;
      const amount = customer.debtAmount || 0;
      const message = `Hi ${customer.name}, quick reminder that your Verifin balance is ${formatMoney(amount, symbol)}${ageDays ? ` from ${ageDays} day${ageDays === 1 ? "" : "s"} ago` : ""}. Please settle when you can.`;
      return { customer: customer.name, phone: customer.phone, amount, ageDays, message };
    })
    .sort((a, b) => b.ageDays - a.ageDays || b.amount - a.amount)
    .slice(0, 6);
}

export function buildCashflowForecast(
  sales: Sale[],
  expenses: Expense[],
  customers: Customer[],
  supplyEntries: SupplyEntry[],
  baseCurrency: string,
  reference = new Date()
): CashflowForecastPoint[] {
  const recentSales = sales
    .filter((sale) => isWithinLastDays(sale.date, 30, reference))
    .reduce((sum, sale) => sum + sale.total, 0);
  const recentSupplyRevenue = supplyEntries
    .filter((entry) => entry.direction === "outgoing" && entry.paymentStatus === "paid" && isWithinLastDays(entry.movementDate, 30, reference))
    .reduce((sum, entry) => sum + supplyInvoiceAmountBase(entry, baseCurrency), 0);
  const recentExpenses = expenses
    .filter((expense) => isWithinLastDays(expense.date, 30, reference))
    .reduce((sum, expense) => sum + expenseBaseAmount(expense), 0);
  const receivables = customers.reduce((sum, customer) => sum + (customer.debtAmount || 0), 0) + supplyEntries
    .filter((entry) => entry.direction === "outgoing" && entry.paymentStatus !== "paid")
    .reduce((sum, entry) => sum + supplyInvoiceAmountBase(entry, baseCurrency), 0);

  const dailyIn = (recentSales + recentSupplyRevenue) / 30;
  const dailyOut = recentExpenses / 30;
  const collectionRate = (days: number) => days <= 7 ? 0.15 : days <= 30 ? 0.35 : 0.6;

  return [
    { label: "7 days", days: 7 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ].map((point) => {
    const projectedIn = dailyIn * point.days + receivables * collectionRate(point.days);
    const projectedOut = dailyOut * point.days;
    return {
      ...point,
      projectedIn,
      projectedOut,
      projectedNet: projectedIn - projectedOut,
    };
  });
}

export function buildProfitLeaks(
  products: Product[],
  sales: Sale[],
  expenses: Expense[],
  customers: Customer[],
  discrepancies: Discrepancy[],
  symbol: string,
  reference = new Date()
): ProfitLeak[] {
  const leaks: ProfitLeak[] = [];
  const recentSales = sales.filter((sale) => isWithinLastDays(sale.date, 30, reference));
  const recentRevenue = recentSales.reduce((sum, sale) => sum + sale.total, 0);
  const recentExpenses = expenses.filter((expense) => isWithinLastDays(expense.date, 30, reference)).reduce((sum, expense) => sum + expenseBaseAmount(expense), 0);
  const expenseRatio = recentRevenue > 0 ? recentExpenses / recentRevenue : 0;
  const unitsSold = saleUnitsByProduct(sales, 30, reference);

  products.forEach((product) => {
    const margin = product.price > 0 ? (product.price - (product.costPrice || 0)) / product.price : 0;
    if (product.price > 0 && margin < 0.15) {
      leaks.push({
        title: `${product.name} has a thin margin`,
        detail: `Margin is ${(margin * 100).toFixed(1)}%. Review price or supplier cost.`,
        severity: margin < 0.05 ? "high" : "medium",
      });
    }

    const stockValue = product.stock * (product.costPrice || 0);
    if (stockValue >= 500 && !unitsSold[product.name.toLowerCase()]) {
      leaks.push({
        title: `${product.name} may be tying up cash`,
        detail: `${formatMoney(stockValue, symbol)} in stock with no recorded sales in 30 days.`,
        severity: stockValue >= 2000 ? "high" : "medium",
        value: stockValue,
      });
    }
  });

  if (expenseRatio > 0.55) {
    leaks.push({
      title: "Expenses are eating into revenue",
      detail: `Last 30 days expenses are ${(expenseRatio * 100).toFixed(0)}% of sales.`,
      severity: expenseRatio > 0.8 ? "high" : "medium",
    });
  }

  const openDiscrepancies = discrepancies.filter((item) => item.status !== "resolved").length;
  if (openDiscrepancies > 0) {
    leaks.push({
      title: "Stock discrepancies need closure",
      detail: `${openDiscrepancies} unresolved discrepancy${openDiscrepancies === 1 ? "" : "ies"} can hide shrinkage.`,
      severity: openDiscrepancies > 3 ? "high" : "medium",
    });
  }

  const overdueDebt = customers.filter((customer) => (customer.debtAmount || 0) > 0 && customer.debtStartedAt && parseBusinessDate(customer.debtStartedAt) && ((Date.now() - parseBusinessDate(customer.debtStartedAt)!.getTime()) / 86400000) >= 30);
  if (overdueDebt.length) {
    leaks.push({
      title: "Old customer debt is building up",
      detail: `${overdueDebt.length} customer${overdueDebt.length === 1 ? "" : "s"} owe money for 30+ days.`,
      severity: "high",
    });
  }

  return leaks.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity];
  }).slice(0, 8);
}

export function buildBusinessHealthScore(params: {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  discrepancies: Discrepancy[];
  cashflow: CashflowForecastPoint[];
}) {
  let score = 100;
  const drivers: string[] = [];
  const revenue30 = params.sales.filter((sale) => isWithinLastDays(sale.date, 30)).reduce((sum, sale) => sum + sale.total, 0);
  const expenses30 = params.expenses.filter((expense) => isWithinLastDays(expense.date, 30)).reduce((sum, expense) => sum + expenseBaseAmount(expense), 0);
  const lowStockRatio = params.products.length ? params.products.filter((product) => product.status === "low" || product.status === "out").length / params.products.length : 0;
  const openDiscrepancies = params.discrepancies.filter((item) => item.status !== "resolved").length;
  const overdueDebt = params.customers.filter((customer) => (customer.debtAmount || 0) > 0 && customer.debtStartedAt && parseBusinessDate(customer.debtStartedAt) && ((Date.now() - parseBusinessDate(customer.debtStartedAt)!.getTime()) / 86400000) >= 30).length;
  const expenseRatio = revenue30 > 0 ? expenses30 / revenue30 : 0;
  const cash90 = params.cashflow.find((point) => point.days === 90)?.projectedNet ?? 0;

  if (expenseRatio > 0.6) {
    const penalty = expenseRatio > 0.9 ? 20 : 12;
    score -= penalty;
    drivers.push("Expense ratio is high");
  }
  if (lowStockRatio > 0.2) {
    score -= Math.min(18, Math.round(lowStockRatio * 40));
    drivers.push("Many products are low or out of stock");
  }
  if (openDiscrepancies > 0) {
    score -= Math.min(15, openDiscrepancies * 3);
    drivers.push("Open stock discrepancies reduce confidence");
  }
  if (overdueDebt > 0) {
    score -= Math.min(15, overdueDebt * 5);
    drivers.push("Overdue customer debt needs follow-up");
  }
  if (cash90 < 0) {
    score -= 15;
    drivers.push("90-day cashflow is projected negative");
  }
  if (revenue30 <= 0 && params.sales.length === 0) {
    score -= 10;
    drivers.push("No recent sales data yet");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const label = finalScore >= 80 ? "Healthy" : finalScore >= 60 ? "Watchlist" : finalScore >= 40 ? "At Risk" : "Critical";
  return {
    score: finalScore,
    label,
    summary: finalScore >= 80 ? "The business looks stable right now." : "There are a few areas worth tightening.",
    drivers: drivers.length ? drivers : ["Margins, stock, debt, and cashflow look balanced"],
  } satisfies BusinessHealth;
}

export function expenseBaseAmount(expense: Expense) {
  return expense.amountBase ?? expense.amount;
}

export function supplyUnitPriceBase(entry: SupplyAmountEntry, baseCurrency: string) {
  if (entry.currency === baseCurrency) return entry.unitPrice;
  const fxRate = entry.fxRateToBase || 0;
  return fxRate > 0 ? entry.unitPrice * fxRate : entry.unitPrice;
}

export function supplyUnitCostBase(entry: SupplyAmountEntry, baseCurrency: string) {
  const unitCost = entry.unitCost ?? 0;
  if (entry.currency === baseCurrency) return unitCost;
  const fxRate = entry.fxRateToBase || 0;
  return fxRate > 0 ? unitCost * fxRate : unitCost;
}

export function supplyInvoiceAmountBase(entry: SupplyAmountEntry, baseCurrency: string) {
  return entry.quantity * supplyUnitPriceBase(entry, baseCurrency);
}

export function supplyInvoiceCostAmountBase(entry: SupplyAmountEntry, baseCurrency: string) {
  return entry.quantity * supplyUnitCostBase(entry, baseCurrency);
}

export function salePaymentBreakdown(sales: Sale[], baseCurrency = "ZAR") {
  const totals: Record<string, { amount: number; amountBase: number }> = {};

  sales.forEach((sale) => {
    const rows = sale.paymentAllocations?.length
      ? sale.paymentAllocations
      : [{ currency: sale.paymentCurrency || baseCurrency, amount: sale.total, amountBase: sale.total }];

    rows.forEach((row) => {
      const key = row.currency;
      if (!totals[key]) {
        totals[key] = { amount: 0, amountBase: 0 };
      }
      totals[key].amount += row.amount;
      totals[key].amountBase += row.amountBase ?? row.amount;
    });
  });

  return Object.entries(totals)
    .map(([currency, value]) => ({ currency, ...value }))
    .sort((a, b) => b.amountBase - a.amountBase);
}

export function formatMoney(value: number, symbol: string) {
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

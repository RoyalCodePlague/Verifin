import type { Expense, Sale } from "@/lib/store";

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type WeeklyFinancePoint = {
  day: string;
  sales: number;
  expenses: number;
};

export type WeeklyRevenueEntry = {
  date: string;
  total: number;
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

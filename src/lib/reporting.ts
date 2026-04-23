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

export function parseBusinessDate(value?: string): Date | null {
  if (!value) return null;
  if (value === "Today") return new Date();

  const normalized = value.includes("T") ? value : `${value}T12:00:00`;
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const displayParsed = new Date(value);
  return Number.isNaN(displayParsed.getTime()) ? null : displayParsed;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d;
}

function isSameWeek(date: Date, reference = new Date()) {
  return startOfWeek(date).getTime() === startOfWeek(reference).getTime();
}

function weekDayName(date: Date) {
  return WEEK_DAYS[(date.getDay() + 6) % 7];
}

export function buildWeeklyFinanceData(
  sales: Sale[],
  expenses: Expense[],
  reference = new Date(),
  extraRevenue: WeeklyRevenueEntry[] = []
): WeeklyFinancePoint[] {
  const totals = Object.fromEntries(
    WEEK_DAYS.map((day) => [day, { sales: 0, expenses: 0 }])
  ) as Record<string, { sales: number; expenses: number }>;

  sales.forEach((sale) => {
    const date = parseBusinessDate(sale.date);
    if (!date || !isSameWeek(date, reference)) return;
    totals[weekDayName(date)].sales += sale.total;
  });

  extraRevenue.forEach((entry) => {
    const date = parseBusinessDate(entry.date);
    if (!date || !isSameWeek(date, reference)) return;
    totals[weekDayName(date)].sales += entry.total;
  });

  expenses.forEach((expense) => {
    const date = parseBusinessDate(expense.date);
    if (!date || !isSameWeek(date, reference)) return;
    totals[weekDayName(date)].expenses += expense.amountBase ?? expense.amount;
  });

  return WEEK_DAYS.map((day) => ({
    day,
    sales: totals[day].sales,
    expenses: totals[day].expenses,
  }));
}

export function expenseBaseAmount(expense: Expense) {
  return expense.amountBase ?? expense.amount;
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

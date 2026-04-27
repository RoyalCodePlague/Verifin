import { fetchAllPages, fetchNotificationPreferencesApi } from "@/lib/api";
import type {
  Branch,
  Product,
  Sale,
  Expense,
  Customer,
  StaffMember,
  AuditRecord,
  Discrepancy,
  BusinessProfile,
} from "@/lib/store";

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function saleDisplayDate(dateStr: string, createdAt?: string) {
  const raw = dateStr || createdAt;
  if (!raw) return "Today";
  const d = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
  const t = new Date();
  if (d.toDateString() === t.toDateString()) return "Today";
  return fmtDate(raw);
}

function saleTime(timeStr: string, createdAt?: string) {
  if (timeStr) {
    const parts = timeStr.split(":");
    if (parts.length >= 2) {
      const d = new Date();
      d.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2] || "0", 10));
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  if (createdAt) return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return "";
}

type ApiProduct = {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  category_name?: string | null;
  branch?: number | null;
  branch_name?: string | null;
  preferred_supplier?: number | null;
  supplier_name?: string | null;
  stock: number;
  reorder_level: number;
  cost_price: string;
  cost_currency?: string;
  cost_fx_rate_to_base?: string;
  price: string;
  status: "ok" | "low" | "out";
  created_at?: string;
  updated_at?: string;
};

type ApiSale = {
  id: number;
  items: string;
  total: string;
  total_cost?: string;
  gross_profit?: string;
  payment_method: "Cash" | "EFT" | "Card";
  payment_currency?: string;
  payment_allocations?: Array<{ currency: string; amount: string; amount_base?: string }>;
  branch?: number | null;
  date: string;
  time: string;
  created_at?: string;
};

type ApiExpense = {
  id: number;
  description: string;
  amount: string;
  currency?: string;
  amount_base?: string;
  payment_allocations?: Array<{ currency: string; amount: string; amount_base?: string }>;
  date: string;
  category_name?: string | null;
};

type ApiCustomer = {
  id: number;
  name: string;
  phone: string;
  total_spent: string;
  visits: number;
  loyalty_points: number;
  qr_code: string;
  credits: string;
  last_visit: string | null;
  badge: Customer["badge"];
};

type ApiStaff = {
  id: number;
  name: string;
  role: StaffMember["role"];
  status: StaffMember["status"];
  last_active: string | null;
  branch?: number | null;
  branch_name?: string | null;
};

type ApiBranch = {
  id: number;
  name: string;
  code: string;
  phone: string;
  address: string;
  is_primary: boolean;
};

type ApiAudit = {
  id: number;
  date: string;
  status: "in_progress" | "completed";
  items_counted: number;
  discrepancies_found: number;
  completed_at: string | null;
};

type ApiDiscrepancy = {
  id: number;
  audit: number;
  product: number;
  product_name?: string;
  expected_stock: number;
  actual_stock: number;
  difference: number;
  status: Discrepancy["status"];
};

type ApiNotificationPreference = {
  id: number;
  whatsapp_daily: boolean;
  low_stock_alerts: boolean;
  discrepancy_alerts: boolean;
  push_enabled: boolean;
};

function readCachedArray<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`sp_${key}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readCachedProfile(): Partial<BusinessProfile> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem("sp_profile");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function loadServerData(user: {
  business_name: string;
  currency: string;
  currency_symbol: string;
  enabled_currencies?: string[];
  exchange_rates?: Record<string, number>;
  dark_mode: boolean;
  onboarding_complete: boolean;
}): Promise<{
  profile: BusinessProfile;
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  customers: Customer[];
  staff: StaffMember[];
  branches: Branch[];
  audits: AuditRecord[];
  discrepancies: Discrepancy[];
}> {
  const cachedProfile = readCachedProfile();

  // Helper function to safely fetch with fallback to the last local snapshot.
  const safeFetch = async <T,>(url: string, cacheKey: string): Promise<T[]> => {
    const cached = readCachedArray<T>(cacheKey);
    if (typeof navigator !== "undefined" && !navigator.onLine) return cached;
    try {
      return await fetchAllPages<T>(url);
    } catch (error) {
      console.warn(`Failed to fetch ${url}:`, error);
      return cached;
    }
  };

  const safeFetchNotificationPreferences = async (): Promise<ApiNotificationPreference[]> => {
    try {
      return await fetchNotificationPreferencesApi();
    } catch (error) {
      console.warn("Failed to fetch notification preferences:", error);
      return [];
    }
  };

  const [rawBranches, rawProducts, rawSales, rawExpenses, rawCustomers, rawStaff, rawAudits, rawDiscrepancies, rawNotificationPreferences] =
    await Promise.all([
      safeFetch<ApiBranch>("/api/v1/inventory/branches/", "branches"),
      safeFetch<ApiProduct>("/api/v1/inventory/products/", "products"),
      safeFetch<ApiSale>("/api/v1/sales/", "sales"),
      safeFetch<ApiExpense>("/api/v1/expenses/", "expenses"),
      safeFetch<ApiCustomer>("/api/v1/customers/", "customers"),
      safeFetch<ApiStaff>("/api/v1/accounts/staff/", "staff"),
      safeFetch<ApiAudit>("/api/v1/audits/", "audits"),
      safeFetch<ApiDiscrepancy>("/api/v1/audits/discrepancies/", "discrepancies"),
      safeFetchNotificationPreferences(),
    ]);

  const productNameById = new Map<number, string>();
  rawProducts.forEach((p) => productNameById.set(p.id, p.name));

  const branches: Branch[] = rawBranches.map((b) => ({
    id: String(b.id),
    name: b.name,
    code: b.code || "",
    phone: b.phone || "",
    address: b.address || "",
    isPrimary: b.is_primary,
  }));

  const products: Product[] = rawProducts.map((p) => ({
    id: String(p.id),
    name: p.name,
    sku: p.sku,
    category: p.category_name || (p as ApiProduct & Partial<Product>).category || "",
    branchId: p.branch ? String(p.branch) : (p as ApiProduct & Partial<Product>).branchId,
    branchName: p.branch_name || (p as ApiProduct & Partial<Product>).branchName || "",
    supplierId: p.preferred_supplier ? String(p.preferred_supplier) : (p as ApiProduct & Partial<Product>).supplierId,
    supplierName: p.supplier_name || (p as ApiProduct & Partial<Product>).supplierName || "",
    stock: p.stock,
    reorder: p.reorder_level ?? (p as ApiProduct & Partial<Product>).reorder ?? 0,
    costPrice: parseFloat(String(p.cost_price ?? (p as ApiProduct & Partial<Product>).costPrice ?? "0")),
    costCurrency: p.cost_currency || (p as ApiProduct & Partial<Product>).costCurrency || user.currency || "ZAR",
    costFxRateToBase: p.cost_fx_rate_to_base ? parseFloat(p.cost_fx_rate_to_base) : (p as ApiProduct & Partial<Product>).costFxRateToBase ?? 1,
    price: parseFloat(String(p.price ?? 0)),
    status: p.status,
    barcode: p.barcode || undefined,
    addedDate: fmtDate(p.created_at) || (p as ApiProduct & Partial<Product>).addedDate,
    lastRestocked: fmtDate(p.updated_at) || (p as ApiProduct & Partial<Product>).lastRestocked,
  }));

  const sales: Sale[] = rawSales.map((s) => ({
    id: String(s.id),
    items: s.items || "",
    total: parseFloat(String(s.total ?? 0)),
    totalCost: parseFloat(String(s.total_cost ?? (s as ApiSale & Partial<Sale>).totalCost ?? "0")),
    grossProfit: parseFloat(String(s.gross_profit ?? (s as ApiSale & Partial<Sale>).grossProfit ?? "0")),
    time: saleTime(s.time, s.created_at) || (s as ApiSale & Partial<Sale>).time || "",
    date: saleDisplayDate(s.date, s.created_at) || (s as ApiSale & Partial<Sale>).date || "",
    method: s.payment_method || (s as ApiSale & Partial<Sale>).method || "Cash",
    paymentCurrency: s.payment_currency || (s as ApiSale & Partial<Sale>).paymentCurrency || user.currency || "ZAR",
    paymentAllocations: (s.payment_allocations || (s as ApiSale & Partial<Sale>).paymentAllocations || []).map((row) => ({
      currency: row.currency,
      amount: parseFloat(String(row.amount)),
      amountBase: parseFloat(String(row.amount_base || (row as { amountBase?: number }).amountBase || "0")),
    })),
    branchId: s.branch ? String(s.branch) : undefined,
  }));

  const todayStr = new Date().toISOString().slice(0, 10);
  const expenses: Expense[] = rawExpenses.map((e) => ({
    id: String(e.id),
    desc: e.description || (e as ApiExpense & Partial<Expense>).desc || "",
    amount: parseFloat(String(e.amount ?? 0)),
    currency: e.currency || (e as ApiExpense & Partial<Expense>).currency || user.currency || "ZAR",
    amountBase: parseFloat(String(e.amount_base || (e as ApiExpense & Partial<Expense>).amountBase || e.amount || "0")),
    paymentAllocations: (e.payment_allocations || (e as ApiExpense & Partial<Expense>).paymentAllocations || []).map((row) => ({
      currency: row.currency,
      amount: parseFloat(String(row.amount)),
      amountBase: parseFloat(String(row.amount_base || (row as { amountBase?: number }).amountBase || "0")),
    })),
    date: e.date === todayStr ? "Today" : e.date,
    category: e.category_name || (e as ApiExpense & Partial<Expense>).category || "Other",
  }));

  const customers: Customer[] = rawCustomers.map((c) => ({
    id: String(c.id),
    name: c.name,
    phone: c.phone,
    totalSpent: parseFloat(String(c.total_spent ?? (c as ApiCustomer & Partial<Customer>).totalSpent ?? 0)),
    visits: c.visits,
    loyaltyPoints: c.loyalty_points ?? (c as ApiCustomer & Partial<Customer>).loyaltyPoints ?? 0,
    qrCode: String(c.qr_code || (c as ApiCustomer & Partial<Customer>).qrCode || ""),
    credits: parseFloat(String(c.credits ?? 0)),
    lastVisit: c.last_visit ? fmtDate(c.last_visit) : (c as ApiCustomer & Partial<Customer>).lastVisit || "",
    badge: c.badge,
  }));

  const staff: StaffMember[] = rawStaff.map((s) => ({
    id: String(s.id),
    name: s.name,
    role: s.role,
    status: s.status,
    lastActive: s.last_active ? fmtDate(s.last_active) : (s as ApiStaff & Partial<StaffMember>).lastActive || "",
    branchId: s.branch ? String(s.branch) : undefined,
    branchName: s.branch_name || "",
  }));

  const audits: AuditRecord[] = rawAudits.map((a) => ({
    id: String(a.id),
    date: fmtDate(a.date) || a.date,
    status: a.status,
    items: a.items_counted ?? (a as ApiAudit & Partial<AuditRecord>).items ?? 0,
    discrepancies: a.discrepancies_found ?? (a as ApiAudit & Partial<AuditRecord>).discrepancies ?? 0,
    conductor: (a as ApiAudit & Partial<AuditRecord>).conductor || "",
    autoFindings: (a as ApiAudit & Partial<AuditRecord>).autoFindings || [],
  }));

  const discrepancies: Discrepancy[] = rawDiscrepancies.map((d) => ({
    id: String(d.id),
    auditId: d.audit ? String(d.audit) : (d as ApiDiscrepancy & Partial<Discrepancy>).auditId,
    product: d.product_name || productNameById.get(d.product) || (d as ApiDiscrepancy & Partial<Discrepancy>).product || `Product #${d.product}`,
    expected: d.expected_stock ?? (d as ApiDiscrepancy & Partial<Discrepancy>).expected ?? 0,
    actual: d.actual_stock ?? (d as ApiDiscrepancy & Partial<Discrepancy>).actual ?? 0,
    diff: d.difference ?? (d as ApiDiscrepancy & Partial<Discrepancy>).diff ?? 0,
    status: d.status,
  }));

  const categoryNames = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));
  const notificationPreference = rawNotificationPreferences[0];

  const profile: BusinessProfile = {
    name: user.business_name || "",
    currency: user.currency || "ZAR",
    currencySymbol: user.currency_symbol || "R",
    enabledCurrencies: user.enabled_currencies?.length ? user.enabled_currencies : [user.currency || "ZAR"],
    exchangeRates: user.exchange_rates || {},
    categories: categoryNames.length ? categoryNames : cachedProfile.categories || ["Groceries", "Beverages", "Hardware", "Personal Care"],
    whatsappDaily: notificationPreference?.whatsapp_daily ?? cachedProfile.whatsappDaily ?? true,
    lowStockAlerts: notificationPreference?.low_stock_alerts ?? cachedProfile.lowStockAlerts ?? true,
    discrepancyAlerts: notificationPreference?.discrepancy_alerts ?? cachedProfile.discrepancyAlerts ?? true,
    onboardingComplete: user.onboarding_complete,
    darkMode: user.dark_mode,
  };

  return { profile, branches, products, sales, expenses, customers, staff, audits, discrepancies };
}

import type { Product } from "@/lib/store";

const ACCESS_KEY = "sp_access_token";
const REFRESH_KEY = "sp_refresh_token";

export const apiBase = () => (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = apiBase();
  if (!base && import.meta.env.PROD && p.startsWith("/api/")) {
    throw new Error("Production API URL is not configured. Set VITE_API_URL to your Railway backend URL in Vercel.");
  }
  return base ? `${base.replace(/\/$/, "")}${p}` : p;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const res = await fetch(apiUrl("/api/v1/accounts/token/refresh/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = (await res.json()) as { access: string };
  localStorage.setItem(ACCESS_KEY, data.access);
  return data.access;
}

export type ApiUser = {
  id: number;
  email: string;
  username: string;
  phone: string;
  business_name: string;
  currency: string;
  currency_symbol: string;
  dark_mode: boolean;
  onboarding_complete: boolean;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  const body = options.body;
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const access = options.skipAuth ? null : getAccessToken();

  const doFetch = async (token: string | null) => {
    const h = new Headers(headers);
    if (token) h.set("Authorization", `Bearer ${token}`);
    return fetch(apiUrl(path), { ...options, headers: h });
  };

  let res = await doFetch(access);
  if (res.status === 401 && !options.skipAuth) {
    const newAccess = await refreshAccessToken();
    if (newAccess) res = await doFetch(newAccess);
  }

  if (!res.ok) {
    let detail = res.statusText;
    let payload: unknown;
    try {
      const err = (await res.json()) as { detail?: string | string[]; non_field_errors?: string[] };
      payload = err;
      if (Array.isArray(err.detail)) {
        detail = err.detail.join(" ");
      } else {
        detail = err.detail || err.non_field_errors?.[0] || JSON.stringify(err);
      }
    } catch {
      /* ignore */
    }
    const apiError = new Error(detail || `Request failed: ${res.status}`);
    (apiError as Error & { payload?: unknown }).payload = payload;
    throw apiError;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function loginRequest(email: string, password: string) {
  return apiFetch<{ access: string; refresh: string }>("/api/v1/accounts/login/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({ email, password }),
  });
}

export async function registerRequest(body: {
  email: string;
  password: string;
  phone?: string;
  business_name?: string;
}) {
  return apiFetch<{ access: string; refresh: string; user: ApiUser }>("/api/v1/accounts/register/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify(body),
  });
}

export async function verifyEmailRequest(token: string) {
  return apiFetch<{ detail: string }>("/api/v1/accounts/verify-email/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({ token }),
  });
}

export async function resendVerificationRequest(email: string) {
  return apiFetch<{ detail: string }>("/api/v1/accounts/resend-verification/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify({ email }),
  });
}

export async function fetchMe(): Promise<ApiUser> {
  return apiFetch<ApiUser>("/api/v1/accounts/me/");
}

export async function patchMe(data: Partial<ApiUser>): Promise<ApiUser> {
  return apiFetch<ApiUser>("/api/v1/accounts/me/", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function logoutRequest() {
  const refresh = getRefreshToken();
  if (!refresh) return;
  try {
    await apiFetch("/api/v1/accounts/logout/", {
      method: "POST",
      body: JSON.stringify({ refresh }),
    });
  } catch {
    /* ignore */
  }
}

function normalizeApiPath(next: string | null): string | null {
  if (!next) return null;
  try {
    if (next.startsWith("http")) {
      const u = new URL(next);
      return u.pathname + u.search;
    }
    return next.startsWith("/") ? next : `/${next}`;
  } catch {
    return next.startsWith("/") ? next : `/${next}`;
  }
}

export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = path.startsWith("/") ? path : `/${path}`;
  while (url) {
    const res = await apiFetch<{ next: string | null; results: T[] } | T[]>(url);
    if (Array.isArray(res)) {
      return res;
    }
    out.push(...(res.results || []));
    url = normalizeApiPath(res.next);
  }
  return out;
}

type ApiCategory = { id: number; name: string };
export type ApiProduct = {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  category: number | null;
  category_name?: string | null;
  branch: number | null;
  branch_name?: string | null;
  preferred_supplier?: number | null;
  supplier_name?: string | null;
  stock: number;
  reorder_level: number;
  cost_price: string;
  price: string;
  status: "ok" | "low" | "out";
  created_at?: string;
  updated_at?: string;
};

function fmtShort(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function mapProductResponse(p: ApiProduct): Product {
  return {
    id: String(p.id),
    name: p.name,
    sku: p.sku,
    category: p.category_name || "",
    branchId: p.branch ? String(p.branch) : undefined,
    branchName: p.branch_name || "",
    supplierId: p.preferred_supplier ? String(p.preferred_supplier) : undefined,
    supplierName: p.supplier_name || "",
    stock: p.stock,
    reorder: p.reorder_level,
    costPrice: parseFloat(p.cost_price || "0"),
    price: parseFloat(p.price),
    status: p.status,
    barcode: p.barcode || undefined,
    addedDate: fmtShort(p.created_at),
    lastRestocked: fmtShort(p.updated_at),
  };
}

export async function listInventoryCategories(): Promise<ApiCategory[]> {
  return fetchAllPages<ApiCategory>("/api/v1/inventory/categories/");
}

export async function createInventoryCategory(name: string): Promise<ApiCategory> {
  return apiFetch<ApiCategory>("/api/v1/inventory/categories/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function ensureInventoryCategoryId(categoryName: string): Promise<number | null> {
  const trimmed = categoryName.trim();
  if (!trimmed) return null;
  const cats = await listInventoryCategories();
  const found = cats.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (found) return found.id;
  const created = await createInventoryCategory(trimmed);
  return created.id;
}

export async function createProductApi(payload: {
  name: string;
  sku: string;
  barcode?: string;
  categoryName: string;
  stock: number;
  reorder_level: number;
  cost_price: number;
  price: number;
  branch?: string;
  preferred_supplier?: string;
}) {
  const categoryId = await ensureInventoryCategoryId(payload.categoryName);
  const body: Record<string, unknown> = {
    name: payload.name,
    sku: payload.sku,
    barcode: payload.barcode || "",
    stock: payload.stock,
    reorder_level: payload.reorder_level,
    cost_price: payload.cost_price.toFixed(2),
    price: payload.price.toFixed(2),
  };
  if (payload.branch) body.branch = Number(payload.branch);
  if (payload.preferred_supplier) body.preferred_supplier = Number(payload.preferred_supplier);
  if (categoryId != null) body.category = categoryId;
  return apiFetch<ApiProduct>("/api/v1/inventory/products/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateProductApi(
  id: string,
  payload: Partial<{
    name: string;
    sku: string;
    barcode: string;
    categoryName: string;
    stock: number;
    reorder_level: number;
    cost_price: number;
    price: number;
    branch: string;
    preferred_supplier: string;
  }>
) {
  const body: Record<string, unknown> = {};
  if (payload.name != null) body.name = payload.name;
  if (payload.sku != null) body.sku = payload.sku;
  if (payload.barcode != null) body.barcode = payload.barcode;
  if (payload.stock != null) body.stock = payload.stock;
  if (payload.reorder_level != null) body.reorder_level = payload.reorder_level;
  if (payload.cost_price != null) body.cost_price = Number(payload.cost_price).toFixed(2);
  if (payload.price != null) body.price = Number(payload.price).toFixed(2);
  if (payload.branch != null) body.branch = payload.branch ? Number(payload.branch) : null;
  if (payload.preferred_supplier != null) body.preferred_supplier = payload.preferred_supplier ? Number(payload.preferred_supplier) : null;
  if (payload.categoryName != null) {
    const cid = await ensureInventoryCategoryId(payload.categoryName);
    if (cid != null) body.category = cid;
  }
  return apiFetch<ApiProduct>(`/api/v1/inventory/products/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteProductApi(id: string) {
  await apiFetch(`/api/v1/inventory/products/${id}/`, { method: "DELETE" });
}

export type ApiBranch = {
  id: number;
  name: string;
  code: string;
  phone: string;
  address: string;
  is_primary: boolean;
};

export async function listBranchesApi(): Promise<ApiBranch[]> {
  return fetchAllPages<ApiBranch>("/api/v1/inventory/branches/");
}

export async function createBranchApi(payload: Omit<ApiBranch, "id">) {
  return apiFetch<ApiBranch>("/api/v1/inventory/branches/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateBranchApi(id: string, payload: Partial<Omit<ApiBranch, "id">>) {
  return apiFetch<ApiBranch>(`/api/v1/inventory/branches/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteBranchApi(id: string) {
  await apiFetch(`/api/v1/inventory/branches/${id}/`, { method: "DELETE" });
}

export type ApiForecastItem = {
  product: ApiProduct;
  sold_in_period: number;
  average_daily_sales: number;
  days_remaining: number | null;
  suggested_reorder: number;
  risk: "stockout" | "high" | "low";
};

export type ApiSupplier = {
  id: number;
  name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

export async function listSuppliersApi(): Promise<ApiSupplier[]> {
  return fetchAllPages<ApiSupplier>("/api/v1/inventory/suppliers/");
}

export async function createSupplierApi(payload: Omit<ApiSupplier, "id">) {
  return apiFetch<ApiSupplier>("/api/v1/inventory/suppliers/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateSupplierApi(id: string, payload: Partial<Omit<ApiSupplier, "id">>) {
  return apiFetch<ApiSupplier>(`/api/v1/inventory/suppliers/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteSupplierApi(id: string) {
  await apiFetch(`/api/v1/inventory/suppliers/${id}/`, { method: "DELETE" });
}

export type ApiPurchaseOrderItem = {
  id?: number;
  product: number;
  product_name?: string;
  sku?: string;
  quantity_ordered: number;
  quantity_received?: number;
  unit_cost: string;
  line_total?: string;
};

export type ApiPurchaseOrder = {
  id: number;
  supplier: number;
  supplier_name?: string;
  branch?: number | null;
  branch_name?: string | null;
  order_number: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  expected_date?: string | null;
  notes: string;
  total_cost: string;
  items: ApiPurchaseOrderItem[];
  created_at?: string;
};

export async function listPurchaseOrdersApi(): Promise<ApiPurchaseOrder[]> {
  return fetchAllPages<ApiPurchaseOrder>("/api/v1/inventory/purchase-orders/");
}

export async function createPurchaseOrderApi(payload: {
  supplier: number;
  branch?: number | null;
  expected_date?: string | null;
  notes?: string;
  status?: ApiPurchaseOrder["status"];
  items: Omit<ApiPurchaseOrderItem, "id" | "product_name" | "sku" | "line_total">[];
}) {
  return apiFetch<ApiPurchaseOrder>("/api/v1/inventory/purchase-orders/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function receivePurchaseOrderApi(id: number) {
  return apiFetch<ApiPurchaseOrder>(`/api/v1/inventory/purchase-orders/${id}/receive/`, { method: "POST" });
}

export async function fetchPurchaseSuggestions(days = 7) {
  return apiFetch<{ horizon_days: number; items: Array<{ product: ApiProduct; supplier: ApiSupplier | null; average_daily_sales: number; suggested_quantity: number; estimated_cost: string }> }>(`/api/v1/inventory/purchase-orders/suggestions/?days=${days}`);
}

export async function fetchInventoryForecast(days = 7) {
  return apiFetch<{ horizon_days: number; items: ApiForecastItem[] }>(`/api/v1/inventory/products/forecast/?days=${days}`);
}

type ApiSale = {
  id: number;
  items: string;
  total: string;
  total_cost?: string;
  gross_profit?: string;
  payment_method: string;
  branch?: number | null;
  date: string;
  time: string;
  created_at?: string;
};

export async function createSaleApi(payload: {
  payment_method: string;
  branch?: number | null;
  till_session?: number | null;
  customer: number | null;
  sale_items: { product: number; quantity: number; unit_price: string; subtotal: string }[];
}) {
  return apiFetch<ApiSale>("/api/v1/sales/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSaleApi(id: string) {
  await apiFetch(`/api/v1/sales/${id}/`, { method: "DELETE" });
}

export type ApiTillSession = {
  id: number;
  branch: number | null;
  cashier_name: string;
  opening_cash: string;
  closing_cash: string;
  expected_cash: string;
  cash_variance: string;
  card_total: string;
  eft_total: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  notes: string;
  sales_total?: string;
  cash_sales?: string;
};

export async function listTillSessionsApi() {
  return fetchAllPages<ApiTillSession>("/api/v1/sales/tills/");
}

export async function getCurrentTillApi() {
  return apiFetch<ApiTillSession>("/api/v1/sales/tills/current/");
}

export async function openTillApi(payload: { branch?: number | null; cashier_name: string; opening_cash: string }) {
  return apiFetch<ApiTillSession>("/api/v1/sales/tills/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function closeTillApi(id: number, payload: { closing_cash: string; notes?: string }) {
  return apiFetch<ApiTillSession>(`/api/v1/sales/tills/${id}/close/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchReceiptApi(id: string) {
  return apiFetch<{
    receipt_number: string;
    invoice_number: string;
    business_name: string;
    branch: string;
    date: string;
    time: string;
    payment_method: string;
    items: Array<{ id: number; product: number; product_name?: string; quantity: number; unit_price: string; subtotal: string }>;
    subtotal: string;
    total: string;
    customer: string;
  }>(`/api/v1/sales/${id}/receipt/`);
}

type ApiExpenseCategory = { id: number; name: string };

export async function listExpenseCategories(): Promise<ApiExpenseCategory[]> {
  return fetchAllPages<ApiExpenseCategory>("/api/v1/expenses/categories/");
}

export async function ensureExpenseCategoryId(name: string): Promise<number | null> {
  const trimmed = name.trim() || "Other";
  const cats = await listExpenseCategories();
  const found = cats.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (found) return found.id;
  const created = await apiFetch<ApiExpenseCategory>("/api/v1/expenses/categories/", {
    method: "POST",
    body: JSON.stringify({ name: trimmed }),
  });
  return created.id;
}

export async function createExpenseApi(payload: { description: string; amount: number; categoryName: string; date: string }) {
  const categoryId = await ensureExpenseCategoryId(payload.categoryName);
  return apiFetch("/api/v1/expenses/", {
    method: "POST",
    body: JSON.stringify({
      description: payload.description,
      amount: payload.amount.toFixed(2),
      category: categoryId,
      date: payload.date,
    }),
  });
}

export async function deleteExpenseApi(id: string) {
  await apiFetch(`/api/v1/expenses/${id}/`, { method: "DELETE" });
}

type ApiOfflineAction = {
  id: string;
  type:
    | "sale"
    | "expense"
    | "product_create"
    | "product_update"
    | "product_delete"
    | "restock"
    | "customer_update"
    | "audit_create"
    | "audit_update"
    | "discrepancy_create"
    | "discrepancy_resolve";
  payload: Record<string, unknown>;
  timestamp: number;
};

export async function pushOfflineActions(actions: ApiOfflineAction[]) {
  return apiFetch<{ processed: number; conflicts?: number[]; errors?: unknown[]; resolution: string }>("/api/v1/sync/push/", {
    method: "POST",
    body: JSON.stringify({ actions }),
  });
}

export type ApiSyncConflict = {
  id: number;
  action_id: string;
  action_type: string;
  payload: Record<string, unknown>;
  reason: string;
  status: "open" | "resolved" | "ignored";
  resolution_note: string;
  created_at: string;
  updated_at: string;
};

export async function listSyncConflicts(status = "open") {
  return fetchAllPages<ApiSyncConflict>(`/api/v1/sync/conflicts/?status=${status}`);
}

export async function resolveSyncConflict(id: number, resolution_note = "") {
  return apiFetch<ApiSyncConflict>(`/api/v1/sync/conflicts/${id}/resolve/`, {
    method: "POST",
    body: JSON.stringify({ status: "resolved", resolution_note }),
  });
}

export type PlanCode = "starter" | "growth" | "business";
export type BillingPeriod = "monthly" | "yearly";

export type FeatureLimit = {
  key: string;
  label: string;
  enabled: boolean;
  limit: number | null;
  unit: string;
  used?: number | null;
  remaining?: number | null;
};

export type BillingPlan = {
  id: number;
  code: PlanCode;
  name: string;
  description: string;
  monthly_price: string;
  yearly_price: string;
  currency: string;
  sort_order: number;
  limits: FeatureLimit[];
};

export type BillingSubscription = {
  id: number;
  plan: BillingPlan;
  status: "active" | "trialing" | "past_due" | "cancelled" | "expired";
  billing_period: BillingPeriod;
  provider: string;
  current_period_start: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  grace_period_ends_at: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  ended_at: string | null;
};

export type BillingOverview = {
  subscription: BillingSubscription;
  plan: BillingPlan;
  limits: FeatureLimit[];
  locked_features: FeatureLimit[];
  events: Array<{ id: number; event_type: string; provider: string; metadata: Record<string, unknown>; created_at: string }>;
  cycles: Array<{ id: number; period_start: string; period_end: string; amount: string; currency: string; paid_at: string | null; status: string }>;
  available_actions: string[];
};

export async function listBillingPlansApi() {
  return fetchAllPages<BillingPlan>("/api/v1/billing/plans/");
}

export async function getBillingOverviewApi() {
  return apiFetch<BillingOverview>("/api/v1/billing/subscriptions/current/");
}

export async function mockCheckoutApi(payload: { plan: PlanCode; billing_period: BillingPeriod; trial_days?: number }) {
  return apiFetch<{ detail: string; subscription: BillingSubscription; billing: BillingOverview }>("/api/v1/billing/subscriptions/mock-checkout/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function mockTrialApi(payload: { plan: PlanCode; billing_period: BillingPeriod; trial_days?: number }) {
  return apiFetch<BillingOverview>("/api/v1/billing/subscriptions/mock-trial/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function subscriptionActionApi(action: "renew" | "upgrade" | "downgrade" | "cancel" | "resume" | "expire", payload: Record<string, unknown> = {}) {
  return apiFetch<BillingOverview>(`/api/v1/billing/subscriptions/${action}/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

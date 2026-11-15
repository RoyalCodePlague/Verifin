import type { Product, SupplyEntry } from "@/lib/store";
import { markNetworkAvailable, markNetworkUnavailable } from "@/lib/offlineQueue";

const ACCESS_KEY = "sp_access_token";
const REFRESH_KEY = "sp_refresh_token";
const AUTH_EXPIRED_EVENT = "verifin:auth-expired";
const API_REQUEST_TIMEOUT_MS = 12000;

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

function notifyAuthExpired() {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

export function onAuthExpired(handler: () => void) {
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    markNetworkAvailable();
    return response;
  } catch (error) {
    if (timedOut || error instanceof TypeError) markNetworkUnavailable();
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const res = await fetchWithTimeout(apiUrl("/api/v1/accounts/token/refresh/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const data = (await res.json()) as { access: string; refresh?: string };
  localStorage.setItem(ACCESS_KEY, data.access);
  if (data.refresh) localStorage.setItem(REFRESH_KEY, data.refresh);
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
  enabled_currencies: string[];
  exchange_rates: Record<string, number>;
  dark_mode: boolean;
  onboarding_complete: boolean;
  business_code?: string;
};

export type StaffSession = {
  id: number;
  name: string;
  username: string;
  role: "Owner" | "Administrator" | "Branch Manager" | "Manager" | "Accountant" | "Inventory Manager" | "Stock Manager" | "Salesperson" | "Cashier" | "Custom";
  permissions: string[];
  business_code: string;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  const body = options.body;
  const { skipAuth, timeoutMs = API_REQUEST_TIMEOUT_MS, ...requestOptions } = options;
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const access = skipAuth ? null : getAccessToken();

  const doFetch = async (token: string | null) => {
    const h = new Headers(headers);
    if (token) h.set("Authorization", `Bearer ${token}`);
    return fetchWithTimeout(apiUrl(path), { ...requestOptions, headers: h }, timeoutMs);
  };

  let res = await doFetch(access);
  if (res.status === 401 && !skipAuth) {
    const newAccess = await refreshAccessToken();
    if (newAccess) res = await doFetch(newAccess);
    if (!newAccess || res.status === 401) {
      clearTokens();
      notifyAuthExpired();
    }
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
        detail = err.detail || err.non_field_errors?.[0] || formatApiError(err);
      }
    } catch {
      /* ignore */
    }
    const apiError = new Error(detail || `Request failed: ${res.status}`);
    (apiError as Error & { payload?: unknown }).payload = payload;
    (apiError as Error & { status?: number }).status = res.status;
    throw apiError;
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function formatApiError(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return payload.map(formatApiError).filter(Boolean).join(" ");
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  const messages = Object.entries(payload as Record<string, unknown>).flatMap(([key, value]) => {
    const message = formatApiError(value);
    return message ? [`${key}: ${message}`] : [];
  });
  return messages.join(" ") || JSON.stringify(payload);
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
  referral_code?: string;
}) {
  return apiFetch<{ verification_required: boolean; email_sent: boolean; email: string; detail: string }>("/api/v1/accounts/register/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify(body),
  });
}

export async function staffLoginRequest(payload: { business_code: string; username: string; password: string }) {
  return apiFetch<{ access: string; refresh: string; user: ApiUser; staff: StaffSession }>("/api/v1/accounts/staff-login/", {
    method: "POST",
    skipAuth: true,
    body: JSON.stringify(payload),
  });
}

export async function verifyEmailRequest(token: string) {
  return apiFetch<{ detail: string; access: string; refresh: string; user: ApiUser }>("/api/v1/accounts/verify-email/", {
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

export async function changePasswordRequest(payload: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}) {
  return apiFetch<{ detail: string }>("/api/v1/accounts/change-password/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function logoutOtherDevicesRequest() {
  return apiFetch<{ detail: string; revoked: number }>("/api/v1/accounts/logout-other-devices/", {
    method: "POST",
    body: JSON.stringify({ refresh: getRefreshToken() }),
  });
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
  cost_currency?: string;
  cost_fx_rate_to_base?: string;
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
    costCurrency: p.cost_currency || undefined,
    costFxRateToBase: p.cost_fx_rate_to_base ? parseFloat(p.cost_fx_rate_to_base) : undefined,
    // Treat an omitted/null price as zero. `parseFloat(undefined)` produces
    // NaN, which the sale form rejects with a misleading zero-price warning.
    price: parseFloat(String(p.price ?? 0)) || 0,
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
  categoryId?: number | null;
  stock: number;
  reorder_level: number;
  cost_price: number;
  price: number;
  branch?: string;
  preferred_supplier?: string;
}) {
  const categoryId = payload.categoryId ?? await ensureInventoryCategoryId(payload.categoryName);
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
    branch: string | null;
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
  if (Object.prototype.hasOwnProperty.call(payload, "branch")) body.branch = payload.branch ? Number(payload.branch) : null;
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

export type ApiStockTransfer = {
  id: number;
  from_branch: number;
  from_branch_name: string;
  to_branch: number;
  to_branch_name: string;
  product: number;
  product_name: string;
  target_product: number | null;
  batch: number | null;
  quantity: number;
  quantity_dispatched: number;
  quantity_received: number;
  quantity_discrepant: number;
  quantity_in_transit: number;
  status: "requested" | "approved" | "dispatched" | "partially_received" | "completed" | "rejected" | "cancelled";
  idempotency_key: string;
  discrepancy_note: string;
  note: string;
  events: Array<{ id: number; action: string; quantity: number; note: string; created_by: number; created_at: string }>;
  created_at: string;
};

export async function createStockTransferApi(payload: {
  product: number;
  to_branch: number;
  quantity: number;
  batch?: number;
  note?: string;
  idempotency_key: string;
}) {
  return apiFetch<ApiStockTransfer>("/api/v1/inventory/transfers/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateStockTransferApi(
  id: number,
  action: "approve" | "reject" | "cancel" | "dispatch" | "receive",
  payload: { quantity?: number; discrepant_quantity?: number; discrepancy_note?: string; note?: string } = {},
) {
  return apiFetch<ApiStockTransfer>(`/api/v1/inventory/transfers/${id}/${action}/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function transferProductApi(
  productId: string,
  payload: { to_branch: number; quantity: number; batch?: number; note?: string }
) {
  return apiFetch<{
    transfer: ApiStockTransfer;
    source: ApiProduct;
    target: ApiProduct | null;
  }>(`/api/v1/inventory/products/${productId}/transfer/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listStockTransfersApi() {
  return fetchAllPages<ApiStockTransfer>("/api/v1/inventory/transfers/");
}

export async function deleteProductApi(id: string) {
  await apiFetch(`/api/v1/inventory/products/${id}/`, { method: "DELETE" });
}

export type ApiProductBatch = {
  id: number;
  product: number;
  product_name: string;
  sku: string;
  batch_number: string;
  expiry_date: string | null;
  quantity_received: number;
  quantity_remaining: number;
  unit_cost_base: string;
  supplier: number | null;
  supplier_name: string | null;
  received_at: string;
};

export async function listProductBatchesApi() {
  return fetchAllPages<ApiProductBatch>("/api/v1/inventory/batches/");
}

export async function receiveProductBatchApi(payload: {
  product: number;
  batch_number: string;
  expiry_date?: string | null;
  quantity_received: number;
  unit_cost_base?: number;
  supplier?: number | null;
}) {
  return apiFetch<ApiProductBatch>("/api/v1/inventory/batches/receive/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiBranch = {
  id: number;
  name: string;
  code: string;
  phone: string;
  email: string;
  address: string;
  opening_date: string;
  manager: number | null;
  manager_name: string | null;
  is_primary: boolean;
};

export async function listBranchesApi(): Promise<ApiBranch[]> {
  return fetchAllPages<ApiBranch>("/api/v1/inventory/branches/");
}

export type ApiStaff = {
  id: number;
  name: string;
  role: "Owner" | "Administrator" | "Branch Manager" | "Cashier" | "Salesperson" | "Stock Manager" | "Inventory Manager" | "Accountant" | "Custom" | "Manager";
  status: "Active" | "Inactive";
  last_active?: string | null;
  username?: string;
  permissions?: string[];
  login_enabled?: boolean;
  branch?: number | null;
  branch_name?: string | null;
  temp_password?: string;
};

export async function createStaffApi(payload: Omit<ApiStaff, "id" | "branch_name">) {
  return apiFetch<ApiStaff>("/api/v1/accounts/staff/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateStaffApi(id: string, payload: Partial<Omit<ApiStaff, "id" | "branch_name">>) {
  return apiFetch<ApiStaff>(`/api/v1/accounts/staff/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteStaffApi(id: string) {
  await apiFetch(`/api/v1/accounts/staff/${id}/`, { method: "DELETE" });
}

export type ApiStaffActivityLog = {
  id: number;
  actor: number | null;
  actor_email: string | null;
  staff_actor: number | null;
  staff_actor_name: string | null;
  actor_name: string;
  action: string;
  object_type: string;
  object_id: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function listStaffActivityLogsApi() {
  return fetchAllPages<ApiStaffActivityLog>("/api/v1/accounts/activity-logs/");
}

export type ApiApprovalSettings = {
  discount_percent_threshold: string | null;
  refund_amount_base_threshold: string | null;
  stock_adjustment_units_threshold: number | null;
  supplier_payment_amount_base_threshold: string | null;
  purchase_order_amount_base_threshold: string | null;
  updated_at: string;
};

export async function getApprovalSettingsApi() {
  return apiFetch<ApiApprovalSettings>("/api/v1/accounts/approval-settings/");
}

export async function updateApprovalSettingsApi(payload: Omit<ApiApprovalSettings, "updated_at">) {
  return apiFetch<ApiApprovalSettings>("/api/v1/accounts/approval-settings/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type ApiApprovalRequest = {
  id: number;
  action: string;
  action_label: string;
  summary: string;
  payload: {
    request?: { method?: string; path?: string; query?: unknown[] };
    data?: Record<string, unknown>;
  };
  status: "pending" | "approved" | "rejected" | "consumed" | "expired";
  requested_by_staff: number;
  requester_name: string;
  branch: number | null;
  branch_name: string | null;
  decided_by: number | null;
  decided_by_staff: number | null;
  decided_by_staff_name: string | null;
  decision_note: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  consumed_at: string | null;
};

export async function listApprovalRequestsApi(statusFilter?: ApiApprovalRequest["status"]) {
  const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  return fetchAllPages<ApiApprovalRequest>(`/api/v1/accounts/approval-requests/${query}`);
}

export async function decideApprovalRequestApi(id: number, decision: "approve" | "reject", decisionNote = "") {
  return apiFetch<ApiApprovalRequest>(`/api/v1/accounts/approval-requests/${id}/${decision}/`, {
    method: "POST",
    body: JSON.stringify({ decision_note: decisionNote }),
  });
}

export type ApiAutomationPreferences = {
  enabled_rules: {
    low_stock: boolean;
    no_sales_today: boolean;
    high_discrepancies: boolean;
    high_expenses: boolean;
  };
  severity: "info" | "warning" | "critical";
  channel: "in_app" | "email" | "whatsapp";
};

export async function getAnalyticsConsentApi() {
  return apiFetch<{ enabled: boolean }>("/api/v1/core/analytics-consent/");
}

export async function updateAnalyticsConsentApi(enabled: boolean) {
  return apiFetch<{ enabled: boolean }>("/api/v1/core/analytics-consent/", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function getAutomationPreferencesApi() {
  return apiFetch<ApiAutomationPreferences>("/api/v1/reports/automation-preferences/");
}

export async function updateAutomationPreferencesApi(payload: ApiAutomationPreferences) {
  return apiFetch<ApiAutomationPreferences>("/api/v1/reports/automation-preferences/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type ApiAutomationTrigger =
  | "stock_below_minimum"
  | "customer_overdue"
  | "expense_exceeds_limit"
  | "purchase_order_approved"
  | "till_session_closed";
export type ApiAutomationAction =
  | "create_notification"
  | "create_follow_up"
  | "require_manager_approval"
  | "create_reconciliation_summary";
export type ApiAutomationRule = {
  id: number;
  name: string;
  trigger: ApiAutomationTrigger;
  conditions: Record<string, string>;
  action: ApiAutomationAction;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
export type ApiAutomationExecution = {
  id: number;
  rule: number;
  rule_name: string;
  trigger: ApiAutomationTrigger;
  action: ApiAutomationAction;
  event_key: string;
  object_type: string;
  object_id: string;
  status: "running" | "succeeded" | "failed";
  attempts: number;
  message: string;
  last_error: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

export async function listAutomationRulesApi() {
  return fetchAllPages<ApiAutomationRule>("/api/v1/reports/automation-rules/");
}
export async function createAutomationRuleApi(payload: Pick<ApiAutomationRule, "name" | "trigger" | "conditions" | "action" | "enabled">) {
  return apiFetch<ApiAutomationRule>("/api/v1/reports/automation-rules/", { method: "POST", body: JSON.stringify(payload) });
}
export async function updateAutomationRuleApi(id: number, payload: Pick<ApiAutomationRule, "name" | "trigger" | "conditions" | "action" | "enabled">) {
  return apiFetch<ApiAutomationRule>(`/api/v1/reports/automation-rules/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
}
export async function deleteAutomationRuleApi(id: number) {
  return apiFetch<void>(`/api/v1/reports/automation-rules/${id}/`, { method: "DELETE" });
}
export async function listAutomationExecutionsApi() {
  return fetchAllPages<ApiAutomationExecution>("/api/v1/reports/automation-executions/");
}
export async function retryAutomationExecutionApi(id: number) {
  return apiFetch<ApiAutomationExecution>(`/api/v1/reports/automation-executions/${id}/retry/`, { method: "POST" });
}

export type ApiCustomReportMetric = "sales" | "profit" | "transactions";

export type ApiCustomReport = {
  id: number;
  name: string;
  metric: ApiCustomReportMetric;
  metrics: ApiCustomReportMetric[];
  group_by: "day" | "month" | "year";
  sort_order: "asc" | "desc";
  start_date: string | null;
  end_date: string | null;
  branch_filter: "all" | "unassigned" | "branch";
  branch: number | null;
  created_at: string;
  updated_at: string;
};

export async function listCustomReportsApi() {
  return fetchAllPages<ApiCustomReport>("/api/v1/reports/custom-reports/");
}

export async function createCustomReportApi(payload: Omit<ApiCustomReport, "id" | "created_at" | "updated_at">) {
  return apiFetch<ApiCustomReport>("/api/v1/reports/custom-reports/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCustomReportApi(id: number, payload: Omit<ApiCustomReport, "id" | "created_at" | "updated_at">) {
  return apiFetch<ApiCustomReport>(`/api/v1/reports/custom-reports/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteCustomReportApi(id: number) {
  return apiFetch<void>(`/api/v1/reports/custom-reports/${id}/`, { method: "DELETE" });
}

export async function runCustomReportApi(id: number) {
  return apiFetch<{ report: ApiCustomReport; rows: { period: string; value: string | number; values?: Partial<Record<ApiCustomReportMetric, string | number>> }[] }>(
    `/api/v1/reports/custom-reports/${id}/run/`,
  );
}

export async function downloadCustomReportApi(id: number, format: "csv" | "xlsx" | "pdf") {
  const path = `/api/v1/reports/custom-reports/${id}/export/?export_format=${format}`;
  const fetchWithToken = (token: string | null) => fetchWithTimeout(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }, 60000);
  let response = await fetchWithToken(getAccessToken());
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await fetchWithToken(refreshed);
    if (!refreshed || response.status === 401) {
      clearTokens();
      notifyAuthExpired();
    }
  }
  if (!response.ok) {
    let detail = response.statusText || `Export failed (${response.status})`;
    try {
      const payload = await response.json() as { detail?: string };
      detail = payload.detail || detail;
    } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return response.blob();
}

export type ApiFinancialAccount = {
  id: number;
  name: string;
  account_type: "cash" | "bank" | "ecocash" | "innbucks" | "mobile_money" | "custom";
  provider_name: string;
  currency: string;
  opening_balance: string;
  opening_fx_rate_to_base: string;
  opening_date: string;
  current_balance: string;
  current_balance_base: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ApiAccountTransaction = {
  id: number;
  account: number;
  account_name: string;
  currency: string;
  direction: "in" | "out";
  entry_type: "manual" | "transfer_in" | "transfer_out" | "sale_receipt" | "sale_refund" | "expense_payment" | "income_receipt" | "supplier_payment" | "customer_collection" | "adjustment" | "reversal";
  amount: string;
  fx_rate_to_base: string;
  amount_base: string;
  transaction_date: string;
  description: string;
  reference: string;
  idempotency_key: string;
  is_reconciled: boolean;
  reconciled_at: string | null;
  reconciliation_events: Array<{ reconciled: boolean; note: string; created_at: string; created_by: number }>;
  created_at: string;
};

export type ApiAccountTransfer = {
  id: number;
  from_account: number;
  from_account_name: string;
  from_currency: string;
  to_account: number;
  to_account_name: string;
  to_currency: string;
  amount_from: string;
  amount_to: string;
  exchange_rate: string;
  fx_rate_to_base: string;
  amount_base: string;
  transaction_date: string;
  description: string;
  reference: string;
  idempotency_key: string;
  created_at: string;
};

export async function listFinancialAccountsApi() {
  return fetchAllPages<ApiFinancialAccount>("/api/v1/reports/accounts/");
}

export async function createFinancialAccountApi(payload: {
  name: string;
  account_type: ApiFinancialAccount["account_type"];
  provider_name: string;
  currency: string;
  opening_balance: string;
  opening_fx_rate_to_base?: string;
  opening_date: string;
}) {
  return apiFetch<ApiFinancialAccount>("/api/v1/reports/accounts/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateFinancialAccountApi(id: number, payload: { is_active: boolean }) {
  return apiFetch<ApiFinancialAccount>(`/api/v1/reports/accounts/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type ApiAccountBalanceReconciliation = {
  id: number;
  account: number;
  as_of: string;
  expected_balance: string;
  actual_balance: string;
  difference: string;
  note: string;
  adjustment_requested: boolean;
  adjustment_transaction: number | null;
  created_by: number;
  created_at: string;
};

export async function getFinancialAccountBalanceApi(id: number, asOf: string) {
  const params = new URLSearchParams({ as_of: asOf });
  return apiFetch<{
    account: number;
    as_of: string;
    balance: string;
    balance_base: string;
    reconciliation_history: ApiAccountBalanceReconciliation[];
  }>(
    `/api/v1/reports/accounts/${id}/balance/?${params.toString()}`,
  );
}

export async function reconcileAccountBalanceApi(id: number, payload: {
  as_of: string;
  actual_balance: string;
  note?: string;
  post_adjustment: boolean;
  fx_rate_to_base?: string;
  idempotency_key: string;
}) {
  return apiFetch<ApiAccountBalanceReconciliation>(`/api/v1/reports/accounts/${id}/reconcile-balance/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listAccountTransactionsApi(accountId?: number) {
  const query = accountId ? `?account=${accountId}` : "";
  return fetchAllPages<ApiAccountTransaction>(`/api/v1/reports/account-transactions/${query}`);
}

export async function createAccountTransactionApi(payload: {
  account: number;
  direction: "in" | "out";
  amount: string;
  fx_rate_to_base?: string;
  transaction_date: string;
  description: string;
  reference: string;
  idempotency_key: string;
}) {
  return apiFetch<ApiAccountTransaction>("/api/v1/reports/account-transactions/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function reconcileAccountTransactionApi(id: number, reconciled: boolean, note = "") {
  return apiFetch<ApiAccountTransaction>(`/api/v1/reports/account-transactions/${id}/reconcile/`, {
    method: "POST",
    body: JSON.stringify({ reconciled, note }),
  });
}

export async function listAccountTransfersApi() {
  return fetchAllPages<ApiAccountTransfer>("/api/v1/reports/account-transfers/");
}

export async function createAccountTransferApi(payload: {
  from_account: number;
  to_account: number;
  amount_from: string;
  exchange_rate?: string;
  fx_rate_to_base?: string;
  transaction_date: string;
  description: string;
  reference: string;
  idempotency_key: string;
}) {
  return apiFetch<ApiAccountTransfer>("/api/v1/reports/account-transfers/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiIntegrationKey = {
  id: number;
  name: string;
  key_prefix: string;
  permissions: string[];
  status: "active" | "revoked";
  last_used_at: string | null;
  rate_limit_per_hour: number;
  expires_at: string | null;
  created_at: string;
  raw_key?: string;
};

export async function listApiKeysApi() {
  return fetchAllPages<ApiIntegrationKey>("/api/v1/accounts/api-keys/");
}

export async function createApiKeyApi(payload: { name: string; permissions: string[]; expires_at?: string | null }) {
  return apiFetch<ApiIntegrationKey>("/api/v1/accounts/api-keys/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function revokeApiKeyApi(id: number) {
  return apiFetch<ApiIntegrationKey>(`/api/v1/accounts/api-keys/${id}/revoke/`, { method: "POST" });
}

export type ApiKeyRequestLog = {
  id: number;
  api_key: number;
  api_key_name: string;
  method: string;
  path: string;
  status_code: number | null;
  response_time_ms: number | null;
  created_at: string;
};

export async function listApiKeyUsageApi() {
  return fetchAllPages<ApiKeyRequestLog>("/api/v1/accounts/api-key-usage/");
}

export type ApiWebhookEvent =
  | "sale.created"
  | "product.low_stock"
  | "product.out_of_stock"
  | "audit.completed"
  | "expense.created";

export type ApiWebhookEndpoint = {
  id: number;
  name: string;
  url: string;
  events: ApiWebhookEvent[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  secret?: string;
};

export type ApiWebhookDelivery = {
  id: number;
  endpoint: number;
  endpoint_name: string;
  event: ApiWebhookEvent;
  status: "pending" | "sending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string;
  delivered_at: string | null;
  last_status_code: number | null;
  last_error: string;
  created_at: string;
};

export async function listWebhooksApi() {
  return fetchAllPages<ApiWebhookEndpoint>("/api/v1/accounts/webhooks/");
}

export async function createWebhookApi(payload: { name: string; url: string; events: ApiWebhookEvent[] }) {
  return apiFetch<ApiWebhookEndpoint>("/api/v1/accounts/webhooks/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWebhookApi(id: number, payload: Partial<Pick<ApiWebhookEndpoint, "is_active">>) {
  return apiFetch<ApiWebhookEndpoint>(`/api/v1/accounts/webhooks/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteWebhookApi(id: number) {
  return apiFetch<void>(`/api/v1/accounts/webhooks/${id}/`, { method: "DELETE" });
}

export async function listWebhookDeliveriesApi() {
  const response = await apiFetch<{ results?: ApiWebhookDelivery[] } | ApiWebhookDelivery[]>("/api/v1/accounts/webhook-deliveries/");
  return Array.isArray(response) ? response : response.results || [];
}

export async function createBranchApi(payload: Omit<ApiBranch, "id" | "manager_name">) {
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
  invoice_email?: string;
  address: string;
  tax_number?: string;
  notes: string;
  lead_time_days?: number;
  payment_terms_days?: number;
  reliability_score?: number;
  minimum_order_value?: string;
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
  unit_cost_base?: string;
  line_total?: string;
  line_total_base?: string;
};

export type ApiPurchaseOrder = {
  id: number;
  supplier: number;
  supplier_name?: string;
  branch?: number | null;
  branch_name?: string | null;
  order_number: string;
  status: "draft" | "submitted" | "approved" | "partially_received" | "fully_received" | "completed" | "cancelled" | "ordered" | "received";
  currency?: string;
  fx_rate_to_base?: string;
  expected_date?: string | null;
  supplier_invoice_number?: string;
  invoice_date?: string | null;
  due_date?: string | null;
  notes: string;
  discount_amount?: string;
  additional_charges?: string;
  total_cost: string;
  total_cost_base?: string;
  items: ApiPurchaseOrderItem[];
  created_at?: string;
};

export type ApiGoodsReceivedNoteItem = {
  id: number;
  purchase_order_item: number;
  product: number;
  product_name: string;
  sku: string;
  quantity_delivered: number;
  quantity_damaged: number;
  quantity_missing: number;
  quantity_accepted: number;
  unit_cost: string;
  batch_number: string;
  expiry_date: string | null;
  stock_movement: number | null;
};

export type ApiGoodsReceivedNote = {
  id: number;
  purchase_order: number;
  purchase_order_number: string;
  grn_number: string;
  status: "draft" | "confirmed";
  delivery_date: string;
  notes: string;
  items: ApiGoodsReceivedNoteItem[];
  attachments: Array<{ id: number; file: string; file_name: string; created_at: string }>;
  confirmed_at: string | null;
};

export type ApiInventoryIntelligenceItem = {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  branch: string;
  preferred_supplier: string;
  stock: number;
  reorder_level: number;
  status: "ok" | "low" | "out";
  movement_class: "fast" | "slow" | "non_moving";
  sold_quantity: number;
  returned_quantity: number;
  net_sold_quantity: number;
  average_daily_sales: string;
  net_revenue: string;
  gross_profit: string;
  inventory_value_base: string;
  average_purchase_cost_base: string | null;
  stock_turnover: string | null;
  dead_stock: boolean;
  ageing: Record<string, { quantity: number; value_base: string }>;
  untracked_quantity: number;
  cost_basis: string;
  average_stock: string | null;
  opening_stock: number | null;
};

export async function listPurchaseOrdersApi(): Promise<ApiPurchaseOrder[]> {
  return fetchAllPages<ApiPurchaseOrder>("/api/v1/inventory/purchase-orders/");
}

export async function createPurchaseOrderApi(payload: {
  supplier: number;
  branch?: number | null;
  currency?: string;
  fx_rate_to_base?: number;
  expected_date?: string | null;
  supplier_invoice_number?: string;
  invoice_date?: string | null;
  due_date?: string | null;
  notes?: string;
  discount_amount?: string;
  additional_charges?: string;
  items: Omit<ApiPurchaseOrderItem, "id" | "product_name" | "sku" | "line_total">[];
}) {
  return apiFetch<ApiPurchaseOrder>("/api/v1/inventory/purchase-orders/", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      items: payload.items.map((item) => ({
        ...item,
        unit_cost: Number(item.unit_cost).toFixed(2),
      })),
    }),
  });
}

export async function receivePurchaseOrderApi(
  id: number,
  batch?: { itemIds: number[]; batch_number: string; expiry_date?: string | null }
) {
  const batches = batch
    ? Object.fromEntries(batch.itemIds.map((itemId) => [String(itemId), {
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date || null,
    }]))
    : undefined;
  return apiFetch<ApiPurchaseOrder>(`/api/v1/inventory/purchase-orders/${id}/receive/`, {
    method: "POST",
    body: JSON.stringify(batches ? { batches } : {}),
  });
}

export async function transitionPurchaseOrderApi(
  id: number,
  action: "submit" | "approve" | "cancel" | "complete",
  note?: string,
) {
  return apiFetch<ApiPurchaseOrder>(`/api/v1/inventory/purchase-orders/${id}/${action}/`, {
    method: "POST",
    body: JSON.stringify(note ? { note } : {}),
  });
}

export async function createGoodsReceivedNoteApi(
  purchaseOrderId: number,
  payload: {
    delivery_date: string;
    idempotency_key?: string;
    notes?: string;
    items: Array<{
      purchase_order_item: number;
      quantity_delivered: number;
      quantity_damaged: number;
      quantity_missing: number;
      unit_cost: string;
      batch_number?: string;
      expiry_date?: string | null;
    }>;
  },
) {
  return apiFetch<ApiGoodsReceivedNote>(
    `/api/v1/inventory/purchase-orders/${purchaseOrderId}/goods-received-notes/`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function listGoodsReceivedNotesApi() {
  return fetchAllPages<ApiGoodsReceivedNote>("/api/v1/inventory/goods-received-notes/");
}

export async function confirmGoodsReceivedNoteApi(id: number) {
  return apiFetch<ApiGoodsReceivedNote>(`/api/v1/inventory/goods-received-notes/${id}/confirm/`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function attachGoodsReceivedDocumentApi(id: number, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<ApiGoodsReceivedNote["attachments"][number]>(
    `/api/v1/inventory/goods-received-notes/${id}/attachments/`,
    { method: "POST", body: formData },
  );
}

export async function createSupplierReturnApi(payload: {
  purchase_order: number;
  reason: "damaged" | "incorrect" | "expired" | "excess" | "other";
  idempotency_key: string;
  items: Array<{ goods_received_note_item: number; quantity: number; quantity_damaged: number }>;
}) {
  return apiFetch<{ id: number; total_amount_base: string }>("/api/v1/inventory/supplier-returns/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchSupplierHistoryApi(id: number) {
  return apiFetch<{
    supplier: ApiSupplier;
    products: ApiProduct[];
    purchase_orders: ApiPurchaseOrder[];
    payments: ApiSupplierPayment[];
    returns: Array<{ id: number; reason: string; return_date: string; total_amount_base: string }>;
    purchase_cost_history: Array<{
      id: number;
      supplier_name: string;
      product_name: string;
      order_number: string;
      grn_number: string;
      quantity: number;
      unit_cost: string;
      currency: string;
      fx_rate_to_base: string;
      unit_cost_base: string;
      created_at: string;
    }>;
  }>(`/api/v1/inventory/suppliers/${id}/history/`);
}

export type ApiSupplierStatement = {
  supplier: ApiSupplier;
  currency: string;
  as_of: string;
  totals: {
    received_total_base: string;
    returned_total_base: string;
    paid_total_base: string;
    outstanding_base: string;
  };
  invoices: Array<{
    purchase_order: number;
    order_number: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string | null;
    received_total_base: string;
    returned_total_base: string;
    paid_total_base: string;
    outstanding_base: string;
    status: "open" | "overdue" | "settled";
  }>;
  activity: Array<{
    date: string;
    type: "invoice" | "return" | "payment";
    reference: string;
    description: string;
    amount_base: string;
    order_id: number;
    balance_base: string;
  }>;
};

export async function fetchSupplierStatementApi(id: number) {
  return apiFetch<ApiSupplierStatement>(`/api/v1/inventory/suppliers/${id}/statement/`);
}

export async function fetchInventoryIntelligenceApi(days = 90) {
  return apiFetch<{
    window_days: number;
    currency: string;
    classification_thresholds: Record<string, string>;
    summary: {
      inventory_value_base: string;
      fast_moving_count: number;
      slow_moving_count: number;
      non_moving_count: number;
      dead_stock_count: number;
      low_stock_count: number;
    };
    items: ApiInventoryIntelligenceItem[];
  }>(`/api/v1/inventory/intelligence/?days=${days}`);
}

export async function fetchPurchaseSuggestions(days = 7) {
  return apiFetch<{ horizon_days: number; items: Array<{ product: ApiProduct; supplier: ApiSupplier | null; average_daily_sales: number; suggested_quantity: number; estimated_cost: string }> }>(`/api/v1/inventory/purchase-orders/suggestions/?days=${days}`);
}

export async function fetchInventoryForecast(days = 7) {
  return apiFetch<{ horizon_days: number; items: ApiForecastItem[] }>(`/api/v1/inventory/products/forecast/?days=${days}`);
}

export async function fetchSmartReorderApi() {
  return apiFetch<{ items: Array<{ product: ApiProduct; supplier: ApiSupplier | null; urgency: "critical" | "high" | "watch"; suggested_quantity: number; estimated_cost: string; days_remaining: number | null; reorder_in_days: number | null; lead_time_days: number; average_daily_sales: number }> }>("/api/v1/inventory/products/smart-reorder/");
}

export async function fetchSupplierScorecardsApi() {
  return apiFetch<{ items: Array<{ supplier: ApiSupplier; product_count: number; open_purchase_orders: number; low_stock_products: number; total_spend: string; lead_time_days: number; payment_terms_days: number; reliability_score: number; health: "strong" | "watch" | "risk" }> }>("/api/v1/inventory/suppliers/scorecards/");
}

export type ApiSupplierPayment = {
  id: number;
  supplier: number;
  supplier_name: string;
  purchase_order: number;
  financial_account: number | null;
  order_number: string;
  amount: string;
  currency: string;
  fx_rate_to_base: string;
  amount_base: string;
  payment_date: string;
  method: "cash" | "bank" | "mobile_money" | "card" | "other";
  reference: string;
  notes: string;
  idempotency_key: string;
  created_at: string;
};

export type ApiSupplierBalance = {
  supplier: number;
  supplier_name: string;
  currency: string;
  received_total_base: string;
  paid_total_base: string;
  outstanding_base: string;
};

export type ApiSupplierOverdueInvoice = {
  supplier: number;
  supplier_name: string;
  purchase_order: number;
  order_number: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string;
  currency: string;
  original_total_base: string;
  paid_total_base: string;
  returned_total_base: string;
  outstanding_base: string;
};

export async function listSupplierPaymentsApi() {
  return fetchAllPages<ApiSupplierPayment>("/api/v1/inventory/supplier-payments/");
}

export async function listSupplierPaymentBalancesApi() {
  return apiFetch<{ items: ApiSupplierBalance[]; overdue_invoices: ApiSupplierOverdueInvoice[] }>("/api/v1/inventory/supplier-payments/balances/");
}

export async function createSupplierPaymentApi(payload: {
  supplier: number;
  purchase_order: number;
  amount: number;
  financial_account?: number | null;
  currency: string;
  payment_date: string;
  method: ApiSupplierPayment["method"];
  reference?: string;
  notes?: string;
  idempotency_key: string;
}) {
  return apiFetch<ApiSupplierPayment>("/api/v1/inventory/supplier-payments/", {
    method: "POST",
    body: JSON.stringify({ ...payload, amount: payload.amount.toFixed(2) }),
  });
}

export async function identifyBarcodeProductApi(code: string) {
  return apiFetch<{
    barcode: string;
    name: string;
    brand?: string;
    category?: string;
    source: "inventory" | "open_food_facts";
    existing_product_id?: number;
  }>(`/api/v1/inventory/products/barcode-identify/?code=${encodeURIComponent(code)}`);
}

type ApiSaleItem = {
  id?: number;
  product?: number;
  product_name?: string;
  quantity: number;
  unit_price: string;
  discount_amount?: string;
  returned_quantity?: number;
  subtotal?: string;
};

type ApiSale = {
  id: number;
  items: string | ApiSaleItem[];
  total: string;
  total_cost?: string;
  gross_profit?: string;
  payment_method: string;
  payment_currency?: string;
  payment_allocations?: Array<{ currency: string; amount: string; fx_rate_to_base?: string; amount_base?: string; account?: number }>;
  amount_paid_base?: string;
  balance_due?: string;
  due_date?: string | null;
  branch?: number | null;
  customer?: number | null;
  date: string;
  time: string;
  created_at?: string;
};

export async function createSaleApi(payload: {
  integration_id: string;
  payment_method: string;
  payment_currency?: string;
  due_date?: string;
  payment_allocations?: Array<{ currency: string; amount: number; fx_rate_to_base?: number; account?: number }>;
  branch?: number | null;
  till_session?: number | null;
  customer: number | null;
  sale_items: { product: number; quantity: number; unit_price: string; discount_amount?: string; subtotal: string }[];
}) {
  return apiFetch<ApiSale>("/api/v1/sales/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function addCustomerDebtApi(
  customerId: string,
  payload: { amount: string; reason?: string; due_date?: string; idempotency_key: string },
) {
  return apiFetch<{ debt_amount: string; debt_started_at: string | null; debt_updated_at: string | null; debt_due_date: string | null; debt_notes: string }>(
    `/api/v1/customers/${customerId}/add-debt/`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function recordCustomerPaymentApi(
  customerId: string,
  payload: { amount: string; reason?: string; idempotency_key: string; payment_allocations?: Array<{ currency: string; amount: string; fx_rate_to_base?: string; account?: number }> },
) {
  return apiFetch<{ debt_amount: string; debt_started_at: string | null; debt_updated_at: string | null; debt_due_date: string | null; debt_notes: string }>(
    `/api/v1/customers/${customerId}/record-payment/`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export type ApiCustomerStatement = {
  customer: {
    id: number;
    name: string;
    phone: string;
    debt_amount: string;
    credit_limit: string | null;
  };
  currency_symbol: string;
  generated_at: string;
  invoices: Array<{
    id: number;
    invoice_number: string;
    date: string;
    due_date: string | null;
    total: string;
    amount_paid_base: string;
    balance_due: string;
    payment_method: string;
  }>;
  transactions: Array<{
    id: number;
    amount: string;
    type: string;
    reason: string;
    created_at: string;
    payment_allocations: Array<{ currency: string; amount: string; account?: number }>;
  }>;
};

export async function fetchCustomerStatementApi(customerId: string) {
  return apiFetch<ApiCustomerStatement>(`/api/v1/customers/${customerId}/statement/`);
}

export async function createSaleReturnApi(
  saleId: string,
  payload: { sale_item: number; quantity: number; refund_method: "Cash" | "EFT" | "Card" | "Credit"; payment_allocations?: Array<{ currency: string; amount: string; fx_rate_to_base?: string; account?: number }> }
) {
  return apiFetch<{
    id: number;
    sale_item: number;
    quantity: number;
    refund_amount: string;
    cost_amount: string;
    refund_method: string;
    return_date: string;
    payment_allocations: Array<{ currency: string; amount: string; fx_rate_to_base: string; amount_base: string; account?: number }>;
  }>(`/api/v1/sales/${saleId}/returns/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteSaleApi(id: string) {
  await apiFetch(`/api/v1/sales/${id}/`, { method: "DELETE" });
}

export type ApiTillCashMovement = {
  id: number;
  movement_type: "cash_expense" | "withdrawal" | "deposit";
  amount: string;
  expense: number | null;
  expense_description: string | null;
  note: string;
  idempotency_key: string;
  created_at: string;
  created_by: number;
};

export type ApiTillSession = {
  id: number;
  branch: number | null;
  opened_by_staff: number | null;
  reviewed_by: number | null;
  reviewed_by_staff: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string;
  cashier_name: string;
  opening_cash: string;
  closing_cash: string;
  expected_cash: string;
  cash_variance: string;
  cash_expenses?: string;
  cash_withdrawals?: string;
  cash_deposits?: string;
  card_total: string;
  eft_total: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  notes: string;
  sales_total?: string;
  cash_sales?: string;
  card_sales_total?: string;
  eft_sales_total?: string;
  cash_movements?: ApiTillCashMovement[];
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

export async function reviewTillApi(id: number, payload: { note?: string } = {}) {
  return apiFetch<ApiTillSession>(`/api/v1/sales/tills/${id}/review/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createTillCashMovementApi(id: number, payload: {
  movement_type: ApiTillCashMovement["movement_type"];
  amount?: string;
  expense?: number;
  note?: string;
  idempotency_key: string;
}) {
  return apiFetch<ApiTillCashMovement>(`/api/v1/sales/tills/${id}/cash-movements/`, {
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
    payment_currency?: string;
    payment_allocations?: Array<{ currency: string; amount: string; fx_rate_to_base?: string; amount_base?: string; account?: number }>;
    items: Array<{ id: number; product: number; product_name?: string; quantity: number; unit_price: string; subtotal: string }>;
    subtotal: string;
    total: string;
    customer: string;
    customer_phone: string;
  }>(`/api/v1/sales/${id}/receipt/`);
}

export async function fetchWhatsAppReceiptApi(id: string, payload: { phone?: string; message?: string } = {}) {
  return apiFetch<{
    message: string;
    whatsapp_url: string;
    receipt: Awaited<ReturnType<typeof fetchReceiptApi>>;
    log_id: number;
  }>(`/api/v1/sales/${id}/whatsapp-receipt/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiExpenseCategory = { id: number; name: string; parent: number | null; parent_name: string | null };
export type ApiExpenseBudget = {
  id: number;
  category: number | null;
  category_name: string | null;
  category_label?: string | null;
  branch: number | null;
  branch_name: string | null;
  expense_type: "all" | "operating" | "other";
  period_start: string;
  period_end: string;
  amount_base: string;
  spent_base: string;
  remaining_base: string;
  percent_used: string;
  note: string;
};
export type ApiRecurringExpense = {
  id: number;
  description: string;
  amount: string;
  expense_type: "operating" | "other";
  currency: string;
  fx_rate_to_base: string;
  amount_base: string;
  category: number | null;
  category_name: string | null;
  category_label?: string | null;
  branch: number | null;
  branch_name: string | null;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  first_due_date: string;
  next_due_date: string;
  end_date: string | null;
  is_active: boolean;
};

export async function listExpenseBudgetsApi() {
  return fetchAllPages<ApiExpenseBudget>("/api/v1/expenses/budgets/");
}

export async function createExpenseBudgetApi(payload: {
  category?: number;
  branch?: number;
  expense_type: ApiExpenseBudget["expense_type"];
  period_start: string;
  period_end: string;
  amount_base: string;
  note?: string;
}) {
  return apiFetch<ApiExpenseBudget>("/api/v1/expenses/budgets/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteExpenseBudgetApi(id: number) {
  await apiFetch(`/api/v1/expenses/budgets/${id}/`, { method: "DELETE" });
}

export async function listRecurringExpensesApi() {
  return fetchAllPages<ApiRecurringExpense>("/api/v1/expenses/recurring/");
}

export async function createRecurringExpenseApi(payload: {
  description: string;
  amount: string;
  expense_type: ApiRecurringExpense["expense_type"];
  currency: string;
  fx_rate_to_base?: string;
  payment_allocations?: Array<{ currency: string; amount: string; fx_rate_to_base?: string; account?: number }>;
  category?: number;
  branch?: number;
  frequency: ApiRecurringExpense["frequency"];
  first_due_date: string;
  end_date?: string;
}) {
  return apiFetch<ApiRecurringExpense>("/api/v1/expenses/recurring/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateRecurringExpenseApi(id: number, payload: { is_active: boolean }) {
  return apiFetch<ApiRecurringExpense>(`/api/v1/expenses/recurring/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function generateRecurringExpensesApi() {
  return apiFetch<{
    created_count: number;
    created: Array<{
      expense_id: number;
      schedule_id: number;
      date: string;
      description: string;
      amount: string;
      amount_base: string;
      currency: string;
      expense_type: "operating" | "other";
      category: number | null;
      category_name: string | null;
      category_label: string | null;
      branch: number | null;
      payment_allocations: Array<{ currency: string; amount: string; amount_base: string; account?: number }>;
    }>;
    through_date: string;
  }>("/api/v1/expenses/recurring/generate-due/", { method: "POST", body: "{}" });
}

export type ApiExpense = {
  id: number;
  description: string;
  amount: string;
  currency?: string;
  fx_rate_to_base?: string;
  amount_base?: string;
  expense_type?: "operating" | "other";
  payment_allocations?: Array<{ currency: string; amount: string; fx_rate_to_base?: string; amount_base?: string; account?: number }>;
  date: string;
  category?: number | null;
  category_name?: string | null;
  category_label?: string;
  branch?: number | null;
  branch_name?: string | null;
  receipt_image?: string | null;
  employee_name?: string;
  approval_status?: "pending" | "approved" | "rejected";
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  approval_note?: string;
};

export async function listExpensesApi() {
  return fetchAllPages<ApiExpense>("/api/v1/expenses/");
}

export type ReceiptScanResult = {
  status: string;
  source_file: string;
  parsed: {
    merchant?: string;
    amount?: number | null;
    date?: string;
    category?: string;
    note?: string;
  };
  message?: string;
};

export async function listExpenseCategories(): Promise<ApiExpenseCategory[]> {
  return fetchAllPages<ApiExpenseCategory>("/api/v1/expenses/categories/");
}

export async function ensureExpenseCategoryId(name: string, parentId?: number): Promise<number | null> {
  const trimmed = name.trim() || "Other";
  const cats = await listExpenseCategories();
  const found = cats.find((c) => c.name.toLowerCase() === trimmed.toLowerCase() && (c.parent || null) === (parentId || null));
  if (found) return found.id;
  const created = await apiFetch<ApiExpenseCategory>("/api/v1/expenses/categories/", {
    method: "POST",
    body: JSON.stringify({ name: trimmed, parent: parentId || null }),
  });
  return created.id;
}

export async function createExpenseApi(payload: {
  description: string;
  amount: number;
  currency?: string;
  fx_rate_to_base?: number;
  payment_allocations?: Array<{ currency: string; amount: number; fx_rate_to_base?: number; account?: number }>;
  categoryName: string;
  subcategoryName?: string;
  expenseType?: "operating" | "other";
  date: string;
  branch?: number;
}) {
  const parentId = await ensureExpenseCategoryId(payload.categoryName);
  const categoryId = payload.subcategoryName?.trim()
    ? await ensureExpenseCategoryId(payload.subcategoryName, parentId || undefined)
    : parentId;
  return apiFetch<ApiExpense>("/api/v1/expenses/", {
    method: "POST",
    body: JSON.stringify({
      description: payload.description,
      amount: payload.amount.toFixed(2),
      currency: payload.currency,
      fx_rate_to_base: payload.fx_rate_to_base,
      payment_allocations: payload.payment_allocations?.map((row) => ({
        currency: row.currency,
        amount: row.amount.toFixed(2),
        fx_rate_to_base: row.fx_rate_to_base,
        account: row.account,
      })),
      category: categoryId,
      expense_type: payload.expenseType || "operating",
      date: payload.date,
      branch: payload.branch,
    }),
  });
}

export async function createExpenseWithReceiptApi(
  payload: {
    description: string;
    amount: number;
    currency?: string;
    fx_rate_to_base?: number;
    categoryName: string;
    subcategoryName?: string;
    payment_allocations?: Array<{ currency: string; amount: number; fx_rate_to_base?: number; account?: number }>;
    expenseType?: "operating" | "other";
    date: string;
    branch?: number;
  },
  receipt: File
) {
  const parentId = await ensureExpenseCategoryId(payload.categoryName);
  const categoryId = payload.subcategoryName?.trim()
    ? await ensureExpenseCategoryId(payload.subcategoryName, parentId || undefined)
    : parentId;
  const body = new FormData();
  body.append("description", payload.description);
  body.append("amount", payload.amount.toFixed(2));
  body.append("currency", payload.currency || "");
  if (payload.fx_rate_to_base != null) body.append("fx_rate_to_base", String(payload.fx_rate_to_base));
  if (categoryId != null) body.append("category", String(categoryId));
  if (payload.payment_allocations?.length) {
    body.append("payment_allocations", JSON.stringify(payload.payment_allocations.map((row) => ({
      ...row,
      amount: row.amount.toFixed(2),
      ...(row.fx_rate_to_base == null ? {} : { fx_rate_to_base: String(row.fx_rate_to_base) }),
    }))));
  }
  body.append("expense_type", payload.expenseType || "operating");
  body.append("date", payload.date);
  if (payload.branch != null) body.append("branch", String(payload.branch));
  body.append("receipt_image", receipt);

  return apiFetch<ApiExpense>("/api/v1/expenses/", {
    method: "POST",
    body,
  });
}

export async function scanReceiptApi(payload: {
  receipt: File;
  merchant?: string;
  amount?: string;
  category?: string;
  note?: string;
}) {
  const body = new FormData();
  body.append("receipt", payload.receipt);
  if (payload.merchant) body.append("merchant", payload.merchant);
  if (payload.amount) body.append("amount", payload.amount);
  if (payload.category) body.append("category", payload.category);
  if (payload.note) body.append("note", payload.note);

  return apiFetch<ReceiptScanResult>("/api/v1/expenses/ocr-receipt/", {
    method: "POST",
    body,
    timeoutMs: 60_000,
  });
}

export async function deleteExpenseApi(id: string) {
  await apiFetch(`/api/v1/expenses/${id}/`, { method: "DELETE" });
}

export async function approveExpenseApi(id: string, note = "") {
  return apiFetch<ApiExpense>(`/api/v1/expenses/${id}/approve/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export async function rejectExpenseApi(id: string, note = "") {
  return apiFetch<ApiExpense>(`/api/v1/expenses/${id}/reject/`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export type ApiExpenseAnalysis = {
  total_expenses: string;
  expense_count: number;
  start_date: string;
  end_date: string;
  comparison: { previous_total: string; change: string; change_percent: string | null };
  by_category: Array<{ category: string; amount: string; count: number }>;
  by_employee: Array<{ employee: string; amount: string; count: number }>;
  by_branch: Array<{ branch: string; amount: string; count: number }>;
};

export async function getExpenseAnalysisApi(params: { start_date?: string; end_date?: string; branch?: number } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") query.set(key, String(value));
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  return apiFetch<ApiExpenseAnalysis>(`/api/v1/reports/expense-analysis/${suffix}`);
}

export type ApiProfitLossSummary = {
  gross_sales: string;
  discounts: string;
  sales_returns: string;
  net_sales: string;
  cost_of_goods_sold: string;
  gross_profit: string;
  operating_expenses: string;
  other_income: string;
  other_expenses: string;
  net_profit: string;
  cash_received: string;
  supplier_payments: string;
};

export type ApiProfitLossReport = {
  period: string;
  start_date: string;
  end_date: string;
  previous_start_date: string;
  previous_end_date: string;
  branches: number[] | null;
  currency: string;
  current: ApiProfitLossSummary;
  previous: ApiProfitLossSummary;
  comparison: Record<keyof ApiProfitLossSummary, { change: string; change_percent: string | null }>;
};

export async function fetchProfitLossApi(period: string, startDate?: string, endDate?: string, branchId?: string) {
  const params = new URLSearchParams({ period });
  if (period === "custom" && startDate && endDate) {
    params.set("start_date", startDate);
    params.set("end_date", endDate);
  }
  if (branchId) params.set("branch", branchId);
  return apiFetch<ApiProfitLossReport>(`/api/v1/reports/profit-loss/?${params.toString()}`);
}

export type ApiBranchOverviewRow = {
  id: number;
  name: string;
  opening_date: string;
  current_period: { start_date: string; end_date: string };
  comparison_period: { start_date: string; end_date: string; operating_days: number };
  current_operating_days: number;
  current: ApiProfitLossSummary;
  previous: ApiProfitLossSummary;
  comparisons: Record<string, {
    current: string;
    previous: string;
    current_per_operating_day: string | null;
    previous_per_operating_day: string | null;
    change_percent: string | null;
    comparison_available: boolean;
  }>;
  inventory: { cost_value: string; retail_value: string };
  customer_outstanding: string;
  supplier_outstanding: string;
  outgoing_stock_in_transit: number;
};

export type ApiBranchOverview = {
  period: string;
  start_date: string;
  end_date: string;
  previous_start_date: string;
  previous_end_date: string;
  selected_branches: number[];
  includes_unassigned_records: boolean;
  branches: ApiBranchOverviewRow[];
  total: ApiProfitLossSummary;
  previous_total: ApiProfitLossSummary;
  inventory: { cost_value: string; retail_value: string };
  customer_outstanding: string;
  supplier_outstanding: string;
};

export async function fetchBranchOverviewApi(period: string, branches: string[] | "all", startDate?: string, endDate?: string) {
  const params = new URLSearchParams({ period });
  params.set("branches", branches === "all" ? "all" : branches.join(","));
  if (period === "custom" && startDate && endDate) {
    params.set("start_date", startDate);
    params.set("end_date", endDate);
  }
  return apiFetch<ApiBranchOverview>(`/api/v1/reports/branch-overview/?${params.toString()}`);
}

export async function createOtherIncomeApi(payload: {
  description: string;
  amount: number;
  currency: string;
  fx_rate_to_base?: number;
  date: string;
}) {
  return apiFetch<ApiExpense>("/api/v1/expenses/other-income/", {
    method: "POST",
    body: JSON.stringify({
      description: payload.description,
      amount: payload.amount.toFixed(2),
      currency: payload.currency,
      fx_rate_to_base: payload.fx_rate_to_base,
      date: payload.date,
    }),
  });
}

type ApiOfflineAction = {
  id: string;
  type:
    | "supply_create"
    | "supply_update"
    | "audit_complete"
    | "sale"
    | "expense"
    | "product_create"
    | "product_update"
    | "product_delete"
    | "batch_receive"
    | "restock"
    | "customer_create"
    | "customer_update"
    | "customer_delete"
    | "staff_create"
    | "staff_update"
    | "staff_delete"
    | "supplier_create"
    | "audit_create"
    | "audit_update"
    | "discrepancy_create"
    | "discrepancy_resolve";
  payload: Record<string, unknown>;
  timestamp: number;
};

export async function pushOfflineActions(actions: ApiOfflineAction[]) {
  return apiFetch<{ processed: number; processed_action_ids: string[]; conflicts?: number[]; errors?: unknown[]; resolution: string }>("/api/v1/sync/push/", {
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

export type FeatureAccess = {
  key: string;
  label: string;
  category: string;
  minimum_plan: PlanCode;
  enabled: boolean;
  current_plan: PlanCode;
  upgrade_plan: PlanCode | null;
  limit: number | null;
  used: number | null;
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
  launch_promo_started_at: string | null;
  launch_promo_ends_at: string | null;
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
  features: FeatureAccess[];
  events: Array<{ id: number; event_type: string; provider: string; metadata: Record<string, unknown>; created_at: string }>;
  cycles: Array<{ id: number; period_start: string; period_end: string; amount: string; currency: string; paid_at: string | null; status: string }>;
  available_actions: string[];
};

export type ReferralRewardToken = {
  id: number;
  code: string;
  plan_code: PlanCode;
  referrals_required: number;
  reward_days: number;
  status: "unused" | "redeemed" | "expired";
  expires_at: string | null;
  redeemed_at: string | null;
  created_at: string;
};

export type ReferralProgress = {
  code: string;
  target: number;
  qualified_count: number;
  pending_count: number;
  remaining: number;
  reward_days: number;
  tokens: ReferralRewardToken[];
};

export type PricingCountry = {
  country_code: string;
  country_name: string;
  currency: string;
  currency_symbol: string;
};

export type RegionalPlanPrice = {
  plan: BillingPlan;
  country_code: string;
  country_name: string;
  currency: string;
  currency_symbol: string;
  monthly_price: string;
  yearly_price: string;
};

export type PricingContext = PricingCountry & {
  launch_promotion?: { enabled: boolean; days: number };
  detected_by: string;
  prices: RegionalPlanPrice[];
  available_countries: PricingCountry[];
};

const TIMEZONE_COUNTRY: Record<string, string> = {
  "Africa/Blantyre": "ZW",
  "Africa/Bujumbura": "TZ",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Gaborone": "BW",
  "Africa/Harare": "ZW",
  "Africa/Johannesburg": "ZA",
  "Africa/Lagos": "NG",
  "Africa/Lusaka": "ZM",
  "Africa/Nairobi": "KE",
  "Africa/Windhoek": "ZA",
};

const SUPPORTED_PRICING_COUNTRIES = new Set(["ZA", "ZW", "BW", "KE", "NG", "GH", "TZ", "ZM"]);

export function getDetectedPricingCountry(): string {
  if (typeof navigator === "undefined") return "ZA";

  const languageRegion = navigator.languages
    ?.map((language) => {
      try {
        return new Intl.Locale(language).region;
      } catch {
        return "";
      }
    })
    .find(Boolean);

  const region = (languageRegion || "").toUpperCase();
  if (SUPPORTED_PRICING_COUNTRIES.has(region)) return region;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezoneCountry = TIMEZONE_COUNTRY[timezone];
  return SUPPORTED_PRICING_COUNTRIES.has(timezoneCountry) ? timezoneCountry : "ZA";
}

export async function listBillingPlansApi() {
  return fetchAllPages<BillingPlan>("/api/v1/billing/plans/");
}

export async function getPricingContextApi(countryCode?: string) {
  const detectedCountry = (countryCode || getDetectedPricingCountry()).trim().toUpperCase();
  const suffix = detectedCountry ? `?country=${encodeURIComponent(detectedCountry)}` : "";
  return apiFetch<PricingContext>(`/api/v1/billing/pricing-context/${suffix}`, { skipAuth: true });
}

export async function getBillingOverviewApi() {
  return apiFetch<BillingOverview>("/api/v1/billing/subscriptions/current/");
}

export async function getFeatureAccessApi() {
  return apiFetch<{ features: FeatureAccess[] }>("/api/v1/billing/subscriptions/features/");
}

export async function fetchRuleInsightsApi() {
  return apiFetch<{ insights: Array<{ type: string; severity: string; message: string }>; timestamp: string }>("/api/v1/reports/insights/");
}

export type ApiBusinessInsight = {
  id: number;
  rule_key: string;
  title: string;
  explanation: string;
  supporting_figures: Record<string, unknown>;
  period_start: string;
  period_end: string;
  period_label: string;
  severity: "critical" | "high" | "medium" | "info";
  recommended_action: string;
  link: string;
  status: "active" | "acknowledged" | "dismissed" | "resolved";
  generated_at: string;
  acknowledged_at: string | null;
  dismissed_at: string | null;
  resolved_at: string | null;
};

export async function fetchBusinessInsightsApi(status: "active" | "all" = "active") {
  return apiFetch<{ items: ApiBusinessInsight[]; history_count: number; currency: string; evaluated_at: string }>(
    `/api/v1/reports/insights/?status=${status}`,
  );
}

export async function updateBusinessInsightApi(id: number, action: "acknowledge" | "dismiss") {
  return apiFetch<ApiBusinessInsight>(`/api/v1/reports/insights/${id}/${action}/`, { method: "POST" });
}

export async function fetchProfitLeaksApi() {
  return apiFetch<{ items: Array<{ type: string; severity: "critical" | "high" | "medium" | "low"; title: string; impact: string | number; product: string; sku: string; suggested_action: string }> }>("/api/v1/reports/profit-leaks/");
}

export async function fetchWhatsAppSummaryApi() {
  return apiFetch<{ message: string; date: string; channel: string }>("/api/v1/reports/whatsapp-summary/");
}

export async function createWhatsAppReportApi(phone?: string) {
  return apiFetch<{ message: string; date?: string; channel: string; whatsapp_url: string; log: NotificationLog }>("/api/v1/notifications/whatsapp-report/", {
    method: "POST",
    body: JSON.stringify({ phone: phone || "" }),
  });
}

export type NotificationLog = {
  id: number;
  type: string;
  message: string;
  sent_at: string;
  channel: string;
};

export async function fetchNotificationLogsApi() {
  return fetchAllPages<NotificationLog>("/api/v1/notifications/");
}

export type FeedbackItem = {
  id: number;
  title: string;
  message: string;
  category: "idea" | "bug" | "improvement" | "praise";
  author_name: string;
  upvote_count: number;
  has_upvoted: boolean;
  created_at: string;
  updated_at: string;
};

export async function listFeedbackApi() {
  return fetchAllPages<FeedbackItem>("/api/v1/notifications/feedback/");
}

export async function createFeedbackApi(payload: Pick<FeedbackItem, "title" | "message" | "category">) {
  return apiFetch<FeedbackItem>("/api/v1/notifications/feedback/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function toggleFeedbackUpvoteApi(id: number) {
  return apiFetch<FeedbackItem>(`/api/v1/notifications/feedback/${id}/upvote/`, {
    method: "POST",
  });
}

export type NotificationPreference = {
  id: number;
  user: number;
  whatsapp_daily: boolean;
  low_stock_alerts: boolean;
  discrepancy_alerts: boolean;
  push_enabled: boolean;
  email_opt_in: boolean;
  email_daily_summary: boolean;
};

export async function fetchNotificationPreferencesApi() {
  return fetchAllPages<NotificationPreference>("/api/v1/notifications/preferences/");
}

export async function createNotificationPreferencesApi(payload: Omit<NotificationPreference, "id" | "user">) {
  return apiFetch<NotificationPreference>("/api/v1/notifications/preferences/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateNotificationPreferencesApi(
  id: number,
  payload: Partial<Omit<NotificationPreference, "id" | "user">>
) {
  return apiFetch<NotificationPreference>(`/api/v1/notifications/preferences/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type ApiAudit = {
  id: number;
  date: string;
  status: "in_progress" | "completed";
  items_counted: number;
  discrepancies_found: number;
  conductor: number | null;
  completed_at: string | null;
};

export type ApiAuditSchedule = {
  id: number;
  frequency: "daily" | "weekly";
  is_active: boolean;
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listAuditSchedulesApi() {
  return fetchAllPages<ApiAuditSchedule>("/api/v1/audits/schedules/");
}

export async function createAuditScheduleApi(payload: { frequency: ApiAuditSchedule["frequency"] }) {
  return apiFetch<ApiAuditSchedule>("/api/v1/audits/schedules/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAuditScheduleApi(id: number, payload: Partial<Pick<ApiAuditSchedule, "frequency" | "is_active">>) {
  return apiFetch<ApiAuditSchedule>(`/api/v1/audits/schedules/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function createAuditApi(payload: {
  status?: ApiAudit["status"];
  items_counted: number;
  discrepancies_found?: number;
}) {
  return apiFetch<ApiAudit>("/api/v1/audits/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAuditApi(
  id: string,
  payload: Partial<{
    status: ApiAudit["status"];
    items_counted: number;
    discrepancies_found: number;
  }>
) {
  return apiFetch<ApiAudit>(`/api/v1/audits/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type ApiDiscrepancy = {
  id: number;
  audit: number;
  product: number;
  product_name?: string;
  expected_stock: number;
  actual_stock: number;
  difference: number;
  status: "unresolved" | "investigating" | "resolved";
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
};

export async function createDiscrepancyApi(payload: {
  audit: number;
  product: number;
  expected_stock: number;
  actual_stock: number;
  difference: number;
  status?: ApiDiscrepancy["status"];
}) {
  return apiFetch<ApiDiscrepancy>("/api/v1/audits/discrepancies/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function resolveDiscrepancyApi(id: string) {
  return apiFetch<ApiDiscrepancy>(`/api/v1/audits/discrepancies/${id}/resolve/`, {
    method: "POST",
  });
}

export async function mockCheckoutApi(payload: { plan: PlanCode; billing_period: BillingPeriod; trial_days?: number; country_code?: string }) {
  return apiFetch<{ detail: string; subscription: BillingSubscription; billing: BillingOverview }>("/api/v1/billing/subscriptions/mock-checkout/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getProviderStatusApi() {
  return apiFetch<{ providers: Array<{ provider: string; enabled: boolean; ready: boolean; label: string; detail: string; metadata: Record<string, unknown> }> }>('/api/v1/billing/subscriptions/providers/');
}

export async function pesepayCheckoutApi(payload: { plan: PlanCode; billing_period: BillingPeriod; country_code?: string; amount?: number; return_url?: string; result_url?: string }) {
  return apiFetch<{
    detail: string;
    provider: string;
    reference: string;
    redirect_url: string;
    status: string;
    transaction_status: string;
    message: string;
    billing: BillingOverview;
  }>('/api/v1/billing/subscriptions/pesepay-checkout/', {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function paynowCheckoutApi(payload: { plan: PlanCode; billing_period: BillingPeriod; country_code?: string }) {
  return apiFetch<{ reference: string; redirect_url: string; status: string }>("/api/v1/billing/subscriptions/paynow-checkout/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type PaynowMobileMethod = "ecocash" | "onemoney";

export async function paynowMobileCheckoutApi(payload: { plan: PlanCode; billing_period: BillingPeriod; country_code?: string; method: PaynowMobileMethod; phone: string }) {
  return apiFetch<{ reference: string; status: string; method: PaynowMobileMethod; phone: string }>("/api/v1/billing/subscriptions/paynow-mobile-checkout/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getPaynowStatusApi(reference: string) {
  return apiFetch<{ reference: string; status: "pending" | "paid" | "failed" }>(`/api/v1/billing/subscriptions/paynow-status/?reference=${encodeURIComponent(reference)}`);
}

export async function getReferralProgressApi() {
  return apiFetch<ReferralProgress>("/api/v1/billing/referrals/");
}

export async function redeemReferralRewardApi(token?: string) {
  return apiFetch<{ detail: string; billing: BillingOverview; referrals: ReferralProgress }>("/api/v1/billing/referrals/redeem/", {
    method: "POST",
    body: JSON.stringify({ token: token || "" }),
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


export function createSupplyEntryApi(entry: Omit<SupplyEntry, "id" | "recordedAt" | "invoiceNumber">) {
  return apiFetch<SupplyEntry>("/api/v1/inventory/supply-entries/", { method: "POST", body: JSON.stringify(entry) });
}

export function updateSupplyEntryApi(id: string, updates: Partial<SupplyEntry>) {
  return apiFetch<SupplyEntry>(`/api/v1/inventory/supply-entries/${id}/`, { method: "PATCH", body: JSON.stringify(updates) });
}

export function completeAuditApi(id: string, counts?: Array<{ product: number; counted_quantity: number }>) {
  return apiFetch<{ id: number; date: string; status: "in_progress" | "completed"; items_counted: number; discrepancies_found: number }>(`/api/v1/audits/${id}/complete/`, { method: "POST", body: JSON.stringify(counts ? { counts } : {}) });
}

export function googleConfigRequest() {
  return apiFetch<{ client_id: string; nonce: string | null }>("/api/v1/accounts/google/", { skipAuth: true });
}

export function googleLoginRequest(credential: string, nonce: string, referralCode = "", businessName = "") {
  return apiFetch<{ access: string; refresh: string; user: ApiUser; created: boolean }>("/api/v1/accounts/google/", {
    method: "POST", skipAuth: true,
    body: JSON.stringify({ credential, nonce, referral_code: referralCode, business_name: businessName }),
  });
}

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
    try {
      const err = (await res.json()) as { detail?: string; non_field_errors?: string[] };
      detail = err.detail || err.non_field_errors?.[0] || JSON.stringify(err);
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed: ${res.status}`);
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
  stock: number;
  reorder_level: number;
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
    stock: p.stock,
    reorder: p.reorder_level,
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
  price: number;
}) {
  const categoryId = await ensureInventoryCategoryId(payload.categoryName);
  const body: Record<string, unknown> = {
    name: payload.name,
    sku: payload.sku,
    barcode: payload.barcode || "",
    stock: payload.stock,
    reorder_level: payload.reorder_level,
    price: payload.price.toFixed(2),
  };
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
    price: number;
  }>
) {
  const body: Record<string, unknown> = {};
  if (payload.name != null) body.name = payload.name;
  if (payload.sku != null) body.sku = payload.sku;
  if (payload.barcode != null) body.barcode = payload.barcode;
  if (payload.stock != null) body.stock = payload.stock;
  if (payload.reorder_level != null) body.reorder_level = payload.reorder_level;
  if (payload.price != null) body.price = Number(payload.price).toFixed(2);
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

type ApiSale = {
  id: number;
  items: string;
  total: string;
  payment_method: string;
  date: string;
  time: string;
  created_at?: string;
};

export async function createSaleApi(payload: {
  payment_method: string;
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

// Offline queue: stores actions when offline, syncs when back online
const QUEUE_KEY = "sp_offline_queue";
const SESSION_KEY = "sp_offline_logged_in";
const AUTHENTICATED_SESSION_KEY = "sp_offline_authenticated";
const DASHBOARD_SESSION_KEY = "sp_offline_dashboard_session";
const OFFLINE_ACCESS_ENABLED_KEY = "sp_offline_access_enabled";
const ACCESS_KEY = "sp_access_token";
const CACHED_USER_KEY = "sp_cached_user";
export const LAST_SUCCESSFUL_SYNC_KEY = "sp_last_successful_sync_at";

export type OfflineActionType =
  | "sale"
  | "expense"
  | "product_create"
  | "product_update"
  | "product_delete"
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

export interface OfflineAction {
  id: string;
  type: OfflineActionType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export function getOfflineQueue(): OfflineAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addToOfflineQueue(action: Omit<OfflineAction, "id" | "timestamp">) {
  const queue = getOfflineQueue();
  queue.push({
    ...action,
    id: Math.random().toString(36).slice(2, 10),
    timestamp: Date.now(),
  });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearOfflineQueue() {
  localStorage.removeItem(QUEUE_KEY);
}

export function setOfflineQueue(actions: OfflineAction[]) {
  if (actions.length === 0) {
    clearOfflineQueue();
    return;
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(actions));
}

export function removeQueuedProductCreate(localId: string) {
  removeQueuedLocalCreate("product_create", localId);
}

export function hasQueuedProductCreate(localId: string) {
  return hasQueuedLocalCreate("product_create", localId);
}

export function removeQueuedLocalCreate(type: OfflineActionType, localId: string) {
  const next = getOfflineQueue().filter(
    (action) => !(action.type === type && String(action.payload.local_id || "") === localId)
  );
  setOfflineQueue(next);
}

export function hasQueuedLocalCreate(type: OfflineActionType, localId: string) {
  return getOfflineQueue().some(
    (action) => action.type === type && String(action.payload.local_id || "") === localId
  );
}

export function markOfflineSession() {
  localStorage.setItem(SESSION_KEY, "1");
}

export function clearOfflineSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function hadOfflineSession() {
  return localStorage.getItem(SESSION_KEY) === "1";
}

export function markAuthenticatedOfflineSession() {
  localStorage.setItem(AUTHENTICATED_SESSION_KEY, "1");
}

export function clearAuthenticatedOfflineSession() {
  localStorage.removeItem(AUTHENTICATED_SESSION_KEY);
  clearDashboardOfflineSession();
}

export function hasAuthenticatedOfflineSession() {
  return (
    isOfflineAccessEnabled() &&
    localStorage.getItem(AUTHENTICATED_SESSION_KEY) === "1" &&
    !!localStorage.getItem(ACCESS_KEY) &&
    !!localStorage.getItem(CACHED_USER_KEY)
  );
}

export function markDashboardOfflineSession() {
  localStorage.setItem(DASHBOARD_SESSION_KEY, "1");
}

export function clearDashboardOfflineSession() {
  localStorage.removeItem(DASHBOARD_SESSION_KEY);
}

export function hasDashboardOfflineSession() {
  return localStorage.getItem(DASHBOARD_SESSION_KEY) === "1";
}

export function canQueueOfflineAction() {
  return hasAuthenticatedOfflineSession() && hasDashboardOfflineSession() && !isOnline();
}

export function isOnline(): boolean {
  return navigator.onLine;
}

export function isOfflineAccessEnabled(): boolean {
  const value = localStorage.getItem(OFFLINE_ACCESS_ENABLED_KEY);
  return value == null ? true : value === "1";
}

export function setOfflineAccessEnabled(enabled: boolean) {
  localStorage.setItem(OFFLINE_ACCESS_ENABLED_KEY, enabled ? "1" : "0");
}

export function setLastSuccessfulSync(timestamp: string) {
  localStorage.setItem(LAST_SUCCESSFUL_SYNC_KEY, timestamp);
}

export function getLastSuccessfulSync(): string | null {
  return localStorage.getItem(LAST_SUCCESSFUL_SYNC_KEY);
}

// Listen for online status and trigger sync when the app is back online
export function setupOfflineSync(onSync: (actions: OfflineAction[]) => Promise<boolean>) {
  const handleOnline = async () => {
    const queue = getOfflineQueue();
    if (queue.length > 0) {
      const success = await onSync(queue);
      if (success) {
        clearOfflineQueue();
        clearOfflineSession();
      }
    }
  };

  window.addEventListener("online", handleOnline);
  return () => window.removeEventListener("online", handleOnline);
}

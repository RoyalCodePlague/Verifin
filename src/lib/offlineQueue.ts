// Offline queue: stores actions when offline, syncs when back online
const QUEUE_KEY = "sp_offline_queue";
const SESSION_KEY = "sp_offline_logged_in";
const AUTHENTICATED_SESSION_KEY = "sp_offline_authenticated";
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
  | "customer_update"
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
}

export function hasAuthenticatedOfflineSession() {
  return (
    isOfflineAccessEnabled() &&
    localStorage.getItem(AUTHENTICATED_SESSION_KEY) === "1" &&
    !!localStorage.getItem(ACCESS_KEY) &&
    !!localStorage.getItem(CACHED_USER_KEY)
  );
}

export function canQueueOfflineAction() {
  return hasAuthenticatedOfflineSession() && !isOnline();
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

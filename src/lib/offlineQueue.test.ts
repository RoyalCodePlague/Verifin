import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToOfflineQueue,
  canQueueOfflineAction,
  clearOfflineQueue,
  getOfflineQueue,
  hasQueuedProductCreate,
  markDashboardOfflineSession,
  markAuthenticatedOfflineSession,
  removeQueuedProductCreate,
  setOfflineAccessEnabled,
  setupOfflineSync,
} from "./offlineQueue";

describe("offline queue", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  });

  it("queues offline actions in localStorage", () => {
    addToOfflineQueue({ type: "sale", payload: { payment_method: "Cash" } });

    expect(getOfflineQueue()).toHaveLength(1);
    expect(getOfflineQueue()[0]).toMatchObject({
      type: "sale",
      payload: { payment_method: "Cash" },
    });
  });

  it("removes an unsynced product create when its local product is deleted", () => {
    addToOfflineQueue({ type: "product_create", payload: { local_id: "local-1", name: "Bread" } });
    addToOfflineQueue({ type: "sale", payload: { payment_method: "Cash" } });

    expect(hasQueuedProductCreate("local-1")).toBe(true);

    removeQueuedProductCreate("local-1");

    expect(hasQueuedProductCreate("local-1")).toBe(false);
    expect(getOfflineQueue()).toHaveLength(1);
    expect(getOfflineQueue()[0].type).toBe("sale");
  });

  it("clears the queue after a successful online sync callback", async () => {
    addToOfflineQueue({ type: "expense", payload: { description: "Transport", amount: 5 } });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const onSync = vi.fn().mockResolvedValue(true);

    const cleanup = setupOfflineSync(onSync);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));

    expect(getOfflineQueue()).toEqual([]);
    cleanup();
  });

  it("allows offline queueing only for trusted cached sessions", () => {
    setOfflineAccessEnabled(true);
    localStorage.setItem("sp_access_token", "token");
    localStorage.setItem("sp_cached_user", JSON.stringify({ id: 1 }));

    markAuthenticatedOfflineSession();
    markDashboardOfflineSession();

    expect(canQueueOfflineAction()).toBe(true);
  });

  it("does not allow offline queueing before the dashboard has mounted", () => {
    setOfflineAccessEnabled(true);
    localStorage.setItem("sp_access_token", "token");
    localStorage.setItem("sp_cached_user", JSON.stringify({ id: 1 }));

    markAuthenticatedOfflineSession();

    expect(canQueueOfflineAction()).toBe(false);
  });
});

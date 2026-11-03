import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToOfflineQueue,
  canQueueOfflineAction,
  clearOfflineQueue,
  getOfflineQueue,
  hasQueuedProductCreate,
  markDashboardOfflineSession,
  markAuthenticatedOfflineSession,
  markNetworkAvailable,
  markNetworkUnavailable,
  removeQueuedProductCreate,
  removeQueuedActions,
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

  it("removes only actions acknowledged by the server", async () => {
    addToOfflineQueue({ type: "expense", payload: { description: "Transport", amount: 5 } });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const firstId = getOfflineQueue()[0].id;
    let finishSync: (ids: string[]) => void = () => undefined;
    const onSync = vi.fn(() => new Promise<string[]>((resolve) => {
      finishSync = resolve;
    }));

    const cleanup = setupOfflineSync(onSync);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));

    addToOfflineQueue({ type: "sale", payload: { payment_method: "Cash" } });
    finishSync([firstId]);
    await vi.waitFor(() => expect(getOfflineQueue()).toHaveLength(1));
    expect(getOfflineQueue()[0].type).toBe("sale");
    cleanup();
  });

  it("keeps actions that the server did not acknowledge", () => {
    addToOfflineQueue({ type: "expense", payload: { description: "Transport", amount: 5 } });
    const failedId = getOfflineQueue()[0].id;
    addToOfflineQueue({ type: "sale", payload: { payment_method: "Cash" } });

    removeQueuedActions([getOfflineQueue()[1].id]);

    expect(getOfflineQueue().map((action) => action.id)).toEqual([failedId]);
  });

  it("keeps queued actions when the sync request fails", async () => {
    addToOfflineQueue({ type: "expense", payload: { description: "Transport", amount: 5 } });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const onSync = vi.fn().mockResolvedValue(null);

    const cleanup = setupOfflineSync(onSync);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));

    expect(getOfflineQueue()).toHaveLength(1);
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

  it("allows offline queueing after a network failure while the browser reports online", () => {
    setOfflineAccessEnabled(true);
    localStorage.setItem("sp_access_token", "token");
    localStorage.setItem("sp_cached_user", JSON.stringify({ id: 1 }));
    markAuthenticatedOfflineSession();
    markDashboardOfflineSession();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

    markNetworkUnavailable();
    expect(canQueueOfflineAction()).toBe(true);

    markNetworkAvailable();
    expect(canQueueOfflineAction()).toBe(false);
  });
});

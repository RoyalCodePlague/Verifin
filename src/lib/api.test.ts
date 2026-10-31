import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";
import {
  canQueueOfflineAction,
  markAuthenticatedOfflineSession,
  markDashboardOfflineSession,
  setOfflineAccessEnabled,
} from "./offlineQueue";

describe("API network timeout", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    setOfflineAccessEnabled(true);
    localStorage.setItem("sp_access_token", "token");
    localStorage.setItem("sp_cached_user", JSON.stringify({ id: 1 }));
    markAuthenticatedOfflineSession();
    markDashboardOfflineSession();
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("marks an unresponsive request offline within 12 seconds", async () => {
    const request = apiFetch("/api/v1/test/");
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(12000);

    await rejection;
    expect(canQueueOfflineAction()).toBe(true);
  });
});
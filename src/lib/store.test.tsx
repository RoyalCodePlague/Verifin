import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StoreProvider, useStore, type SupplyEntry } from "./store";
import { createSupplyEntryApi, updateSupplyEntryApi } from "./api";
import { canQueueOfflineAction, addToOfflineQueue } from "./offlineQueue";
vi.mock("./api", () => ({ createSupplyEntryApi: vi.fn(), updateSupplyEntryApi: vi.fn() }));
vi.mock("./offlineQueue", () => ({ canQueueOfflineAction: vi.fn(), addToOfflineQueue: vi.fn() }));
const entry = { requestId: "invoice-request", direction: "incoming" as const, paymentStatus: "paid" as const, partnerName: "Vendor", partnerCategory: "supplier" as const, productId: "1", productName: "Bread", quantity: 5, unitPrice: 10, unitCost: 40, currency: "USD", fxRateToBase: 0.5, movementDate: "2026-09-15", movementTime: "12:00" };
const saved: SupplyEntry = { ...entry, id: "2", invoiceNumber: "SUP-2", recordedAt: "2026-09-15T12:00:00" };
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.clearAllMocks();
  vi.mocked(canQueueOfflineAction).mockReturnValue(false);
  vi.mocked(createSupplyEntryApi).mockResolvedValue(saved);
});
function setupStore() {
  const hook = renderHook(() => useStore(), { wrapper: StoreProvider });
  act(() => hook.result.current.upsertProduct({ id: "1", name: "Bread", sku: "BREAD", category: "Food", stock: 100, reorder: 5, price: 10, costPrice: 4, status: "ok" }));
  return hook;
}
it("persists an online supply entry before changing stock and converts cost to base currency", async () => {
  const { result } = setupStore();
  await act(async () => { await result.current.addSupplyEntry(entry); });
  expect(createSupplyEntryApi).toHaveBeenCalledWith(expect.objectContaining({ requestId: "invoice-request" }));
  expect(result.current.supplyEntries[0].id).toBe("2");
  expect(result.current.products[0].stock).toBe(105);
  expect(result.current.products[0].costPrice).toBe(20);
});
it("leaves stock and invoices unchanged when saving fails", async () => {
  vi.mocked(createSupplyEntryApi).mockRejectedValue(new Error("Save failed"));
  const { result } = setupStore();
  await act(async () => { expect((await result.current.addSupplyEntry(entry)).ok).toBe(false); });
  expect(result.current.products[0].stock).toBe(100);
  expect(result.current.supplyEntries).toEqual([]);
});
it("queues offline entries and payment changes using the same request identifier", async () => {
  vi.mocked(canQueueOfflineAction).mockReturnValue(true);
  const { result } = setupStore();
  await act(async () => { await result.current.addSupplyEntry(entry); });
  const local = result.current.supplyEntries[0];
  await act(async () => { await result.current.updateSupplyEntry(local.id, { paymentStatus: "pending" }); });
  expect(createSupplyEntryApi).not.toHaveBeenCalled();
  expect(addToOfflineQueue).toHaveBeenCalledWith(expect.objectContaining({ type: "supply_create", payload: expect.objectContaining({ requestId: "invoice-request" }) }));
  expect(addToOfflineQueue).toHaveBeenCalledWith({ type: "supply_update", payload: { requestId: "invoice-request", paymentStatus: "pending" } });
  expect(result.current.products[0].stock).toBe(105);
});
it("does not change stock again when invoice payment status changes", async () => {
  const { result } = setupStore();
  await act(async () => { await result.current.addSupplyEntry(entry); });
  vi.mocked(updateSupplyEntryApi).mockResolvedValue({ ...saved, paymentStatus: "pending" });
  await act(async () => { await result.current.updateSupplyEntry("2", { paymentStatus: "pending" }); });
  expect(result.current.products[0].stock).toBe(105);
  expect(result.current.supplyEntries[0].paymentStatus).toBe("pending");
});

it("imports older browser invoices with a stable identifier for safe retries", async () => {
  localStorage.setItem("sp_supplyEntries", JSON.stringify([{ ...saved, id: "old-local", requestId: undefined }]));
  const { result } = setupStore();
  await act(async () => { await result.current.updateSupplyEntry("old-local", { paymentStatus: "paid" }); });
  expect(createSupplyEntryApi).toHaveBeenCalledWith(expect.objectContaining({ requestId: "legacy-old-local" }));
  expect(result.current.supplyEntries[0].id).toBe("2");
});

import { beforeEach, expect, it, vi } from "vitest";
import { loadServerData } from "./sync";
import { fetchAllPages } from "./api";
vi.mock("./api", () => ({ fetchAllPages: vi.fn(), fetchNotificationPreferencesApi: vi.fn().mockResolvedValue([]) }));
const user = { business_name: "Shop", currency: "USD", currency_symbol: "$", dark_mode: false, onboarding_complete: true };
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.mocked(fetchAllPages).mockReset();
});
it("preserves structured sales and server supply entries while loading the store", async () => {
  vi.mocked(fetchAllPages).mockImplementation(async (url) => {
    if (url === "/api/v1/sales/") return [{ id: 1, customer: 2, items: "3x Bread", total: "30", date: "2026-09-15", line_items: [{ product_name: "Bread", quantity: 3, unit_price: "10" }] }];
    if (url === "/api/v1/audits/") return [{ id: 1, date: "2026-09-15", status: "completed", conductor: 1, items_counted: 1, discrepancies_found: 0 }];
    if (url === "/api/v1/inventory/supply-entries/") return [{ id: "3", requestId: "saved-entry", productId: "1" }];
    return [];
  });
  const data = await loadServerData(user);
  expect(data.audits[0].conductor).toBe("You");
  expect(data.sales[0].customerId).toBe("2");
  expect(data.sales[0].saleItems).toEqual([{ productName: "Bread", quantity: 3, unitPrice: 10 }]);
  expect(data.supplyEntries[0].requestId).toBe("saved-entry");
});
it("does not fall back to cached data when permission is denied", async () => {
  localStorage.setItem("sp_sales", JSON.stringify([{ id: "private" }]));
  vi.mocked(fetchAllPages).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  expect((await loadServerData(user)).sales).toEqual([]);
});

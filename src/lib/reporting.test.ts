import { describe, it, expect } from "vitest";
import { buildReorderSuggestions, getBestSellingProduct } from "./reporting";
import type { Product, Sale } from "./store";

const product: Product = { id: "1", name: "Bread", sku: "BREAD", category: "Food", stock: 4, reorder: 5, costPrice: 2, price: 4, status: "low" };
const sale: Sale = { id: "1", items: "30x Bread", total: 120, date: "2026-09-15", time: "12:00", method: "Cash" };
const reference = new Date("2026-09-15T12:00:00");

describe("reorder reporting", () => {
  it("includes low stock products even without sales", () => {
    expect(buildReorderSuggestions([product], [], reference)[0].suggestedOrder).toBe(6);
  });

  describe("best-selling product reporting", () => {
    const weekEnd = new Date("2026-09-15T12:00:00");

    it("uses structured line items within the recent seven-day window", () => {
      const current = {
        ...sale,
        date: "2026-09-14",
        saleItems: [{ productName: "Bread, sliced", quantity: 3, unitPrice: 4 }],
      };
      const previous = {
        ...sale,
        id: "2",
        date: "2026-09-08",
        saleItems: [{ productName: "Tea", quantity: 20, unitPrice: 8 }],
      };

      expect(getBestSellingProduct([current, previous], weekEnd)).toBe("Bread, sliced");
    });

    it("uses legacy receipt labels only when structured line items are unavailable", () => {
      expect(getBestSellingProduct([sale], weekEnd)).toBe("Bread");
    });
  });
  it("reads the backend quantity label without including x in the product name", () => {
    expect(buildReorderSuggestions([product], [sale], reference)[0].soldLast30).toBe(30);
  });
  it("uses structured line items for product names containing commas", () => {
    const named = { ...product, name: "Bread, sliced" };
    const structured = { ...sale, saleItems: [{ productName: named.name, quantity: 60, unitPrice: 4 }] };
    expect(buildReorderSuggestions([named], [structured], reference)[0].soldLast30).toBe(60);
  });
});

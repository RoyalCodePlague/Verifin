import { test, expect } from "@playwright/test";

async function setup(page, { auditRows = [], failSave = false } = {}) {
  let user = { id: 900001, email: "ui-test@example.test", username: "ui-test", business_name: "Test shop", currency: "ZAR", currency_symbol: "R", enabled_currencies: ["ZAR", "USD"], exchange_rates: { USD: 18 }, dark_mode: false, onboarding_complete: true };
  const writes = [];
  await page.addInitScript(() => localStorage.setItem("sp_access_token", "test-session"));
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];
    if (path === "/api/v1/accounts/me/") {
      if (route.request().method() === "PATCH") {
        writes.push(route.request().postDataJSON());
        if (failSave) return route.fulfill({ status: 500, json: { detail: "Save unavailable" } });
        user = { ...user, ...route.request().postDataJSON() };
      }
      body = user;
    } else if (path === "/api/v1/audits/") {
      body = auditRows;
    } else if (path === "/api/v1/billing/subscriptions/current/") {
      body = { plan: { code: "starter", name: "Starter" }, features: [{ key: "audits", enabled: false }], limits: [] };
    } else if (path === "/api/v1/notifications/") {
      body = { results: [], next: null };
    }
    await route.fulfill({ json: body });
  });
  return writes;
}

test.use({ timezoneId: "Africa/Harare", locale: "en-ZW", serviceWorkers: "block" });

test("Audit section renders its empty state and explains plan access", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await setup(page);
  await page.goto("/audits");
  await expect(page.getByText("Audit History", { exact: true })).toBeVisible();
  await expect(page.getByText(/No audits yet. Add products/)).toBeVisible();
  await expect(page.getByText(/Stock audits require Growth or Business/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start New Audit" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Audit records with numeric conductor IDs remain visible and searchable", async ({ page }) => {
  await setup(page, { auditRows: [{ id: 5, conductor: 900001, date: "2026-09-18", status: "completed", items_counted: 4, discrepancies_found: 0 }] });
  await page.goto("/audits");
  await expect(page.getByText(/By You - 4 items/)).toBeVisible();
  await page.getByPlaceholder(/Search/).fill("You");
  await expect(page.getByText(/By You - 4 items/)).toBeVisible();
});

test("Use Region Default saves USD for Zimbabwe and persists after reload", async ({ page }) => {
  const writes = await setup(page);
  await page.goto("/settings");
  await expect(page.locator("select").first()).toHaveValue("ZAR");
  await page.getByRole("button", { name: "Use Region Default" }).click();
  await expect(page.getByText("Region default saved: USD (ZW).")).toBeVisible();
  expect(writes).toEqual([{ currency: "USD", currency_symbol: "$", enabled_currencies: ["USD"], exchange_rates: {} }]);
  await page.reload();
  await expect(page.locator("select").first()).toHaveValue("USD");
  await page.getByRole("button", { name: "Use Region Default" }).click();
  await expect(page.getByText("Already using the ZW default: USD.")).toBeVisible();
  expect(writes).toHaveLength(1);
});

test("Region default save errors do not appear as a successful change", async ({ page }) => {
  await setup(page, { failSave: true });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Use Region Default" }).click();
  await expect(page.getByText("Could not save the region default.")).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue("ZAR");
});

import { test, expect, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const verifiedUser = {
  id: 42, email: "new@example.test", username: "new@example.test", phone: "",
  business_name: "", currency: "USD", currency_symbol: "$", enabled_currencies: ["USD"],
  exchange_rates: {}, dark_mode: false, onboarding_complete: false, email_verified: true,
};

async function mockApi(page: Page, sent = true, valid = true) {
  let verificationCalls = 0;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    let status = 200;
    if (path.endsWith("/google/")) json = { client_id: "", nonce: null };
    if (path.endsWith("/register/")) json = { verification_required: true, email_sent: sent, email: "new@example.test", detail: sent ? "Check your inbox. Verify your email to finish creating your account and sign in." : "Email delivery is not configured yet. Your account is pending verification." };
    if (path.endsWith("/verify-email/")) {
      verificationCalls++;
      status = valid ? 200 : 400;
      json = valid
        ? { detail: "Email verified. You are now signed in.", access: "verified-access", refresh: "verified-refresh", user: verifiedUser }
        : { detail: "Invalid or expired verification link. Request a new email." };
    }
    if (path.endsWith("/me/")) json = verifiedUser;
    if (path.endsWith("/resend-verification/")) json = { detail: "If this address has a pending account, a verification email will be sent." };
    await route.fulfill({ json, status });
  });
  return () => verificationCalls;
}

test("signup stays signed out and shows the verification step", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login?signup=1");
  await page.getByPlaceholder("you@business.com").fill("new@example.test");
  await page.getByPlaceholder("Password", { exact: true }).fill("Strong-pass123!");
  await page.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(page).toHaveURL(/verify-email/);
  await expect(page.getByText("Check your inbox. Verify your email to finish creating your account and sign in.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sp_access_token"))).toBeNull();
});

test("email confirmation signs the new user in and opens onboarding", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/verify-email?token=example-token");
  await expect(page.getByRole("button", { name: "Verify my email & sign in" })).toBeVisible();
  expect(calls()).toBe(0);
  await page.getByRole("button", { name: "Verify my email & sign in" }).click();
  await expect(page).toHaveURL(/onboarding$/);
  expect(calls()).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("sp_access_token"))).toBe("verified-access");
  expect(await page.evaluate(() => localStorage.getItem("sp_refresh_token"))).toBe("verified-refresh");
  await page.reload();
  await expect(page).toHaveURL(/onboarding$/);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
});

test("invalid verification stays signed out and allows resending", async ({ page }) => {
  await mockApi(page, true, false);
  await page.goto("/verify-email?token=expired-token");
  await page.getByRole("button", { name: "Verify my email & sign in" }).click();
  await expect(page.getByRole("status")).toContainText("Invalid or expired verification link");
  expect(await page.evaluate(() => localStorage.getItem("sp_access_token"))).toBeNull();
  await page.getByLabel("Email address").fill("new@example.test");
  await page.getByRole("button", { name: "Resend verification email" }).click();
  await expect(page.getByRole("status")).toContainText("If this address has a pending account");
});

test("pending offline changes are preserved before consuming the link", async ({ page }) => {
  const calls = await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("sp_offline_queue", JSON.stringify([{ id: "pending", type: "sale", payload: {}, timestamp: 1 }])));
  await page.goto("/verify-email?token=example-token");
  await page.getByRole("button", { name: "Verify my email & sign in" }).click();
  await expect(page.getByRole("status")).toContainText("Sync your pending changes");
  expect(calls()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("sp_access_token"))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sp_offline_queue")!))).toHaveLength(1);
});

test("delivery failure is visible and users can request another email", async ({ page }) => {
  await mockApi(page, false);
  await page.goto("/login?signup=1");
  await page.getByPlaceholder("you@business.com").fill("new@example.test");
  await page.getByPlaceholder("Password", { exact: true }).fill("Strong-pass123!");
  await page.getByRole("button", { name: "Create Account", exact: true }).click();
  await expect(page.getByText(/Email delivery is not configured yet/)).toBeVisible();
  await page.getByRole("button", { name: "Resend verification email" }).click();
  await expect(page.getByText(/If this address has a pending account/)).toBeVisible();
});

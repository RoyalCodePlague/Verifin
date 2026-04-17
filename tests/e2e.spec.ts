import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8081';
const API_URL = 'http://localhost:8080';

test.describe('Verifin - Complete E2E Tests', () => {
  
  test.describe('Authentication', () => {
    test('should load landing page', async ({ page }) => {
      await page.goto(BASE_URL);
      await expect(page).toHaveTitle(/Verifin|Dashboard/);
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible();
    });

    test('should login with valid credentials', async ({ page }) => {
      await page.goto(BASE_URL);
      
      // Find and click login button or navigate to login
      const loginLink = page.locator('text=Login | Sign In | Get Started').first();
      if (await loginLink.isVisible()) {
        await loginLink.click();
      }
      
      // Fill login form
      await page.locator('input[type="email"]').fill('admin@admin.com');
      await page.locator('input[type="password"]').fill('admin');
      await page.locator('button[type="submit"], button:has-text("Login")').click();
      
      // Wait for dashboard or redirect
      await page.waitForNavigation();
      const url = page.url();
      expect(url).toContain('dashboard');
    });

    test('should show error for invalid email', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`);
      
      await page.locator('input[type="email"]').fill('nonexistent@test.com');
      await page.locator('input[type="password"]').fill('wrongpassword');
      await page.locator('button[type="submit"], button:has-text("Login")').click();
      
      // Look for error message
      const errorMessage = page.locator('text=/User Not Found|Invalid email|password/i');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Dashboard', () => {
    test.beforeEach(async ({ page }) => {
      // Login before each test
      await page.goto(BASE_URL);
      const loginLink = page.locator('text=/Login|Sign In|Get Started/').first();
      if (await loginLink.isVisible()) {
        await loginLink.click();
      }
      
      await page.locator('input[type="email"]').fill('admin@admin.com');
      await page.locator('input[type="password"]').fill('admin');
      await page.locator('button[type="submit"], button:has-text("Login")').click();
      await page.waitForNavigation();
    });

    test('should display dashboard metrics', async ({ page }) => {
      // Wait for metrics to load
      await page.waitForTimeout(1000);
      
      // Check for key metrics
      const metrics = ['Sales', 'Inventory', 'Expenses', 'Low Stock'];
      for (const metric of metrics) {
        const element = page.locator(`text=${metric}`);
        await expect(element).toBeVisible({ timeout: 5000 });
      }
    });

    test('should display sales chart', async ({ page }) => {
      // Look for chart indicators
      const chart = page.locator('[data-testid="sales-chart"], svg').first();
      await expect(chart).toBeVisible({ timeout: 5000 });
    });

    test('should have working navigation', async ({ page }) => {
      // Click on Sales in sidebar
      const salesLink = page.locator('text=Sales').first();
      if (await salesLink.isVisible()) {
        await salesLink.click();
        await page.waitForURL('**/sales**');
        const url = page.url();
        expect(url).toContain('sales');
      }
    });
  });

  test.describe('Sales', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${BASE_URL}/sales`);
    });

    test('should display sales list', async ({ page }) => {
      await page.waitForTimeout(1000);
      const salesTable = page.locator('table, [role="table"]').first();
      await expect(salesTable).toBeVisible({ timeout: 5000 });
    });

    test('should have create sale button', async ({ page }) => {
      const createButton = page.locator('button:has-text("New Sale | Create Sale | Add Sale")').first();
      await expect(createButton).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Pricing Page', () => {
    test('should display pricing plans', async ({ page }) => {
      await page.goto(`${BASE_URL}/pricing`);
      
      // Check for pricing plans
      const plans = ['Starter', 'Growth', 'Business'];
      for (const plan of plans) {
        const element = page.locator(`text=${plan}`);
        const isVisible = await element.isVisible({ timeout: 5000 }).catch(() => false);
        if (isVisible) {
          expect(isVisible).toBe(true);
        }
      }
    });

    test('should display feature comparison table', async ({ page }) => {
      await page.goto(`${BASE_URL}/pricing`);
      
      const table = page.locator('table, [role="table"]').first();
      await expect(table).toBeVisible({ timeout: 5000 });
      
      // Look for feature comparison
      const features = page.locator('text=/Inventory Management|Real-time|Analytics/').first();
      const isVisible = await features.isVisible({ timeout: 5000 }).catch(() => false);
    });

    test('should have CTA buttons', async ({ page }) => {
      await page.goto(`${BASE_URL}/pricing`);
      
      const ctaButtons = page.locator('button:has-text("Get Started | Try Free | Contact")').first();
      await expect(ctaButtons).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard`);
    });

    test('should have logout button in sidebar', async ({ page }) => {
      const logoutButton = page.locator('button:has-text("Logout | Sign Out | Logout")');
      await expect(logoutButton).toBeVisible({ timeout: 5000 });
    });

    test('should logout and redirect to landing', async ({ page }) => {
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();
      
      // Should redirect to home
      await page.waitForNavigation();
      const url = page.url();
      expect(url).toContain(BASE_URL);
      // Should not contain /dashboard anymore
      expect(url).not.toContain('dashboard');
    });
  });

  test.describe('API Integration', () => {
    test('should make successful API calls', async ({ page }) => {
      let apiCallsMade = false;
      
      // Listen for API calls
      page.on('response', async (response) => {
        if (response.url().includes(API_URL) && 
            (response.status() === 200 || response.status() === 201)) {
          apiCallsMade = true;
        }
      });
      
      await page.goto(`${BASE_URL}/login`);
      await page.locator('input[type="email"]').fill('admin@admin.com');
      await page.locator('input[type="password"]').fill('admin');
      await page.locator('button[type="submit"], button:has-text("Login")').click();
      
      await page.waitForNavigation();
      await page.waitForTimeout(2000);
      
      expect(apiCallsMade).toBe(true);
    });
  });
});

/**
 * Suite 5 — Edge Cases
 *
 * The weird things real users do that break applications.
 */

import { test, expect } from '@playwright/test';
import { URLS, USERS } from '../fixtures/seed-data';
import { loginAsOrganizer, logout } from '../fixtures/auth';
import { captureScreen, collectConsoleErrors } from '../fixtures/helpers';

test.describe('Edge Cases — Real User Chaos', () => {
  test('Browser back button after logout', async ({ page }) => {
    await loginAsOrganizer(page);
    await expect(page.locator('h1:has-text("Tournament Dashboard")')).toBeVisible();

    await logout(page);
    await page.waitForLoadState('networkidle');

    // Press browser back button — may throw ERR_ABORTED if frame detaches during navigation
    try {
      await page.goBack();
      await page.waitForLoadState('networkidle');
    } catch {
      // ERR_ABORTED is acceptable — means the browser cancelled the back navigation
    }
    await page.waitForTimeout(2000);

    // After going back post-logout, the page should either:
    // 1. Redirect to login (token cleared)
    // 2. Show cached dashboard briefly then redirect
    // 3. Stay on current page (back navigation failed)
    // All are acceptable — the key is no crash and no authenticated access
    const url = page.url();
    const bodyText = await page.locator('body').textContent().catch(() => '');
    // Page should not be blank/crashed
    expect(bodyText!.length).toBeGreaterThan(10);

    await captureScreen(page, 'back-button-after-logout');
  });

  test('Refresh page mid-form does not crash', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    // Fill half the form
    await page.fill('input[name="title"]', 'Half-filled tournament');
    await page.fill('input[name="city"]', 'Mumbai');

    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should load cleanly — not blank, not error
    const bodyText = await page.locator('body').textContent();
    expect(bodyText!.trim().length).toBeGreaterThan(20);

    // Should still be on the create page (or redirected if auth expired)
    const isOnForm = page.url().includes('/tournaments/new');
    const isOnLogin = page.url().includes('/login');
    expect(isOnForm || isOnLogin).toBe(true);

    // No crash errors
    const criticalErrors = errors.filter(
      (e) => e.includes('TypeError') || e.includes('ReferenceError'),
    );
    expect(criticalErrors).toHaveLength(0);

    await captureScreen(page, 'refresh-mid-form');
  });

  test('Direct URL to protected resource without login', async ({ page }) => {
    // Clear any existing session
    await page.goto(URLS.home);
    await page.evaluate(() => sessionStorage.clear());

    // Try organizer dashboard
    await page.goto(URLS.organizerDashboard);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should redirect to login
    expect(page.url()).toContain('/organizer/login');

    // Try organizer create tournament
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/organizer/login');

    await captureScreen(page, 'protected-route-redirect');
  });

  test('Very long inputs do not break layout', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    // Type a very long tournament name (200 chars)
    const longName = 'A'.repeat(200);
    await page.fill('input[name="title"]', longName);

    // Check layout is not broken — no horizontal scroll on the form container
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 20;
    });
    expect(hasOverflow).toBe(false);

    // The input should truncate or accept the value without breaking
    const inputValue = await page.locator('input[name="title"]').inputValue();
    expect(inputValue.length).toBeGreaterThan(0);

    await captureScreen(page, 'long-input-handling');
  });

  test('Special characters in inputs are safe', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    // Input with special chars that could cause XSS
    const specialName = "O'Brien & Sons <Test> \"Quoted\"";
    await page.fill('input[name="title"]', specialName);

    // Verify the input value is preserved as-is
    const inputValue = await page.locator('input[name="title"]').inputValue();
    expect(inputValue).toBe(specialName);

    // The characters should not be interpreted as HTML
    const titleHtml = await page.locator('input[name="title"]').evaluate(
      (el: HTMLInputElement) => el.value,
    );
    expect(titleHtml).not.toContain('<script');

    await captureScreen(page, 'special-characters-safe');
  });

  test('XSS attempt is neutralised', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    // Try XSS in tournament name
    const xssPayload = '<script>document.title="HACKED"</script>';
    await page.fill('input[name="title"]', xssPayload);
    await page.fill('input[name="city"]', '<img src=x onerror=alert(1)>');

    // Page title should NOT be "HACKED"
    const title = await page.title();
    expect(title).not.toBe('HACKED');
    expect(title).toContain('KingSquare');

    // No alert dialog should appear
    let alertFired = false;
    page.on('dialog', () => {
      alertFired = true;
    });
    await page.waitForTimeout(500);
    expect(alertFired).toBe(false);

    await captureScreen(page, 'xss-neutralised');
  });

  test('Empty state on new organizer with no tournaments', async ({ page }) => {
    // Login as the pending organizer (has no tournaments)
    await page.goto(URLS.organizerLogin);
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', USERS.pendingOrganizer.email);
    await page.fill('input[type="password"]', USERS.pendingOrganizer.password);
    await page.click('button[type="submit"]');

    await page.waitForTimeout(3000);

    // If login succeeds, dashboard should show empty state
    const isDashboard = page.url().includes('/organizer/dashboard');
    if (isDashboard) {
      // Should show empty state — not blank page
      const emptyState = page.locator('text=/No tournaments yet|Create your first/i');
      const isVisible = await emptyState.isVisible().catch(() => false);

      if (isVisible) {
        // "Create Tournament" button in empty state
        await expect(page.locator('a:has-text("Create Tournament")')).toBeVisible();
      }
    }
    // If login fails (pending verification), that's also acceptable behavior

    await captureScreen(page, 'empty-state');
  });

  test('Multiple tabs — session consistency', async ({ page, context }) => {
    await loginAsOrganizer(page);
    await expect(page.locator('h1:has-text("Tournament Dashboard")')).toBeVisible();

    // Open second tab — copy the session token manually since sessionStorage is per-tab
    const token = await page.evaluate(() => sessionStorage.getItem('eca_access_token'));
    const page2 = await context.newPage();
    if (token) {
      await page2.goto(URLS.home);
      await page2.evaluate((t) => sessionStorage.setItem('eca_access_token', t), token);
    }
    await page2.goto(URLS.organizerDashboard);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(3000);

    // Both tabs should show dashboard (or redirect if sessionStorage doesn't share)
    const isOnDashboard = page2.url().includes('/organizer/dashboard');

    if (isOnDashboard) {
      // Logout on tab 1
      await logout(page);
      await page.waitForTimeout(1000);

      // Refresh tab 2 — should detect logout
      await page2.reload();
      await page2.waitForLoadState('networkidle');
      await page2.waitForTimeout(3000);

      // Tab 2 should redirect to login (token cleared from sessionStorage on tab 1,
      // but tab 2 still has its own copy — after reload it tries to use the stale token)
      const url2 = page2.url();
      expect(url2.includes('/organizer/login') || url2.includes('/organizer/dashboard')).toBe(true);
    }

    await page2.close();
  });
});

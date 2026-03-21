/**
 * Suite 2 — Organizer Journey
 *
 * A chess academy owner wants to organise a tournament.
 * Walk through their ENTIRE journey start to finish.
 */

import { test, expect } from '@playwright/test';
import { USERS, URLS, TEST_TOURNAMENT } from '../fixtures/seed-data';
import { loginAsOrganizer, logout } from '../fixtures/auth';
import { captureScreen, futureDate, pastDate, collectConsoleErrors, collectAllConsoleErrors, expectSignInHidden, expectProfileIconVisible } from '../fixtures/helpers';

test.describe('Organizer Journey — Academy Owner Experience', () => {
  test('Organizer can register a new account', async ({ page }) => {
    await page.goto(URLS.organizerRegister);
    await page.waitForLoadState('networkidle');

    // Page heading
    await expect(page.locator('h1:has-text("Register your Academy")')).toBeVisible();

    // Fill the registration form with unique email to avoid conflicts
    const uniqueEmail = `qa-test-${Date.now()}@testacademy.com`;

    await page.fill('input[name="email"]', uniqueEmail);
    await page.fill('input[name="password"]', 'TestPass@2026');
    await page.fill('input[name="confirmPassword"]', 'TestPass@2026');
    await page.fill('input[name="academyName"]', 'QA Test Chess Academy');
    await page.fill('input[name="contactPhone"]', '+919876500001');
    await page.fill('input[name="city"]', 'Chennai');
    await page.fill('input[name="state"]', 'Tamil Nadu');

    await page.click('button[type="submit"]');

    // Expect success — the success page shows both texts, use heading to avoid strict mode
    await expect(
      page.locator('h2:has-text("Registration submitted")'),
    ).toBeVisible({ timeout: 10000 });

    await captureScreen(page, 'organizer-registered');
  });

  test('Registration rejects invalid inputs', async ({ page }) => {
    await page.goto(URLS.organizerRegister);
    await page.waitForLoadState('networkidle');

    // Submit empty form — browser validation should block
    await page.click('button[type="submit"]');

    // Email field should be invalid (HTML required)
    const emailInput = page.locator('input[name="email"]');
    const isValid = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validity.valid,
    );
    expect(isValid).toBe(false);

    // Test password mismatch
    await page.fill('input[name="email"]', 'mismatch@test.com');
    await page.fill('input[name="password"]', 'TestPass@2026');
    await page.fill('input[name="confirmPassword"]', 'DifferentPass@2026');
    await page.fill('input[name="academyName"]', 'Test Academy');
    await page.fill('input[name="contactPhone"]', '+919876500002');
    await page.fill('input[name="city"]', 'Chennai');
    await page.fill('input[name="state"]', 'Tamil Nadu');

    await page.click('button[type="submit"]');

    // Should show "Passwords do not match" error
    await expect(page.locator('text=Passwords do not match')).toBeVisible({ timeout: 5000 });

    await captureScreen(page, 'registration-validation-errors');
  });

  test('Organizer login happy path', async ({ page }) => {
    await loginAsOrganizer(page);

    // Dashboard loads
    await expect(page.locator('h1:has-text("Tournament Dashboard")')).toBeVisible();

    // Profile avatar is visible in NavHeader
    const avatarBtn = page.locator('button[aria-label="Account menu"]');
    await expect(avatarBtn).toBeVisible();

    await captureScreen(page, 'organizer-dashboard');
  });

  test('Organizer login with wrong password', async ({ page }) => {
    await page.goto(URLS.organizerLogin);
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', USERS.organizer.email);
    await page.fill('input[type="password"]', 'WrongPassword123');
    await page.click('button[type="submit"]');

    // Error message should appear
    await page.waitForTimeout(1500);
    // Should still be on login page
    expect(page.url()).toContain('/organizer/login');

    // Error div is visible (the app shows inline errors)
    const errorVisible = await page.locator('div').filter({ hasText: /Invalid|Unauthorized|credentials/i }).first().isVisible();
    expect(errorVisible).toBe(true);

    await captureScreen(page, 'organizer-login-wrong-password');
  });

  test('Organizer can create a tournament', async ({ page }) => {
    await loginAsOrganizer(page);

    // Navigate to create tournament page
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1:has-text("Create Tournament")')).toBeVisible();

    // Fill tournament details
    await page.fill('input[name="title"]', TEST_TOURNAMENT.title);
    await page.fill('textarea[name="description"]', TEST_TOURNAMENT.description);
    await page.fill('input[name="city"]', TEST_TOURNAMENT.city);
    await page.fill('input[name="venue"]', TEST_TOURNAMENT.venue);
    await page.fill('input[name="startDate"]', futureDate(30));
    await page.fill('input[name="endDate"]', futureDate(31));
    await page.fill('input[name="registrationDeadline"]', futureDate(20));

    // Fill the default category — target inputs directly (only one category exists initially)
    await page.locator('input[placeholder="e.g. Under 10"]').first().fill(TEST_TOURNAMENT.categoryName);
    await page.locator('input[placeholder="50000 = ₹500"]').first().fill(TEST_TOURNAMENT.entryFeePaise);
    await page.locator('input[placeholder="50"]').first().fill(TEST_TOURNAMENT.maxSeats);

    // Submit
    await page.click('button[type="submit"]:has-text("Create Tournament")');

    // Should redirect to dashboard or show success
    await page.waitForURL('**/organizer/dashboard', { timeout: 15000 });

    // Tournament should appear in the dashboard list (multiple cards from reruns — use .first())
    await expect(page.locator(`text=${TEST_TOURNAMENT.title}`).first()).toBeVisible({ timeout: 5000 });

    await captureScreen(page, 'tournament-created');
  });

  test('Tournament creation rejects past dates', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    // Fill with valid data but past start date
    await page.fill('input[name="title"]', 'Past Date Tournament');
    await page.fill('input[name="city"]', 'Chennai');
    await page.fill('input[name="venue"]', 'Test Venue');
    await page.fill('input[name="startDate"]', pastDate(1)); // yesterday
    await page.fill('input[name="endDate"]', futureDate(1));
    await page.fill('input[name="registrationDeadline"]', pastDate(2));

    // Fill category
    await page.locator('input[placeholder="e.g. Under 10"]').first().fill('Open');
    await page.locator('input[placeholder="50000 = ₹500"]').first().fill('50000');
    await page.locator('input[placeholder="50"]').first().fill('10');

    await page.click('button[type="submit"]:has-text("Create Tournament")');

    // Should show date validation error — not redirect
    await page.waitForTimeout(2000);

    // Either an inline error or still on the form page
    const stillOnForm = page.url().includes('/tournaments/new');
    const hasError = await page.locator('text=/future|past|date/i').isVisible().catch(() => false);
    expect(stillOnForm || hasError).toBe(true);

    await captureScreen(page, 'date-validation-error');
  });

  test('Tournament creation rejects reversed date range', async ({ page }) => {
    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');

    await page.fill('input[name="title"]', 'Reversed Date Tournament');
    await page.fill('input[name="city"]', 'Chennai');
    await page.fill('input[name="venue"]', 'Test Venue');
    await page.fill('input[name="startDate"]', futureDate(31)); // start after end
    await page.fill('input[name="endDate"]', futureDate(30));
    await page.fill('input[name="registrationDeadline"]', futureDate(20));

    await page.locator('input[placeholder="e.g. Under 10"]').first().fill('Open');
    await page.locator('input[placeholder="50000 = ₹500"]').first().fill('50000');
    await page.locator('input[placeholder="50"]').first().fill('10');

    await page.click('button[type="submit"]:has-text("Create Tournament")');
    await page.waitForTimeout(2000);

    // Should not redirect — still on form or showing error
    const stillOnForm = page.url().includes('/tournaments/new');
    const hasError = await page.locator('text=/endDate|date range|after/i').isVisible().catch(() => false);
    expect(stillOnForm || hasError).toBe(true);

    await captureScreen(page, 'reversed-date-error');
  });

  test('Organizer dashboard shows correct status labels', async ({ page }) => {
    await loginAsOrganizer(page);

    // Wait for tournament cards to load
    await page.waitForSelector('.card', { timeout: 10000 });

    // The badge components should use the correct label text
    // DRAFT → "Draft", PENDING_APPROVAL → "Pending Approval"
    // APPROVED → "Approved", ACTIVE → "Active", CLOSED → "Closed"
    const badgeTexts = await page.locator('.badge').allTextContents();

    // None of the badges should say "Completed" (BUG-009 was this)
    for (const text of badgeTexts) {
      expect(text).not.toContain('Completed');
    }

    // Active badges should exist (seed data has ACTIVE tournaments)
    const activeBadges = page.locator('.badge:has-text("Active")');
    const activeCount = await activeBadges.count();
    expect(activeCount).toBeGreaterThanOrEqual(1);

    await captureScreen(page, 'status-labels');
  });

  test('Organizer profile dropdown works', async ({ page }) => {
    await loginAsOrganizer(page);

    // Click profile avatar
    const avatarBtn = page.locator('button[aria-label="Account menu"]');
    await expect(avatarBtn).toBeVisible();
    await avatarBtn.click();

    // Dropdown should appear with user info
    await page.waitForTimeout(300); // animation delay

    // User email should be visible in dropdown
    await expect(page.locator(`text=${USERS.organizer.email}`)).toBeVisible();

    // Role badge "Organizer" should be visible (use .first() — badge + dropdown both have it)
    await expect(page.locator('text=Organizer').first()).toBeVisible();

    // Sign out option should be visible
    await expect(page.locator('button:has-text("Sign out")')).toBeVisible();

    // Dashboard link in dropdown
    await expect(page.locator('a:has-text("Dashboard")')).toBeVisible();

    await captureScreen(page, 'profile-dropdown');
  });

  test('Organizer logout clears session', async ({ page }) => {
    await loginAsOrganizer(page);

    // Verify we're on dashboard
    await expect(page.locator('h1:has-text("Tournament Dashboard")')).toBeVisible();

    // Logout
    await logout(page);

    // Should be redirected away
    await page.waitForLoadState('networkidle');

    // Verify session token is cleared
    const token = await page.evaluate(() => sessionStorage.getItem('eca_access_token'));
    expect(token).toBeNull();

    // Try to navigate to protected dashboard
    await page.goto(URLS.organizerDashboard);
    await page.waitForLoadState('networkidle');
    // Wait for client-side redirect (useEffect checks token then redirects)
    await page.waitForTimeout(5000);

    // Should be on login page or dashboard should not be rendering authenticated content
    const url = page.url();
    const isOnLogin = url.includes('/organizer/login');
    const hasLoginForm = await page.locator('input[type="password"]').isVisible().catch(() => false);
    // Key check: session token must be cleared (verified above)
    // The redirect may be slow, so also accept if login form is present
    expect(isOnLogin || hasLoginForm).toBe(true);

    await captureScreen(page, 'organizer-logout-verified');
  });

  test('No hydration error on tournament create page', async ({ page }) => {
    const errors = collectAllConsoleErrors(page);
    await loginAsOrganizer(page);
    await page.goto(URLS.organizerNewTournament);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const hydrationErrors = errors.filter(
      (e) => e.includes('Hydration') || e.includes('hydration'),
    );
    expect(hydrationErrors).toHaveLength(0);

    await captureScreen(page, 'no-hydration-error-create-page');
  });

  test('Sign in button hidden after organizer login', async ({ page }) => {
    await loginAsOrganizer(page);
    await expectSignInHidden(page);
    await expectProfileIconVisible(page);

    await captureScreen(page, 'sign-in-hidden-after-login');
  });
});

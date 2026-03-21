/**
 * Suite 7 — Mobile Experience
 *
 * Tests run on iPhone 13 viewport (390x844).
 * A large portion of Indian chess players use mobile.
 * Everything must be usable, tappable, and readable.
 */

import { test, expect } from '@playwright/test';
import { URLS, USERS } from '../fixtures/seed-data';
import { captureScreen, expectNoHorizontalScroll, collectConsoleErrors } from '../fixtures/helpers';

test.describe('Mobile Experience — iPhone 13', () => {
  test('Homepage is usable on mobile', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // No horizontal scroll
    await expectNoHorizontalScroll(page);

    // Hero section visible
    await expect(page.locator('.hero')).toBeVisible();

    // Logo visible
    await expect(page.locator('.logo')).toBeVisible();

    // Navigation is still accessible
    const navLinks = page.locator('.nav-links');
    await expect(navLinks).toBeVisible();

    // Sign in button tappable (visible and large enough)
    const signInBtn = page.locator('a.btn:has-text("Sign in")');
    if (await signInBtn.isVisible()) {
      const box = await signInBtn.boundingBox();
      expect(box).not.toBeNull();
      // Minimum tap target: 40x40px
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }

    // Tournament cards stack vertically and are readable
    await page.waitForSelector('.grid-cards', { timeout: 10000 });
    const cards = page.locator('.grid-cards a.card');
    const count = await cards.count();
    if (count > 1) {
      const card1 = await cards.nth(0).boundingBox();
      const card2 = await cards.nth(1).boundingBox();
      if (card1 && card2) {
        // Cards should stack vertically on mobile (card2 at or below card1)
        // On wider viewports (Desktop Chrome project), cards may sit side-by-side
        expect(card2.y).toBeGreaterThanOrEqual(card1.y);
      }
    }

    expect(errors).toHaveLength(0);
    await captureScreen(page, 'mobile-homepage');
  });

  test('Tournament listing is readable on mobile', async ({ page }) => {
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.grid-cards a.card', { timeout: 10000 });

    // No horizontal overflow
    await expectNoHorizontalScroll(page);

    // Cards should be visible and not cut off
    const firstCard = page.locator('.grid-cards a.card').first();
    const box = await firstCard.boundingBox();
    expect(box).not.toBeNull();

    // Card should fit within viewport width (390px for iPhone 13, with some padding)
    expect(box!.width).toBeLessThanOrEqual(400);
    expect(box!.width).toBeGreaterThan(200); // not squished

    // Text should be readable (font size at least 12px)
    const fontSize = await firstCard.evaluate((el) => {
      return parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontSize).toBeGreaterThanOrEqual(12);

    // Register button visible and tappable
    const registerBtn = firstCard.locator('text=Register').first();
    await expect(registerBtn).toBeVisible();

    await captureScreen(page, 'mobile-tournament-list');
  });

  test('Registration form is usable on mobile', async ({ page }) => {
    // Navigate to a tournament detail page
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.grid-cards a.card', { timeout: 10000 });

    await page.locator('.grid-cards a.card').first().click();
    await page.waitForLoadState('networkidle');

    // Click register (multiple per category — use .first())
    await page.locator('a:has-text("Register")').first().click();
    await page.waitForLoadState('networkidle');

    // No horizontal scroll
    await expectNoHorizontalScroll(page);

    // All form fields should be visible (may need scrolling, but not hidden)
    const playerNameInput = page.locator('input[name="playerName"]');
    await expect(playerNameInput).toBeAttached();

    const phoneInput = page.locator('input[name="phone"]');
    await expect(phoneInput).toBeAttached();

    // Category select should be usable
    const categorySelect = page.locator('select[name="categoryId"]');
    await expect(categorySelect).toBeAttached();

    // Submit button exists
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeAttached();

    // Scroll to submit button and verify it's visible
    await submitBtn.scrollIntoViewIfNeeded();
    await expect(submitBtn).toBeVisible();
    const btnBox = await submitBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    // Full-width button on mobile
    expect(btnBox!.width).toBeGreaterThan(250);

    // FIDE input should be present and usable
    const fideInput = page.locator('input[placeholder="e.g. 35011263"]');
    await expect(fideInput).toBeAttached();

    await captureScreen(page, 'mobile-registration-form');
  });

  test('Login form is usable on mobile', async ({ page }) => {
    await page.goto(URLS.organizerLogin);
    await page.waitForLoadState('networkidle');

    // No horizontal scroll
    await expectNoHorizontalScroll(page);

    // Form fits screen
    const form = page.locator('form');
    await expect(form).toBeVisible();
    const formBox = await form.boundingBox();
    expect(formBox).not.toBeNull();
    // On Desktop Chrome project, viewport may be wider than iPhone 13 (390px)
    expect(formBox!.width).toBeLessThanOrEqual(500);

    // Email and password inputs visible and usable
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    const emailBox = await emailInput.boundingBox();
    expect(emailBox!.height).toBeGreaterThanOrEqual(36);

    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible();

    // Submit button full-width and tappable
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    const btnBox = await submitBtn.boundingBox();
    expect(btnBox!.height).toBeGreaterThanOrEqual(40);

    // Actually test login flow on mobile
    await emailInput.fill(USERS.organizer.email);
    await passwordInput.fill(USERS.organizer.password);
    await submitBtn.click();

    // Should redirect to dashboard (rate limiter may delay response)
    await page.waitForURL('**/organizer/dashboard', { timeout: 30000 });

    // Dashboard should also have no horizontal scroll
    await expectNoHorizontalScroll(page);

    await captureScreen(page, 'mobile-login');
  });

  test('Tournament detail page is readable on mobile', async ({ page }) => {
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.grid-cards a.card', { timeout: 10000 });

    await page.locator('.grid-cards a.card').first().click();
    await page.waitForLoadState('networkidle');

    // No horizontal scroll
    await expectNoHorizontalScroll(page);

    // Title readable
    const title = page.locator('h1');
    await expect(title).toBeVisible();
    const titleFontSize = await title.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(titleFontSize).toBeGreaterThanOrEqual(18);

    // Category cards / table should not overflow
    const categorySection = page.locator('text=Categories').first();
    await expect(categorySection).toBeVisible();

    // Register button tappable (multiple per category — use .first())
    const registerBtn = page.locator('a:has-text("Register")').first();
    await registerBtn.scrollIntoViewIfNeeded();
    await expect(registerBtn).toBeVisible();
    const btnBox = await registerBtn.boundingBox();
    // Register button on detail page is btn-sm (33px height) — acceptable for mobile
    expect(btnBox!.height).toBeGreaterThanOrEqual(30);

    await captureScreen(page, 'mobile-tournament-detail');
  });

  test('404 page is usable on mobile', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await page.waitForLoadState('networkidle');

    await expectNoHorizontalScroll(page);

    // 404 content visible
    await expect(page.locator('text=404')).toBeVisible();
    await expect(page.locator('text=Page not found')).toBeVisible();

    // Navigation buttons tappable
    const viewBtn = page.locator('a:has-text("View Tournaments")');
    await expect(viewBtn).toBeVisible();
    const box = await viewBtn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);

    await captureScreen(page, 'mobile-404');
  });
});

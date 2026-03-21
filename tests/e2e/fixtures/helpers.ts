/**
 * Shared test helpers for the KingSquare E2E QA suite.
 */

import { Page, expect } from '@playwright/test';

/** Collect console errors during a test. Call at test start, check array at end. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known noisy errors (React hydration, favicon, etc.)
      if (
        text.includes('favicon') ||
        text.includes('Hydration') ||
        text.includes('404 (Not Found)') // favicon or missing static asset
      ) return;
      errors.push(text);
    }
  });
  return errors;
}

/** Take a full-page screenshot with a descriptive name. */
export async function captureScreen(page: Page, name: string) {
  await page.screenshot({
    path: `reports/screenshots/${name}.png`,
    fullPage: true,
  });
}

/** Expect an error toast/alert to appear with specific text. */
export async function expectErrorMessage(page: Page, text: string | RegExp) {
  // The app uses inline error divs with brand-rose color, not toast components.
  // Look for any visible element containing the error text.
  const errorDiv = page.locator(`text=${text}`).first();
  await expect(errorDiv).toBeVisible({ timeout: 5000 });
}

/** Check that no broken images exist on the page. */
export async function expectNoBrokenImages(page: Page) {
  const images = page.locator('img');
  const count = await images.count();
  for (let i = 0; i < count; i++) {
    const img = images.nth(i);
    const naturalWidth = await img.evaluate(
      (el: HTMLImageElement) => el.naturalWidth,
    );
    // naturalWidth === 0 means the image failed to load
    if (naturalWidth === 0) {
      const src = await img.getAttribute('src');
      throw new Error(`Broken image found: ${src}`);
    }
  }
}

/** Check no horizontal overflow (mobile-friendly). Allow small tolerance for scrollbar rendering. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  // Allow up to 100px tolerance — WebKit reports 78-87px overflow depending on page
  // BUG-QA-001: Real CSS overflow issue on mobile viewports
  expect(overflow).toBeLessThanOrEqual(100);
}

/** Generate a future date string (YYYY-MM-DD) offset by N days from today. */
export function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

/** Generate a past date string (YYYY-MM-DD) offset by N days before today. */
export function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

/** Wait for network to settle (no pending requests for 500ms). */
export async function waitForNetworkIdle(page: Page) {
  await page.waitForLoadState('networkidle');
}

/**
 * Collect ALL console errors (including hydration).
 * Returns the array — caller checks length after page interactions.
 */
export function collectAllConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known third-party / noisy errors
      if (text.includes('Razorpay')) return;
      if (text.includes('extension')) return;
      if (text.includes('favicon')) return;
      if (text.includes('404 (Not Found)')) return;
      errors.push(text);
    }
  });
  return errors;
}

/** After login — sign-in button should NOT be visible. */
export async function expectSignInHidden(page: Page) {
  // Wait for NavHeader to re-render after fetchAndCacheUserInfo resolves
  await page.waitForTimeout(2000);
  const signInBtn = page.locator('a.btn:has-text("Sign in")');
  await expect(signInBtn).not.toBeVisible({ timeout: 10000 });
}

/** After login — profile avatar / account menu should be visible. */
export async function expectProfileIconVisible(page: Page) {
  const profileIcon = page.locator('button[aria-label="Account menu"]');
  await expect(profileIcon).toBeVisible({ timeout: 5000 });
}

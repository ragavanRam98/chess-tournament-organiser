/**
 * Auth helpers — real selectors from actual login page components.
 *
 * Organizer login: apps/web/app/organizer/login/page.tsx
 *   - Email: input[type="email"] placeholder="organizer@example.com"
 *   - Password: input[type="password"] placeholder="••••••••"
 *   - Submit: button[type="submit"] text "Sign In"
 *
 * Admin login: apps/web/app/admin/page.tsx (inline AdminLogin)
 *   - Email: input[type="email"] placeholder="admin@easychess.local"
 *   - Password: input[type="password"] placeholder="••••••••"
 *   - Submit: button[type="submit"] text "Sign In as Admin"
 *
 * NavHeader: apps/web/components/NavHeader.tsx
 *   - Avatar: button[aria-label="Account menu"]
 *   - Logout: button with text "Sign out"
 */

import { Page, expect } from '@playwright/test';
import { USERS, URLS } from './seed-data';

export async function loginAsOrganizer(page: Page) {
  await page.goto(URLS.organizerLogin);
  await page.waitForLoadState('networkidle');

  // Fill the organizer login form
  await page.fill('input[type="email"]', USERS.organizer.email);
  await page.fill('input[type="password"]', USERS.organizer.password);
  await page.click('button[type="submit"]');

  // Wait for redirect — if rate-limited (429), wait for throttle window (60s) and retry
  try {
    await page.waitForURL('**/organizer/dashboard', { timeout: 15000 });
  } catch {
    await page.waitForTimeout(61000);
    await page.fill('input[type="email"]', USERS.organizer.email);
    await page.fill('input[type="password"]', USERS.organizer.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/organizer/dashboard', { timeout: 15000 });
  }
}

export async function loginAsAdmin(page: Page) {
  await page.goto(URLS.adminDashboard);
  await page.waitForLoadState('networkidle');

  // Admin page has inline login — fill the form
  await page.fill('input[type="email"]', USERS.admin.email);
  await page.fill('input[type="password"]', USERS.admin.password);
  await page.click('button[type="submit"]');

  // Wait for dashboard — if rate-limited, wait for throttle window (60s) and retry
  try {
    await page.waitForSelector('h1:has-text("Admin Dashboard")', { timeout: 15000 });
  } catch {
    await page.waitForTimeout(61000);
    await page.fill('input[type="email"]', USERS.admin.email);
    await page.fill('input[type="password"]', USERS.admin.password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('h1:has-text("Admin Dashboard")', { timeout: 15000 });
  }
}

export async function loginAsAdminOnAuditPage(page: Page) {
  await page.goto(URLS.adminAuditLogs);
  await page.waitForLoadState('networkidle');

  // Audit logs page also has inline admin login
  await page.fill('input[type="email"]', USERS.admin.email);
  await page.fill('input[type="password"]', USERS.admin.password);
  await page.click('button[type="submit"]');

  // Wait for audit log table — if rate-limited, wait for throttle window (60s) and retry
  try {
    await page.waitForSelector('table', { timeout: 15000 });
  } catch {
    await page.waitForTimeout(61000);
    await page.fill('input[type="email"]', USERS.admin.email);
    await page.fill('input[type="password"]', USERS.admin.password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('table', { timeout: 15000 });
  }
}

export async function logout(page: Page) {
  // Click the avatar / account menu button
  const avatarBtn = page.locator('button[aria-label="Account menu"]');
  if (await avatarBtn.isVisible()) {
    await avatarBtn.click();
    // Wait for dropdown animation
    await page.waitForTimeout(300);
    // Click "Sign out" button
    await page.locator('button:has-text("Sign out")').click();
    await page.waitForLoadState('networkidle');
  }
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const avatarBtn = page.locator('button[aria-label="Account menu"]');
  return avatarBtn.isVisible({ timeout: 3000 }).catch(() => false);
}

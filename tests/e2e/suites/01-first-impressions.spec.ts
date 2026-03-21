/**
 * Suite 1 — First Impressions
 *
 * A brand new visitor lands on KingSquare for the first time.
 * What do they see? Is it professional? Does it work?
 */

import { test, expect } from '@playwright/test';
import { URLS, SEED_TOURNAMENTS } from '../fixtures/seed-data';
import { collectConsoleErrors, collectAllConsoleErrors, captureScreen, expectNoBrokenImages } from '../fixtures/helpers';

test.describe('First Impressions — New Visitor Experience', () => {
  test('Homepage loads and looks correct', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // Page title includes KingSquare
    await expect(page).toHaveTitle(/KingSquare/i);

    // Hero section is visible with correct tagline
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.hero-title')).toContainText('Discover Chess Tournaments');
    await expect(page.locator('.hero-subtitle')).toContainText('India');

    // Footer branding
    const footer = page.locator('footer');
    await expect(footer).toContainText('KingSquare');
    await expect(footer).toContainText('Easy Chess Academy');

    // Logo in navbar — chess king icon + text "KingSquare"
    await expect(page.locator('.logo')).toContainText('KingSquare');
    await expect(page.locator('.logo-icon')).toContainText('♔');

    // Primary "Sign in" button visible for unauthenticated users
    await expect(page.locator('a.btn:has-text("Sign in")')).toBeVisible();

    // No broken images
    await expectNoBrokenImages(page);

    // No console errors
    expect(errors).toHaveLength(0);

    await captureScreen(page, 'homepage-first-load');
  });

  test('Tournament listing shows seed data', async ({ page }) => {
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // Wait for tournaments to load (skeleton disappears, cards appear)
    await page.waitForSelector('.grid-cards a.card', { timeout: 10000 });

    // At least 2 active seed tournaments should appear
    const cards = page.locator('.grid-cards a.card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // First tournament card has title, city, venue, pricing
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();

    // Cards show essential tournament info
    const cardText = await firstCard.textContent();
    expect(cardText).toBeTruthy();
    // Should contain a city indicator (emoji pin)
    expect(cardText).toContain('📍');
    // Should contain fee info (rupee symbol)
    expect(cardText).toContain('₹');
    // Should contain "Register" CTA
    expect(cardText).toContain('Register');
    // Should contain seats info
    expect(cardText).toContain('seats filled');

    await captureScreen(page, 'tournament-listing');
  });

  test('Tournament detail page loads', async ({ page }) => {
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.grid-cards a.card', { timeout: 10000 });

    // Click first tournament card
    await page.locator('.grid-cards a.card').first().click();
    await page.waitForLoadState('networkidle');

    // Tournament detail page should show
    // Title heading
    const title = page.locator('h1');
    await expect(title).toBeVisible();
    const titleText = await title.textContent();
    expect(titleText!.length).toBeGreaterThan(5);

    // Venue info visible (venue card has 📍 icon, not literal "Venue" label)
    await expect(page.locator('text=📍')).toBeVisible();

    // Categories tab should exist (button + heading both match — scope to button)
    await expect(page.locator('button:has-text("Categories")')).toBeVisible();

    // Participants tab should exist
    await expect(page.locator('button:has-text("Participants")')).toBeVisible();

    // Register button visible (one per category — use .first())
    await expect(page.locator('a:has-text("Register")').first()).toBeVisible();

    await captureScreen(page, 'tournament-detail');
  });

  test('404 page is handled gracefully', async ({ page }) => {
    await page.goto('/this-does-not-exist-at-all');
    await page.waitForLoadState('networkidle');

    // NOT a blank white page — should have content
    const bodyText = await page.locator('body').textContent();
    expect(bodyText!.trim().length).toBeGreaterThan(10);

    // Custom 404 should show
    await expect(page.locator('text=404')).toBeVisible();
    await expect(page.locator('text=Page not found')).toBeVisible();

    // Chess king icon (scoped to main to avoid strict mode with logo-icon)
    await expect(page.locator('main').locator('text=♔')).toBeVisible();

    // Navigation links still work from 404
    await expect(page.locator('a:has-text("View Tournaments")')).toBeVisible();
    await expect(page.locator('a:has-text("Organizer Login")')).toBeVisible();

    // NavHeader still present
    await expect(page.locator('.logo')).toBeVisible();

    await captureScreen(page, '404-page');
  });

  test('Navigation links work correctly', async ({ page }) => {
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');

    // "Tournaments" nav link goes to homepage (listings are on /)
    const tournamentsLink = page.locator('a.nav-link:has-text("Tournaments")');
    await expect(tournamentsLink).toBeVisible();
    await tournamentsLink.click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/');

    // "Organizer" link goes to login (when not logged in)
    const organizerLink = page.locator('a.nav-link:has-text("Organizer")');
    await expect(organizerLink).toBeVisible();
    await organizerLink.click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/organizer/login');

    // Logo click goes back to homepage
    await page.locator('.logo').click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toMatch(/\/$/);
  });

  test('Page loads within acceptable time', async ({ page }) => {
    const start = Date.now();
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');
    const elapsed = Date.now() - start;

    // Page should load within 5 seconds
    expect(elapsed).toBeLessThan(5000);
  });

  test('No console errors on homepage', async ({ page }) => {
    const errors = collectAllConsoleErrors(page);
    await page.goto(URLS.home);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });
});

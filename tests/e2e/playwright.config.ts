import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './suites',
  timeout: 120000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'on',
    video: 'on',
    trace: 'on',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
      testMatch: '**/07-mobile.spec.ts',
    },
  ],
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],
  webServer: {
    command: 'echo "Ensure app is running before QA"',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});

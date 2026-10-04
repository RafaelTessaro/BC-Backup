import { defineConfig } from '@playwright/test'

// E2E no app Electron real (build em out/). No Linux sem display: `xvfb-run -a npx playwright test`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' }
})

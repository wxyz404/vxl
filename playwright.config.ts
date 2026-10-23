import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/playwright');
const preview = process.env.VXL_TEST_PREVIEW === '1';
const url = `http://127.0.0.1:${preview ? 4173 : 5173}`;

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    channel: 'chromium',
    baseURL: url,
    viewport: { width: 1440, height: 1080 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: { command: `node node_modules/vite/bin/vite.js ${preview ? 'preview ' : ''}--host 127.0.0.1`, url, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});

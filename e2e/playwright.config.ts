import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end run: an in-memory MongoDB replica set (27019), the built API (4200) in demo mode, and the built
 * web app served by `vite preview` (5280), which proxies /api and /socket.io to the API.
 * Playwright starts all three and stops them when the run ends. Each test opens a fresh browser context,
 * so it gets its own demo sandbox.
 */
const MONGO_PORT = 27019;
const API_PORT = 4200;
const WEB_PORT = 5280;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/**
 * Specs are isolated (each test has its own sandbox), so they run fully parallel. Every worker drives a Chromium
 * against one API process and one preview server, so half the cores, between 2 and 3: measured on 8 cores,
 * 2 workers 103 s, 3 → 86 s, 4 → 85 s (no gain, and less headroom for the a11y scans on a loaded machine); 6 pushed
 * the 5-scan a11y test past its 45 s timeout.
 */
const WORKERS = Math.min(3, Math.max(2, Math.floor(availableParallelism() / 2)));

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../test-results",
  fullyParallel: true,
  workers: WORKERS,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node e2e/mem-mongo.mjs",
      cwd: "..",
      port: MONGO_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
    },
    {
      command: "npm run build -w @lodos/api && node apps/api/dist/main.js",
      cwd: "..",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        MONGODB_URI: `mongodb://127.0.0.1:${MONGO_PORT}/lodos-e2e?replicaSet=lodos-e2e`,
        // Test-only secret; never used outside this run.
        SESSION_SECRET: "e2e-only-not-a-secret-0123456789abcdef",
        DEMO_MODE: "1",
        WEB_ORIGIN,
        PORT: String(API_PORT),
        HOST: "127.0.0.1",
        // Every test makes its own sandbox from 127.0.0.1; the production default (5 an hour) would refuse them.
        DEMO_SANDBOXES_PER_IP_HOUR: "1000",
      },
    },
    {
      command: `npm run build -w @lodos/web && cd apps/web && ../../node_modules/.bin/vite preview --port ${WEB_PORT} --strictPort`,
      cwd: "..",
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { LODOS_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

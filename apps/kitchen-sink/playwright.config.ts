import { defineConfig, devices } from "@playwright/test";

const PORT = 3010;
const baseURL = process.env.KITCHEN_SINK_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Kitchen-sink Tier 2 (Playwright) E2E config.
 *
 * - Production build (`next build && next start`) — dev mode masks/invents flake.
 * - `KITCHEN_SINK_URL` lets CI or a developer point at a preview deployment;
 *   when set, Playwright skips spinning up its own server.
 * - `KITCHEN_SINK_TEST_MODE=1` swaps the model resolver for a deterministic
 *   mock and disables CSS animations.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.KITCHEN_SINK_URL
    ? undefined
    : {
        // The kitchen-sink production build is expected to already exist
        // (run `pnpm --filter @flow-state-dev/kitchen-sink build` first; CI
        // does this in a dedicated step). Splitting build from start keeps
        // failures on each side clearly attributable.
        command: `pnpm --filter @flow-state-dev/kitchen-sink start --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          KITCHEN_SINK_TEST_MODE: "1",
          NEXT_PUBLIC_KITCHEN_SINK_TEST_MODE: "1",
          STORE_TYPE: "memory",
        },
      },
});

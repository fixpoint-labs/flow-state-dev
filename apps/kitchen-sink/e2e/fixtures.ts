/**
 * Shared Playwright fixtures for the kitchen-sink Tier 2 suite.
 *
 * - `userId` mints a fresh `e2e-<uuid>` per test so parallel scenarios don't
 *   share session state.
 * - `consoleErrors` collects console errors and unhandled page errors, then
 *   asserts none happened in `afterEach`. Tests that intentionally trigger
 *   errors should clear the array before assertion.
 * - `openKitchenSink` navigates to a path with the per-test `userId` query
 *   param and waits for the message input to be enabled — the cheapest
 *   readiness signal for the FlowProvider.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Fixtures = {
  userId: string;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  userId: async ({}, use) => {
    await use(`e2e-${randomUUID()}`);
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    await use(errors);
    expect(errors, `Console/page errors: ${errors.join("\n")}`).toEqual([]);
  },
});

export { expect };

/**
 * Navigate to a kitchen-sink path with the per-test `userId` query param and
 * wait for FlowProvider readiness (message input enabled). For routes other
 * than `/` (e.g. `/devtool`), pass the path explicitly.
 */
export async function openKitchenSink(
  page: Page,
  userId: string,
  path = "/",
): Promise<void> {
  const sep = path.includes("?") ? "&" : "?";
  await page.goto(`${path}${sep}e2eUserId=${encodeURIComponent(userId)}`);
  if (path === "/") {
    await expect(page.getByTestId("message-input")).toBeEnabled();
  }
}

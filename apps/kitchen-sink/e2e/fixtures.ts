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
import { test as base, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Kitchen-sink renders both a mobile and a desktop ChatPanel into the DOM
 * at all times (visibility is CSS-controlled via Tailwind breakpoints). A
 * raw `page.getByTestId(...)` therefore matches two elements at the desktop
 * viewport and trips strict-mode. Filtering by `:visible` picks the one
 * that's actually rendered for the current viewport.
 */
export function byTestId(page: Page, id: string): Locator {
  return page.locator(`[data-testid="${id}"]:visible`);
}

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
    await expect(byTestId(page, "message-input")).toBeEnabled();
  }
}

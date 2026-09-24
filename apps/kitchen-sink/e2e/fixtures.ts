/**
 * Shared Playwright fixtures for the kitchen-sink Tier 2 suite.
 *
 * - `sessionId` mints a fresh `e2e-<uuid>` per test. Every caller of this app
 *   is the same user in the same organization (`lib/kitchen-sink-principal.ts`),
 *   so scenarios cannot be kept apart by user; each one gets its own assistant
 *   session instead.
 * - `consoleErrors` collects console errors and unhandled page errors, then
 *   asserts none happened in `afterEach`. Tests that intentionally trigger
 *   errors should clear the array before assertion.
 * - `openKitchenSink` creates the test's session, navigates to `/` on it, and
 *   waits for the message input to be enabled — the cheapest readiness signal
 *   for the FlowProvider.
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
  sessionId: string;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  sessionId: async ({}, use) => {
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
 * Create the test's own assistant session, open `/` on it with
 * `?e2eSession=`, and wait for FlowProvider readiness (message input enabled).
 * A reload keeps the parameter, so it comes back to the same session.
 */
export async function openKitchenSink(page: Page, sessionId: string): Promise<void> {
  const created = await page.request.post("/api/flows/chat-agent/sessions", {
    data: { sessionId },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.goto(`/?e2eSession=${encodeURIComponent(sessionId)}`);
  await expect(byTestId(page, "message-input")).toBeEnabled();
}

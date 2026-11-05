/**
 * The Claude Code rail is live: a session made in another tab joins it, and
 * each row says how its latest turn stands, without a reload.
 *
 * Two pages on one server, the second the "other tab". The watching page's
 * rail is what is asserted on, never the notices behind it. The failing turn
 * is the scripted Claude Code's own failure path (`[fail]`), not a status the
 * test writes.
 *
 * Kitchen Sink under Next serves no push socket, so the rail reads on its
 * fallback timer (3 s) rather than on a notice: the bound here is that
 * timer, not push's second. The second-scale path over a real socket is the
 * Node host's goal check (`packages/node/test/live-session-list.test.ts`).
 *
 * Red state: on the code before this change the harness rail read once, so
 * neither case passes.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/** The rail moves within its fallback timer (3 s) and one read. */
const LIVE = { timeout: 4_000 };

async function openMode(page: Page): Promise<void> {
  await page.goto("/claude-code");
  await expect(page.getByTestId("session-list")).toBeVisible();
}

/** New session in `page`, returning its id. */
async function newSession(page: Page): Promise<string> {
  await page.getByTestId("new-session").click();
  const stream = page.getByTestId("stream");
  await expect(stream).toHaveAttribute("data-session-id", /.+/);
  await expect(page.getByTestId("message-input")).toBeEnabled();
  return (await stream.getAttribute("data-session-id"))!;
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
}

test.describe("the Claude Code rail is live", () => {
  test("a session another tab starts becomes a row here, with no reload", async ({ page, context }) => {
    await openMode(page);
    const other = await context.newPage();
    await openMode(other);

    const id = await newSession(other);

    await expect(page.locator(`[data-testid="session-list"] [data-session-id="${id}"]`)).toBeVisible(LIVE);
    await other.close();
  });

  test("a row says Running while another tab's turn runs, and Failed, marked for you, when it fails", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await openMode(page);
    const other = await context.newPage();
    await openMode(other);
    const id = await newSession(other);
    const row = page.locator(`[data-testid="session-list"] [data-session-id="${id}"]`);
    await expect(row).toBeVisible(LIVE);
    const mark = row.locator("[data-request-status]");

    await send(other, "[slow] take your time");
    await expect(mark).toHaveAttribute("data-request-status", "in_progress", LIVE);
    await expect(other.getByRole("button", { name: "Stop" })).toBeHidden({ timeout: 30_000 });
    await expect(mark).toHaveCount(0, LIVE);

    await send(other, "[fail] break");
    await expect(mark).toHaveAttribute("data-request-status", "failed", { timeout: 10_000 });
    await expect(mark).toHaveAttribute("data-needs-you", "");
    await other.close();
  });
});

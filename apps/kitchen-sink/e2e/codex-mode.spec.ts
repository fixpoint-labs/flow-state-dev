/**
 * Codex mode in the browser, on the scripted Codex
 * (`specs/issues/FIX-1916/PLAN.md` V2, V3; BR-3, BR-5, BR-7, BR-8, BR-9, BR-13).
 *
 * The server runs in test mode, so the real Codex block runs with the Codex
 * SDK replaced by `lib/scripted-codex.ts`; a prompt's directives (`[slow]`,
 * `[refuse]`, …) pick the path. Each test opens its own session with **New
 * session**, the way a person does.
 *
 * Red state produced before this was trusted: hold the scripted turn's events
 * until it ends, and the step-before-completion case fails: nothing but the
 * prompt shows while the stop control is up.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function newSession(page: Page): Promise<void> {
  await page.goto("/codex");
  await page.getByTestId("new-session").click();
  await expect(page.getByTestId("stream")).toHaveAttribute("data-session-id", /.+/);
  await expect(page.getByTestId("message-input")).toBeEnabled();
}

async function send(page: Page, prompt: string): Promise<void> {
  const input = page.getByTestId("message-input");
  await input.fill(prompt);
  await input.press("Enter");
}

const notice = (page: Page) => page.getByTestId("turn-notice");
const bound = (page: Page) => page.getByTestId("bound-conversation");
const stop = (page: Page) => page.getByRole("button", { name: "Stop" });

test.describe("Codex mode (V2)", () => {
  test("a run's steps show before it completes; a stop keeps the thread, and the next turn continues it", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await newSession(page);
    await send(page, "[slow] look around");

    // Still running: the stop control is up, and the command and the reply already show.
    await expect(page.getByTestId("conversation")).toContainText("Scripted Codex, turn 1 of thread");
    await expect(stop(page)).toBeVisible();

    await stop(page).click();
    await expect(notice(page)).toHaveAttribute("data-kind", "stopped");
    await expect(bound(page)).toHaveText(/^scripted-codex-/);
    const thread = (await bound(page).textContent())!.trim();
    await expect(notice(page)).toContainText(thread);

    await send(page, "go on");
    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of thread ${thread}`);
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    await expect(bound(page)).toHaveText(thread);
  });

  test("a stop before Codex names a thread reads as stopped, not refused, and records none (BR-9)", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await newSession(page);
    await send(page, "[slow-start] begin");
    await expect(stop(page)).toBeVisible();
    await stop(page).click();
    await expect(notice(page)).toHaveAttribute("data-kind", "stopped");
    await expect(bound(page)).toHaveText("none yet");
  });

  test("a thread Codex no longer has reads as refused, and keeps the id", async ({ page, consoleErrors }) => {
    await newSession(page);
    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    const thread = (await bound(page).textContent())!.trim();

    await send(page, "[refuse] go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "refused");
    await expect(notice(page)).toContainText(`did not continue conversation ${thread}`);
    await expect(bound(page)).toHaveText(thread);
    // The failed turn's request reports to the console; that is the turn's error, shown above.
    consoleErrors.length = 0;
  });

  test("a turn Codex fails reads as an error, keeps the id, and the next turn continues it", async ({ page, consoleErrors }) => {
    await newSession(page);
    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    const thread = (await bound(page).textContent())!.trim();

    await send(page, "[fail] go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "error");
    await expect(bound(page)).toHaveText(thread);

    await send(page, "and again");
    await expect(page.getByTestId("conversation")).toContainText(`turn 3 of thread ${thread}`);
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    // Should the failed turn's request report to the console, that is the turn's error, shown above.
    consoleErrors.length = 0;
  });
});

test.describe("a line sent while a long turn runs (FIX-2265)", () => {
  // The scripted turn holds past the engine's 30 s `queue` wait budget
  // (`lib/scripted-codex.ts`, `[long]`). Red state produced before this was
  // trusted: the `turn` action on `concurrency: "queue"` (main before the
  // fix), and the line never runs: "turn 2" never shows, before or after a
  // reload. With the page sending the line through the session hook, as it
  // did, the page leaves the running turn and this fails before the line runs.
  test("runs after the turn, the page stays on the running turn, and both survive a reload", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    test.setTimeout(120_000);
    const conversation = page.getByTestId("conversation");
    await newSession(page);
    await send(page, "[long] look around");
    await expect(conversation).toContainText(/turn 1 of thread scripted-codex-\S+\./);
    const thread = /turn 1 of thread (scripted-codex-\S+)\./.exec((await conversation.textContent())!)![1]!;

    await send(page, "After that, reply BRAVO.");
    await expect(page.getByTestId("line-after")).toBeVisible();
    // Still on the running turn: its stop control is up and nothing stamps it finished.
    await expect(stop(page)).toBeVisible();
    await expect(page.getByTestId("worked-for")).toHaveCount(0);

    // The running turn's last reply arrives live, past the budget, then the line runs as the next turn.
    await expect(conversation).toContainText("Scripted Codex, done after the long hold.", { timeout: 60_000 });
    await expect(conversation).toContainText(`turn 2 of thread ${thread}`, { timeout: 15_000 });
    await expect(conversation).toContainText("After that, reply BRAVO.");
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");

    await page.reload();
    await expect(conversation).toContainText("Scripted Codex, done after the long hold.");
    await expect(conversation).toContainText(`turn 2 of thread ${thread}`);
    await expect(conversation).toContainText("After that, reply BRAVO.");
  });
});

test.describe("the plan panel in Codex mode (V3)", () => {
  test("says Codex reports no plan, before a turn and after one", async ({ page, consoleErrors: _consoleErrors }) => {
    await newSession(page);
    const panel = page.getByTestId("plan-panel");
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "undeclared");
    await expect(panel).toContainText("Codex reports no plan.");

    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "undeclared");
    await expect(panel).toContainText("Codex reports no plan.");
    await expect(panel).not.toContainText("No plan recorded for this turn");
  });
});

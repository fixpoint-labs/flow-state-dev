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

test.describe("a model the account can't use, in Codex mode", () => {
  test("fails the turn with one line, Codex's output folded under Details", async ({ page, consoleErrors }) => {
    await newSession(page);
    await send(page, "[refused-model] hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "error");
    const conversation = page.getByTestId("conversation");
    const refusal = "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";
    // The refusal, said once in the conversation, not once per layer that saw it.
    await expect(conversation.getByText(refusal, { exact: false })).toHaveCount(1);
    // The CLI's log is kept, closed until asked for.
    const details = conversation.locator("details");
    await expect(details).toHaveCount(1);
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details).toContainText("responses_websocket");
    await expect(details.getByText("responses_websocket", { exact: false })).not.toBeVisible();
    consoleErrors.length = 0;
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

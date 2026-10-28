/**
 * Claude Code mode in the browser, on the scripted Claude Code
 * (`specs/issues/FIX-1915/PLAN.md` V7, V8).
 *
 * The server runs in test mode, so the real Claude Code block runs with the
 * Agent SDK replaced by `lib/scripted-claude-code.ts`; a prompt's directives
 * (`[slow]`, `[plan]`, …) pick the path. Each test opens its own session with
 * **New session**, the way a person does.
 *
 * Red state produced before this was trusted: await the run before rendering
 * (the page re-reads only at the turn's end), and the step-before-completion
 * case fails.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function newSession(page: Page): Promise<void> {
  await page.goto("/claude-code");
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

test.describe("Claude Code mode (V7)", () => {
  test("a run's steps show before it completes; a stop keeps the conversation, and the next turn continues it", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await newSession(page);
    await send(page, "[plan][slow] look around");

    // Still running: the stop control is up, and the reply and the plan already show.
    await expect(page.getByTestId("conversation")).toContainText("Scripted Claude Code, turn 1 of conversation");
    await expect(page.getByTestId("plan-row")).toHaveCount(2);
    await expect(stop(page)).toBeVisible();

    await stop(page).click();
    await expect(notice(page)).toHaveAttribute("data-kind", "stopped");
    await expect(bound(page)).toHaveText(/^scripted-/);
    const conversation = (await bound(page).textContent())!.trim();
    await expect(notice(page)).toContainText(conversation);

    await send(page, "go on");
    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of conversation ${conversation}`);
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    await expect(bound(page)).toHaveText(conversation);
  });

  test("a stop before Claude Code names a conversation reads as stopped, not refused", async ({ page, consoleErrors: _consoleErrors }) => {
    await newSession(page);
    await send(page, "[slow-start] begin");
    await expect(stop(page)).toBeVisible();
    await stop(page).click();
    await expect(notice(page)).toHaveAttribute("data-kind", "stopped");
    await expect(bound(page)).toHaveText("none yet");
  });

  test("a turn sent while one runs waits, then continues the same conversation", async ({ page, consoleErrors: _consoleErrors }) => {
    test.setTimeout(60_000);
    await newSession(page);
    await send(page, "[slow] first");
    await expect(page.getByTestId("conversation")).toContainText("turn 1 of conversation");
    await send(page, "second");
    // The first is still running; the second has not started.
    await expect(stop(page)).toBeVisible();
    await expect(page.getByTestId("conversation")).not.toContainText("turn 2 of conversation");
    // The reply names the conversation; the page shows the binding once the turn ends.
    const text = (await page.getByTestId("conversation").textContent()) ?? "";
    // The page text has no space between the reply and what follows it, so the id
    // is matched by its own shape (`scripted-<time>-<n>`), not by "up to a space".
    const conversation = /turn 1 of conversation (scripted-[\w-]+)\./.exec(text)?.[1];
    expect(conversation).toMatch(/^scripted-/);

    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of conversation ${conversation}`, { timeout: 40_000 });
    await expect(notice(page)).toHaveAttribute("data-kind", "continued", { timeout: 10_000 });
  });

  test("a reload lands back in the session, and the next turn continues its conversation (BR-6)", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await newSession(page);
    const sessionId = await page.getByTestId("stream").getAttribute("data-session-id");
    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    const conversation = (await bound(page).textContent())!.trim();

    await page.reload();

    await expect(page.getByTestId("stream")).toHaveAttribute("data-session-id", sessionId!);
    await expect(bound(page)).toHaveText(conversation);
    await expect(page.getByTestId("message-input")).toBeEnabled();
    await send(page, "again");
    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of conversation ${conversation}`);
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
  });

  test("a conversation Claude Code won't continue reads as refused, and keeps the id", async ({ page, consoleErrors }) => {
    await newSession(page);
    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    const conversation = (await bound(page).textContent())!.trim();

    await send(page, "[refuse] go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "refused");
    await expect(notice(page)).toContainText(`did not continue conversation ${conversation}`);
    await expect(bound(page)).toHaveText(conversation);
    // The failed turn's request reports to the console; that is the turn's error, shown above.
    consoleErrors.length = 0;
  });
});

test.describe("the plan panel (V8)", () => {
  test("keeps the conversation's plan across turns, labelled with the turn that last changed it", async ({ page, consoleErrors }) => {
    await newSession(page);
    const panel = page.getByTestId("plan-panel");
    const stages = () => panel.getByTestId("plan-row").evaluateAll((lis) => lis.map((li) => li.getAttribute("data-stage")));
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "no-turn");

    await send(page, "[plan] make a plan");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "rows");
    await expect(panel.getByTestId("plan-turn")).toHaveText("Last changed in turn 1");
    // A row says how far along it is by its mark; one nobody has started holds no status and reads as to do.
    await expect(panel.getByTestId("plan-row-title")).toHaveText(["Read the request", "Answer it"]);
    expect(await stages()).toEqual(["active", "pending"]);

    // Turn 2 moves on by task id alone: the titles are still turn 1's.
    await send(page, "[plan-next] carry on");
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    await expect(panel.getByTestId("plan-turn")).toHaveText("Last changed in turn 2");
    await expect(panel.getByTestId("plan-row-title")).toHaveText(["Read the request", "Answer it"]);
    await expect.poll(stages).toEqual(["done", "active"]);

    // A turn that leaves the plan alone leaves it, and its label, as they were.
    await send(page, "no plan this time");
    await expect(page.getByText("turn 3 of conversation", { exact: false })).toBeVisible();
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    await expect(panel.getByTestId("plan-turn")).toHaveText("Last changed in turn 2");
    await expect(panel.getByTestId("plan-row-title")).toHaveText(["Read the request", "Answer it"]);
    expect(await stages()).toEqual(["done", "active"]);

    // A turn that fails before Claude Code names its conversation leaves the plan as it was.
    await send(page, "[fail-early] go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "error");
    await expect(panel.getByTestId("plan-turn")).toHaveText("Last changed in turn 2");
    await expect(panel.getByTestId("plan-row-title")).toHaveText(["Read the request", "Answer it"]);
    // The failed turn's request reports to the console; that is the turn's error, shown above.
    consoleErrors.length = 0;

    // A new conversation starts with no plan.
    await send(page, "[new] start over");
    await expect(notice(page)).toHaveAttribute("data-kind", "moved");
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "none");
    await expect(panel.getByTestId("plan-row")).toHaveCount(0);

    // Read-only: nothing in the panel can change the plan (BR-18).
    await expect(panel.locator("button, input, textarea, select, [contenteditable=true]")).toHaveCount(0);
  });
});

test.describe("tool calls", () => {
  test("a run of shell commands is one quiet line, labelled by what each command was for", async ({ page, consoleErrors: _consoleErrors }) => {
    await newSession(page);
    await send(page, "[bash] look around");
    await expect(page.getByTestId("conversation")).toContainText("Scripted Claude Code, turn 1");

    const group = page.getByTestId("tool-group");
    await expect(group).toHaveCount(1);
    await expect(group).toContainText("Check git status · List files · Read the package manifest · +2 more");
    await expect(page.getByTestId("tool-row")).toHaveCount(0);

    await group.getByRole("button").first().click();
    await expect(page.getByTestId("tool-row")).toHaveText([
      "Check git status",
      "List files",
      "Read the package manifest",
      "Run the tests",
      "Typecheck",
    ]);
  });
});

/**
 * Cursor mode in the browser, on the scripted Cursor
 * (`specs/issues/FIX-1917/PLAN.md` V6; BR-5, BR-6, BR-9, BR-16).
 *
 * The server runs in test mode, so the real Cursor block runs with the Cursor
 * SDK replaced by `lib/scripted-cursor.ts`; a prompt's directives (`[slow]`,
 * `[plan]`, …) pick the path. Each test opens its own session with **New
 * session**, the way a person does.
 *
 * Red state produced before this was trusted: register the Cursor flow with
 * `recordPlan` off, and the panel reads "Cursor reports no plan", so the
 * plan case fails. And record a failure only on a throw: the errored case
 * reads "continued". And have the scripted run's `steer` refuse every line:
 * the taken-line case finds no "taken into the running turn" note.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function newSession(page: Page): Promise<void> {
  await page.goto("/cursor");
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

test.describe("Cursor mode (V6)", () => {
  test("a run's steps show before it completes; a stop keeps the agent, and the next turn continues it", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await newSession(page);
    await send(page, "[plan][slow] look around");

    // Still running: the stop control is up, and the reply and the plan already show.
    await expect(page.getByTestId("conversation")).toContainText("Scripted Cursor, turn 1 of agent");
    await expect(page.getByTestId("plan-row")).toHaveCount(4);
    await expect(stop(page)).toBeVisible();

    await stop(page).click();
    await expect(notice(page)).toHaveAttribute("data-kind", "stopped");
    await expect(bound(page)).toHaveText(/^scripted-cursor-/);
    const agent = (await bound(page).textContent())!.trim();
    await expect(notice(page)).toContainText(agent);

    await send(page, "go on");
    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of agent ${agent}`);
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    await expect(bound(page)).toHaveText(agent);
  });

  test("an agent Cursor won't resume reads as refused, and keeps the id", async ({ page, consoleErrors }) => {
    await newSession(page);
    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    const agent = (await bound(page).textContent())!.trim();

    await send(page, "[refuse] go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "refused");
    await expect(notice(page)).toContainText(`did not continue conversation ${agent}`);
    await expect(bound(page)).toHaveText(agent);
    // The failed turn's request reports to the console; that is the turn's error, shown above.
    consoleErrors.length = 0;
  });

  test("a run Cursor reports as errored reads as an error, keeps the id, and the next turn continues it", async ({
    page,
    consoleErrors,
  }) => {
    await newSession(page);
    await send(page, "hello");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    const agent = (await bound(page).textContent())!.trim();

    await send(page, "[errored] go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "error");
    await expect(bound(page)).toHaveText(agent);

    await send(page, "and again");
    await expect(page.getByTestId("conversation")).toContainText(`turn 3 of agent ${agent}`);
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    // Should the errored turn's request report to the console, that is the turn's error, shown above.
    consoleErrors.length = 0;
  });
});

test.describe("Cursor's to-do list in the plan panel (V6)", () => {
  test("shows the whole list Cursor confirmed, and keeps it on a later turn without an update", async ({ page, consoleErrors: _consoleErrors }) => {
    await newSession(page);
    const panel = page.getByTestId("plan-panel");

    // The update Cursor sent named two items; the list it confirmed has four.
    await send(page, "[plan] make a plan");
    await expect(notice(page)).toHaveAttribute("data-kind", "started");
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "rows");
    await expect(panel.getByTestId("plan-turn")).toHaveText("Last changed in turn 1");
    await expect(panel.getByTestId("plan-row-title")).toHaveText(["Read the request", "Answer it", "Check the answer", "Say what changed"]);
    expect(await panel.getByTestId("plan-row").evaluateAll((lis) => lis.map((li) => li.getAttribute("data-stage")))).toEqual([
      "done",
      "active",
      "pending",
      "pending",
    ]);
    await expect(panel).not.toContainText("reports no plan");

    await send(page, "no plan this time");
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    // The agent's list is still the one it confirmed, labelled with the turn that did.
    await expect(panel.getByTestId("plan-turn")).toHaveText("Last changed in turn 1");
    await expect(panel.locator("[data-plan-state]")).toHaveAttribute("data-plan-state", "rows");
    await expect(panel.getByTestId("plan-row-title")).toHaveText(["Read the request", "Answer it", "Check the answer", "Say what changed"]);
    await expect(panel).not.toContainText("reports no plan");
  });
});

test.describe("A line sent while a Cursor turn runs", () => {
  test("is taken into the running turn, and doesn't run again as a turn of its own", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await newSession(page);
    await send(page, "[slow] look around");
    await expect(page.getByTestId("conversation")).toContainText("Scripted Cursor, turn 1 of agent");
    await expect(stop(page)).toBeVisible();

    await send(page, "check the tests too");
    // The turn took it and is still running: the line shows before the turn ends.
    await expect(page.getByTestId("line-taken")).toHaveText("You, taken into the running turn: check the tests too");
    await expect(page.getByTestId("line-after")).toHaveCount(0);
    await expect(stop(page)).toBeVisible();

    await stop(page).click();
    await expect(notice(page)).toHaveAttribute("data-kind", "stopped");
    await expect(bound(page)).toHaveText(/^scripted-cursor-/);
    const agent = (await bound(page).textContent())!.trim();

    // Had the line also gone as a turn, it would be turn 2 and this turn 3.
    await send(page, "go on");
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of agent ${agent}`);
    await expect(stop(page)).toHaveCount(0);
    await expect(page.getByTestId("conversation")).not.toContainText("turn 3 of agent");
  });

  test("a run that can't take it runs it as the next turn, once the running turn ends", async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    // The running turn is left to end on its own (the script's 20-second hold), not stopped.
    test.setTimeout(60_000);
    await newSession(page);
    await send(page, "[slow][steer-refuse] look around");
    await expect(page.getByTestId("conversation")).toContainText("Scripted Cursor, turn 1 of agent");
    await expect(stop(page)).toBeVisible();

    await send(page, "check the tests too");
    await expect(page.getByTestId("conversation")).toContainText("Scripted Cursor, turn 2 of agent", { timeout: 30_000 });
    await expect(notice(page)).toHaveAttribute("data-kind", "continued");
    const agent = (await bound(page).textContent())!.trim();
    await expect(page.getByTestId("conversation")).toContainText(`turn 2 of agent ${agent}`);
    // It ran as a turn, never into the first one.
    await expect(page.getByTestId("line-taken")).toHaveCount(0);
    await expect(stop(page)).toHaveCount(0);
    await expect(page.getByTestId("conversation")).not.toContainText("turn 3 of agent");
  });
});

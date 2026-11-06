/**
 * Goal check: in the Claude Code-style lab, a person opens a background task
 * from a line in the main thread that names it (its result line, or the line
 * where the main session started it) in one press, sees the task's status as
 * it is now on that line, and finds the same task marked in the pane.
 *
 * Leg 1 needs no model: two coding tasks on harness-manager's scripted coder,
 * filed and one cancelled through the board's own actions, each ending landing
 * as a result line before any model turn. Leg 2 asks the lab's default model
 * to start a task, for the line that started it. Every signal reads the page
 * and compares it with the board's rows (`listTasks`); the page is only clicked.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command). Each plants its change in
 * the lab's source for the run, rebuilds the pages, and puts both back:
 *   - `no-feed-open`: the open the main thread hands its lines does nothing. Must FAIL
 *     opens-from-result, row-marked and opens-from-start-line.
 *   - `frozen-dot`: a result line's dot reads the line's own status. Must FAIL dot-is-live.
 *   - `done-shut`: Done is not opened for the open task. Must FAIL row-marked.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/opens-a-task-from-the-feed/run.mts
 */
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import type { Locator, Page } from "playwright";
import { goalTmpDir, loadFixture, runGoal, stopProcessGroup, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { boardOf, buildPages, LAB, labCheckout, makeRepository, openSessionOn, plant, startLab, until, type Plant } from "../lab.mts";

const fixture = loadFixture<{ project: string; modelProject: string; finishedGoal: string; cancelledGoal: string; ask: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
/** How long a line or a dot has to show what the board's row reads. */
const PAGE_BOUND_MS = 15_000;
/** The pause before each of the scripted coder's five steps. */
const STEP_MS = 2_000;
/** How long the main session's turn has to start the task leg 2 asks for. */
const MODEL_BOUND_MS = 240_000;
/** How the lab names a task's status: the words its dots are labelled with (the lab's `TASK_STATUS`). */
const LABEL: Record<string, string> = { pending: "queued", in_progress: "running", held: "held", completed: "done", errored: "failed", cancelled: "cancelled" };

const src = (...path: string[]) => join(LAB, "src", ...path);
/** What a control changes for its run. */
const PLANTS: Record<string, Plant[]> = {
  "no-feed-open": [{ file: src("components", "Thread.tsx"), from: "{ rows: tasks, open: onOpenThread }", to: "{ rows: tasks, open: () => {} }" }],
  "frozen-dot": [{ file: src("components", "Entry.tsx"), from: "const dot = row?.status ?? reported;", to: "const dot = reported;" }],
  "done-shut": [{ file: src("components", "TasksPane.tsx"), from: "if (openInDone !== undefined) setDoneOpen(true);", to: "if (openInDone !== undefined) setDoneOpen(false);" }],
};

/** The model credentials leg 1's server is kept from: no model turn runs there. */
const NO_MODEL = { AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };

await runGoal(async (failures, tell) => {
  const labBefore = labCheckout();
  const unplant = plant(PLANTS, CONTROL);
  const scratch = goalTmpDir("claude-code-style-feed-open");
  const notes: string[] = [];
  let lab: Awaited<ReturnType<typeof startLab>> | undefined;
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    buildPages();
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    // ── Leg 1, no model: a finished task and a cancelled one, each ending a result line.
    const repo = makeRepository(join(scratch, "repo"), { "NOTES.md": "# Notes\n" });
    lab = await startLab(join(scratch, "data-1"), USER, {
      CLAUDE_CODE_STYLE_HARNESS: "stub",
      CLAUDE_CODE_STYLE_HARNESS_STEP_MS: String(STEP_MS),
      CLAUDE_CODE_STYLE_REPOSITORIES: repo,
      ...NO_MODEL,
    });
    let fsd = createClient({ userId: USER, baseUrl: lab.origin });
    let board = boardOf(fsd);
    await page.goto(lab.origin);
    const session = await openSessionOn(page, fsd, USER, fixture.project, repo);
    const finishedTitle = "Note the finished run";
    const cancelledTitle = "Note the cancelled run";
    const finished = await board.file(session, finishedTitle, fixture.finishedGoal);
    const cancelled = await board.file(session, cancelledTitle, fixture.cancelledGoal);
    await board.send(session, "updateTask", { id: cancelled, status: "cancelled" });
    const settled = await until(async () => {
      const rows = await board.rows(session);
      const status = (id: string) => rows.find((t) => t.id === id)?.status;
      return status(finished) === "completed" && status(cancelled) === "cancelled" ? true : undefined;
    }, 90_000, 1_000);
    if (settled === undefined) throw new Error(`setup: the tasks never settled: ${JSON.stringify(await board.rows(session))}`);

    const thread = page.getByRole("main", { name: "Main thread" });
    const pane = page.getByRole("complementary", { name: "Background tasks" });
    const resultLine = (id: string) => thread.locator(`[data-entry="result"][data-task-id="${id}"]`);
    const lines = await until(async () => ((await resultLine(finished).count()) > 0 && (await resultLine(cancelled).count()) > 0 ? true : undefined), 60_000);
    tell.over("leg 1 · the two tasks' result lines", lines === undefined ? [] : [finished, cancelled]);
    if (lines === undefined) return { failures, evidence: "" };
    const sheetOf = (title: string) => page.getByRole("dialog", { name: `Work: ${title}` });
    const shows = (locator: Locator, ms = 5_000) => locator.waitFor({ timeout: ms }).then(() => true, () => false);
    const closeSheet = async () => {
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
    };

    // ── opens-from-result: the finished task's line opens its sheet, and the address names it.
    const finishedOpen = resultLine(finished).getByRole("button", { name: "Open task" });
    if ((await finishedOpen.count()) === 0) failures.push("opens-from-result: the finished task's result line has no Open task");
    else {
      await finishedOpen.click();
      const opened = await shows(sheetOf(finishedTitle));
      const named = new URL(page.url()).searchParams.get("task");
      if (!opened) failures.push(`opens-from-result: Open task on the finished line opened no dialog "Work: ${finishedTitle}"`);
      else if (named !== finished) failures.push(`opens-from-result: the sheet opened, but the address names task ${named}, not ${finished}`);
      else notes.push(`opens-from-result: "Work: ${finishedTitle}", address task=${named}`);

      // ── row-marked: the same task's row in the pane is shown and marked (it sits in Done).
      const row = pane.locator(`[data-task-status="completed"]`).filter({ hasText: finishedTitle });
      const marked = await until(async () => ((await row.isVisible()) && (await row.getAttribute("aria-expanded")) === "true" ? true : undefined), 5_000, 250);
      if (marked === undefined) {
        const why = (await row.count()) === 0 ? "isn't in the pane" : `is ${(await row.isVisible()) ? "shown" : "hidden"}, aria-expanded=${await row.getAttribute("aria-expanded")}`;
        failures.push(`row-marked: the finished task's row in the pane ${why}`);
      } else notes.push("row-marked: the row in Done is shown, aria-expanded=true");
    }
    await closeSheet();

    // ── dot-is-live: after Retry, the cancelled task's line's dot is the row's status; its words still say cancelled.
    const cancelledOpen = resultLine(cancelled).getByRole("button", { name: "Open task" });
    if ((await cancelledOpen.count()) > 0) await cancelledOpen.click();
    if (!(await shows(sheetOf(cancelledTitle), 3_000))) {
      // Open it from the pane instead, so this leg grades the dot whatever the feed's open does.
      const done = pane.locator("details");
      if ((await done.getAttribute("open")) === null) await done.locator("summary").click();
      await pane.locator(`[data-task-status="cancelled"]`).filter({ hasText: cancelledTitle }).click();
    }
    await sheetOf(cancelledTitle).getByTestId("task-action-retry").click();
    const again = await until(async () => {
      const status = (await board.row(session, cancelled))?.status;
      return status === "pending" || status === "in_progress" ? status : undefined;
    }, PAGE_BOUND_MS);
    if (again === undefined) throw new Error(`setup: Retry never ran the cancelled task again: ${JSON.stringify(await board.row(session, cancelled))}`);
    await closeSheet();
    let last = { dot: "", status: "", words: "" };
    const live = await until(async () => {
      const status = (await board.row(session, cancelled))?.status as string;
      const dot = (await resultLine(cancelled).locator("[data-task-dot]").getAttribute("aria-label")) ?? "";
      const words = (await resultLine(cancelled).getByRole("button", { name: new RegExp(cancelledTitle) }).textContent()) ?? "";
      last = { dot, status, words };
      return dot === LABEL[status] && status !== "cancelled" ? last : undefined;
    }, PAGE_BOUND_MS);
    if (live === undefined) failures.push(`dot-is-live: the cancelled line's dot reads "${last.dot}" while the board's row is ${last.status}`);
    else if (!/· cancelled/.test(live.value.words)) failures.push(`dot-is-live: the line's words no longer say what it reported: ${JSON.stringify(live.value.words)}`);
    else notes.push(`dot-is-live: dot "${live.value.dot}" for row ${live.value.status} after ${live.afterMs} ms; words ${JSON.stringify(live.value.words.trim())}`);

    stopProcessGroup(lab.child);
    lab = undefined;

    // ── Leg 2, the lab's default model: the line where the main session started a task opens it.
    const modelRepo = makeRepository(join(scratch, "model-repo"), { "NOTES.md": "# Notes\n" });
    lab = await startLab(join(scratch, "data-2"), USER, {
      CLAUDE_CODE_STYLE_HARNESS: "stub",
      CLAUDE_CODE_STYLE_HARNESS_STEP_MS: String(STEP_MS),
      CLAUDE_CODE_STYLE_REPOSITORIES: modelRepo,
    });
    fsd = createClient({ userId: USER, baseUrl: lab.origin });
    board = boardOf(fsd);
    await page.goto(lab.origin);
    const modelSession = await openSessionOn(page, fsd, USER, fixture.modelProject, modelRepo);
    const box = page.getByRole("textbox", { name: "Message the main session" });
    await box.fill(fixture.ask);
    await box.press("Enter");
    await legStartLine(page, modelSession, board, failures, tell, notes);

    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    return { failures, evidence: notes.join("; ") };
  } finally {
    await browser?.close();
    if (lab !== undefined) stopProcessGroup(lab.child);
    unplant();
    if (CONTROL !== "") buildPages();
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
  }
});

/** opens-from-start-line: the line that started the task has Open task, which opens that task's sheet, and its dot is the row's status. */
async function legStartLine(page: Page, session: string, board: ReturnType<typeof boardOf>, failures: string[], tell: Tell, notes: string[]) {
  const thread = page.getByRole("main", { name: "Main thread" });
  const step = thread.locator('[data-entry="tool"] [data-task-id]');
  const found = await until(async () => {
    // A finished turn's run of calls folds; open each folded run so its steps are drawn.
    for (const folded of await thread.locator('[data-entry="tool"] > button[aria-expanded="false"]').all()) await folded.click().catch(() => undefined);
    return (await step.count()) > 0 ? true : undefined;
  }, MODEL_BOUND_MS, 2_000);
  const rows = await board.rows(session);
  tell.over("leg 2 · the board's rows", rows);
  tell.over("leg 2 · a line that started a task", found === undefined ? [] : [true]);
  if (found === undefined) return;
  const line = step.first();
  const id = (await line.getAttribute("data-task-id")) ?? "";
  const row = (await board.rows(session)).find((t) => t.id === id);
  if (row === undefined) {
    failures.push(`opens-from-start-line: the start line names task ${id}, which listTasks doesn't list`);
    return;
  }
  let last = { dot: "", status: "" };
  const agrees = await until(async () => {
    const status = (await board.row(session, id))?.status as string;
    const dot = (await line.locator("[data-task-dot]").getAttribute("aria-label")) ?? "";
    last = { dot, status };
    return dot === LABEL[status] ? last : undefined;
  }, PAGE_BOUND_MS);
  if (agrees === undefined) failures.push(`opens-from-start-line: the start line's dot reads "${last.dot}" while the board's row is ${last.status}`);
  await line.getByRole("button", { name: "Open task" }).click();
  const opened = await page.getByRole("dialog", { name: `Work: ${row.title}` }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (!opened) failures.push(`opens-from-start-line: Open task on the start line opened no dialog "Work: ${row.title}"`);
  else if (agrees !== undefined) notes.push(`opens-from-start-line: "Work: ${row.title}" (task ${id}); dot "${agrees.value.dot}" for row ${agrees.value.status}`);
}

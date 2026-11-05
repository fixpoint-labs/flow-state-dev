/**
 * Goal check: in the Claude Code-style lab, a person changes a background task
 * from its opened sheet, with no model turn: Steer, Cancel and Retry, each
 * graded on the board's row read back through the public client, and a failed
 * task's sheet shows the error the board recorded.
 *
 * One lab on `fsdev dev --app`, its coding tasks on harness-manager's scripted
 * coder (`CLAUDE_CODE_STYLE_HARNESS=stub`), so nothing here calls a model. The
 * tasks are filed on the session's board through its own `createTask` action,
 * as the main session would file them; the page is only clicked.
 *
 * Controls (`GOAL_CONTROL=<name>`, same command). Each plants its change in
 * the lab's source for the run, rebuilds the pages, and puts both back:
 *   - `wrong-board`: the action row bound to board "plan" instead of "tasks". Must FAIL
 *     steer, cancel and retry: the rows unchanged, the board's refusal on the page.
 *   - `no-error`: the sheet's error drawn with nothing. Must FAIL error.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/acts-on-an-opened-task/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { taskActionName } from "@flow-state-dev/orchestration/inbox";
import type { Page } from "playwright";
import { goalTmpDir, loadFixture, REPO_ROOT, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { LAB, labCheckout, makeRepository, sleep, startLab } from "../lab.mts";

const fixture = loadFixture<{ project: string; failingProject: string; goal: string; failingGoal: string; steer: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const USER = "u_goal";
/** The lab's main worker's flow, which holds the session's board. */
const MAIN_FLOW = "agent";
const BOARD = "tasks";
/** How long a pressed action has to show on the board's row. */
const ROW_BOUND_MS = 15_000;
/** How long a cancelled run's request has to leave `in_progress`: the scripted coder's steps poll the row between them. */
const RUN_STOP_BOUND_MS = 30_000;
/** The pause before each of the scripted coder's five steps: long enough to steer and cancel a running task. */
const STEP_MS = 6_000;

/** What a control changes for its run: in which file, the text it replaces, and with what. */
const PLANTS: Record<string, { file: string; from: string; to: string }[]> = {
  "wrong-board": [{ file: join(LAB, "src", "adapter.ts"), from: "sessionId, board: TASKS_BOARD })", to: 'sessionId, board: "plan" })' }],
  "no-error": [{ file: join(LAB, "src", "components", "TasksPane.tsx"), from: "<ErrorBody message={task.error} />", to: "<span />" }],
};

/** Plant a control's changes, and hand back what puts the files back. */
function plant(control: string): () => void {
  if (control !== "" && PLANTS[control] === undefined) throw new Error(`setup: no control named ${control}`);
  const undo: (() => void)[] = [];
  for (const change of PLANTS[control] ?? []) {
    const before = readFileSync(change.file, "utf8");
    if (before.split(change.from).length !== 2) throw new Error(`setup: ${change.file} doesn't hold the text the ${control} control replaces exactly once`);
    writeFileSync(change.file, before.replace(change.from, change.to));
    undo.push(() => writeFileSync(change.file, before));
  }
  return () => undo.forEach((put) => put());
}

const buildPages = () => execFileSync("pnpm", ["--filter", "@flow-state-dev/claude-code-style", "build"], { cwd: REPO_ROOT, stdio: "ignore" });

/** Poll `check` every `everyMs` until it answers, or `forMs` passes. Hands back the answer and when it came. */
async function until<T>(check: () => Promise<T | undefined>, forMs: number, everyMs = 500): Promise<{ value: T; afterMs: number } | undefined> {
  const started = Date.now();
  while (Date.now() - started < forMs) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return { value, afterMs: Date.now() - started };
    await sleep(everyMs);
  }
  return undefined;
}

await runGoal(async (failures, tell) => {
  // Read before a control's plant, and again after it is put back.
  const labBefore = labCheckout();
  const unplant = plant(CONTROL);
  const scratch = goalTmpDir("claude-code-style-task-actions");
  const notes: string[] = [];
  let lab: Awaited<ReturnType<typeof startLab>> | undefined;
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    // The pages `--app` serves are the lab's built ones, built after a control's plant.
    buildPages();
    const repo = makeRepository(join(scratch, "repo"), { "NOTES.md": "# Notes\n" });
    const gone = makeRepository(join(scratch, "gone"), { "NOTES.md": "# Notes\n" });
    lab = await startLab(join(scratch, "data"), USER, {
      CLAUDE_CODE_STYLE_HARNESS: "stub",
      CLAUDE_CODE_STYLE_HARNESS_STEP_MS: String(STEP_MS),
      CLAUDE_CODE_STYLE_REPOSITORIES: [repo, gone].join(":"),
      // No model credential reaches the server: the main session's turn on a task's ending fails
      // instead of answering, so nothing here infers, and nothing graded waits on that turn.
      AI_GATEWAY_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "",
    });
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });

    // ── The board, read through the public client: its rows, one task whole, and a filing.
    const rowsOf = async (sessionId: string): Promise<any[]> => {
      const listed = await fsd.flow(MAIN_FLOW).read<{ ok: boolean; tasks: any[] }>(taskActionName("listTasks", BOARD), {}, { sessionId });
      return listed.ok ? listed.tasks : [];
    };
    const sendOnBoard = async (sessionId: string, tool: "getTask" | "createTask", input: Record<string, unknown>): Promise<any> => {
      const sent = await fsd.flow(MAIN_FLOW).send(taskActionName(tool, BOARD), input, { sessionId });
      await sent.wait();
      const found = (await fsd.sessions.requests(sessionId, { includeResultOutput: true, limit: 50 })).find((r) => r.id === sent.id);
      return found?.result?.output;
    };
    const taskOf = async (sessionId: string, id: string): Promise<any> => (await sendOnBoard(sessionId, "getTask", { id }))?.task;
    const file = async (sessionId: string, title: string, goal: string): Promise<string> => {
      const out = await sendOnBoard(sessionId, "createTask", { title, goal, assignee: "desk.coder" });
      if (typeof out?.taskId !== "string") throw new Error(`setup: the board didn't file "${title}": ${JSON.stringify(out)}`);
      return out.taskId;
    };
    const rowOf = async (sessionId: string, id: string) => (await rowsOf(sessionId)).find((t) => t.id === id);
    const requestStatus = async (run: { sessionId: string; requestId: string }) =>
      (await fsd.sessions.requests(run.sessionId, { limit: 50 })).find((r) => r.id === run.requestId)?.status;

    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(lab.origin);

    /** A new session-mode session on a new project over `repository`, opened in the page; its id. */
    const openSessionOn = async (name: string, repository: string): Promise<string> => {
      const known = new Set((await fsd.sessions.list({ flowKind: MAIN_FLOW, userId: USER })).map((s) => s.id));
      const picker = page.getByRole("region", { name: "Choose a project" });
      if (!(await picker.isVisible())) await page.getByRole("button", { name: "+ New session" }).click();
      const form = page.getByRole("form", { name: "New project" });
      await form.getByLabel("Project name").fill(name);
      await form.getByLabel("Repository").fill(`file://${repository}`);
      await form.getByRole("button", { name: "Create project" }).click();
      await picker.getByRole("button", { name }).click();
      await page.getByRole("textbox", { name: "Message the main session" }).waitFor();
      const opened = await until(async () => (await fsd.sessions.list({ flowKind: MAIN_FLOW, userId: USER })).find((s) => !known.has(s.id))?.id, 10_000);
      if (opened === undefined) throw new Error(`setup: no session opened on ${name}`);
      return opened.value;
    };
    const pane = () => page.getByRole("complementary", { name: "Background tasks" });
    /**
     * Open a task's sheet from its row in the pane, once the row shows `status`, so it doesn't move
     * between the groups under the click; the Done group is opened first when it sits there.
     */
    const openSheet = async (title: string, status: string) => {
      const row = pane().getByRole("button", { name: new RegExp(title), includeHidden: true }).and(pane().locator(`[data-task-status="${status}"]`));
      await row.waitFor({ state: "attached" });
      const done = pane().locator("details");
      if ((await done.count()) > 0 && (await done.getAttribute("open")) === null) await done.locator("summary").click();
      await row.click();
      return page.getByRole("dialog", { name: `Work: ${title}` });
    };
    const shownWords = async (sheet: ReturnType<Page["getByRole"]>) => {
      const refusal = sheet.getByTestId("task-action-refusal");
      return (await refusal.count()) > 0 ? `refused: ${(await refusal.textContent()) ?? ""}` : ((await sheet.getByTestId("task-action-outcome").textContent().catch(() => null)) ?? "nothing");
    };

    // ── Setup: one coding task running on the scripted coder.
    const session = await openSessionOn(fixture.project, repo);
    const title = "Note the scripted run";
    const id = await file(session, title, fixture.goal);
    const running = await until(async () => {
      const row = await rowOf(session, id);
      return row?.status === "in_progress" && row.run != null ? row : undefined;
    }, 60_000);
    if (running === undefined) throw new Error(`setup: task ${id} never started running: ${JSON.stringify(await rowOf(session, id))}`);
    const run = running.value.run as { sessionId: string; requestId: string };
    const attemptsBefore = running.value.attempts as number;
    const sheet = await openSheet(title, "in_progress");
    await sheet.getByTestId("task-action-row").waitFor();

    // ── steer: the words typed in the sheet's Steer box are on the row.
    await sheet.getByTestId("task-action-steer-input").fill(fixture.steer);
    await sheet.getByTestId("task-action-steer").click();
    await sheet.locator('[data-testid="task-action-outcome"], [data-testid="task-action-refusal"]').first().waitFor({ timeout: ROW_BOUND_MS });
    const steerShown = await shownWords(sheet);
    const steered = await until(async () => {
      const steers = tell.over("steer · the row's steers, read once", [(await taskOf(session, id))?.steers ?? []])[0] as { message: string }[];
      return steers.some((s) => s.message === fixture.steer) ? steers.length : undefined;
    }, ROW_BOUND_MS, 1_000);
    if (steered === undefined) failures.push(`steer: the row's steers never held the words typed in the sheet (the page said ${steerShown})`);
    else notes.push(`steer: on the row after ${steered.afterMs} ms`);

    // ── cancel: one confirm, then the row reads cancelled and the run's request leaves in_progress.
    await sheet.getByTestId("task-action-cancel").click();
    if ((await rowOf(session, id))?.status !== "in_progress") failures.push("cancel: the row changed before the confirm");
    await sheet.getByTestId("task-action-confirm-yes").click();
    await sheet.locator('[data-testid="task-action-outcome"], [data-testid="task-action-refusal"]').first().waitFor({ timeout: ROW_BOUND_MS });
    const cancelShown = await shownWords(sheet);
    const cancelled = await until(async () => ((await rowOf(session, id))?.status === "cancelled" ? true : undefined), ROW_BOUND_MS);
    if (cancelled === undefined) failures.push(`cancel: the row never read cancelled; it reads ${(await rowOf(session, id))?.status} (the page said ${cancelShown})`);
    else {
      const stopped = await until(async () => {
        const status = await requestStatus(run);
        return status !== undefined && status !== "in_progress" ? status : undefined;
      }, RUN_STOP_BOUND_MS);
      if (stopped === undefined) failures.push(`cancel: the run's request ${run.requestId} was still in_progress ${RUN_STOP_BOUND_MS} ms after the row read cancelled`);
      else notes.push(`cancel: row cancelled after ${cancelled.afterMs} ms; its run's request ${stopped.value} ${stopped.afterMs} ms later`);
      // The row stays cancelled once the run has stopped: the stop doesn't read as a failure.
      await sleep(STEP_MS);
      const after = (await rowOf(session, id))?.status;
      if (after !== "cancelled") failures.push(`cancel: the row read ${after} after its run stopped, not cancelled`);
    }

    // ── retry: Retry shows once the row is cancelled, and runs the same task again.
    const retry = sheet.getByTestId("task-action-retry");
    const offered = await retry.waitFor({ timeout: ROW_BOUND_MS }).then(() => true, () => false);
    if (!offered) failures.push(`retry: the sheet never offered Retry; the row reads ${(await rowOf(session, id))?.status}`);
    else {
      await retry.click();
      await sheet.locator('[data-testid="task-action-outcome"], [data-testid="task-action-refusal"]').first().waitFor({ timeout: ROW_BOUND_MS });
      const retryShown = await shownWords(sheet);
      const again = await until(async () => {
        const row = await rowOf(session, id);
        return row !== undefined && ["pending", "in_progress"].includes(row.status) && row.attempts > attemptsBefore ? row : undefined;
      }, ROW_BOUND_MS);
      if (again === undefined) {
        const row = await rowOf(session, id);
        failures.push(`retry: task ${id} never ran again (it reads ${row?.status}, attempts ${row?.attempts}; the page said ${retryShown})`);
      } else notes.push(`retry: the same task ${id} reads ${again.value.status}, attempt ${again.value.attempts} (was ${attemptsBefore})`);
    }
    if ((await rowsOf(session)).length !== 1) failures.push(`the session's board holds ${(await rowsOf(session)).length} rows, not the one filed`);

    // ── error: a task whose run fails shows the error its row recorded, in its sheet.
    const failing = await openSessionOn(fixture.failingProject, gone);
    rmSync(gone, { recursive: true, force: true });
    const failingTitle = "Note the gone repository";
    const failingId = await file(failing, failingTitle, fixture.failingGoal);
    const errored = await until(async () => ((await rowOf(failing, failingId))?.status === "errored" ? true : undefined), 120_000, 2_000);
    if (errored === undefined) throw new Error(`setup: the failing task never failed: ${JSON.stringify(await rowOf(failing, failingId))}`);
    const recorded = String((await taskOf(failing, failingId))?.error ?? "");
    tell.over("error · the board's recorded error", recorded === "" ? [] : [recorded]);
    const failedSheet = await openSheet(failingTitle, "errored");
    const shownError = await until(async () => {
      const alert = failedSheet.getByRole("alert");
      const text = (await alert.count()) > 0 ? ((await alert.first().textContent()) ?? "") : "";
      return text.includes(recorded) ? text : undefined;
    }, ROW_BOUND_MS);
    if (shownError === undefined) failures.push(`error: the failed task's sheet doesn't show the error its row recorded: ${JSON.stringify(recorded.slice(0, 160))}`);
    else notes.push(`error: the sheet shows ${JSON.stringify(recorded.slice(0, 100))}`);

    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    if (CONTROL !== "") notes.push(`control ${CONTROL}: the page said ${[steerShown, cancelShown].join(" / ")}`);
    return { failures, evidence: notes.join("; ") };
  } finally {
    await browser?.close();
    if (lab !== undefined) stopProcessGroup(lab.child);
    unplant();
    // A control's pages are rebuilt from the restored source, so the next run serves the real ones.
    if (CONTROL !== "") buildPages();
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
  }
});

/**
 * Goal check, FIX-2382: in the Teammates lab, a person steers, cancels and
 * re-runs a coding task from its popup, by clicks, with no model turn in
 * between, and each outcome is read back from the board and the run. See
 * goal.md for the contract.
 *
 * `fsdev dev --app <pages>` on a fresh store over a git checkout, the coding
 * workers on the lab's scripted harness (`GOAL_HARNESS=stub`), and the pages
 * built from a scratch copy of the lab's source (a control's patch lands only
 * in that copy, and is printed). Lead answers on the lab's own model
 * when a task's notice wakes it; nothing in the legs waits on what it says.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/teammates-lab/stops-and-re-runs-a-task-from-its-popup/run.mts
 * Controls: GOAL_CONTROL=wrong-board | other-session, same command (goal.md → Controls).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { ClientHttpError, createClient } from "@flow-state-dev/client";
import { STEER_POLL_MS } from "@flow-state-dev/harness-manager";
import { createInboxClient, inboxItems, taskActionName, taskListViewRef, type InboxHold, type InboxTaskInput } from "@flow-state-dev/orchestration/inbox";
import { parseNotice } from "@flow-state-dev/orchestration/tasks";
import { createWorkforceClient, WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { goalTmpDir, loadFixture, REPO_ROOT, repoPath, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { itemsOf, sleep, startTeammates, type Fsd } from "../lab.mts";

const fixture = loadFixture<{
  filer: string;
  coder: string;
  rerunOn: { worker: string; label: string };
  task: { title: string; goal: string; context: string };
}>(import.meta.url);

const USER = "u_goal";
const LAB = repoPath("labs", "teammates");
/** The conversation board's actions and read, as the lab names them. */
const BOARD = "tasks";
const CREATE_TASK = taskActionName("createTask", BOARD);
const GET_TASK = taskActionName("getTask", BOARD);
const UPDATE_TASK = taskActionName("updateTask", BOARD);
/** Each of the scripted run's five steps: long enough to steer and cancel mid-run. */
const STEP_MS = 6_000;
/** A run that loses its row stops within one steer poll; the slack covers the request's own end and our read. */
const STOP_BOUND_MS = STEER_POLL_MS + 5_000;
const say = (s: string) => console.error(`[tm-task-buttons ${new Date().toISOString().slice(11, 19)}] ${s}`);

type Patch = { file: string; from: string; to: string; why: string };
const CONTROLS: Record<string, Patch[]> = {
  "": [],
  "wrong-board": [
    {
      file: "src/adapter.ts",
      from: "inbox.board({ flowId: await flowOf(), sessionId, board: TASK_BOARD });",
      to: 'inbox.board({ flowId: await flowOf(), sessionId, board: "plan" });',
      why: 'the task\'s action row is bound to board "plan", not the conversation\'s "tasks"',
    },
  ],
  "other-session": [
    {
      file: "src/adapter.ts",
      from: "return (await board()).refile(refileRowOf(whole), rerunOverrides(whole, worker));",
      to:
        `const other = (await workforce.listWorkerSessions(${JSON.stringify(fixture.filer)})).find((s) => !s.isDefault)!.session; ` +
        "return inbox.board({ flowId: other.flowId ?? other.flowKind, sessionId: other.id, board: TASK_BOARD }).refile(refileRowOf(whole), rerunOverrides(whole, worker));",
      why: "Re-run is bound to a second conversation with Lead, not the one that filed the task",
    },
  ],
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (!(CONTROL in CONTROLS)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).filter(Boolean).join(", ")}`);

/**
 * The lab's pages, built from a scratch copy of its source with `patches`
 * applied (Tailwind reads class names off the files on disk, so a patch lands
 * in a copy, never the checkout).
 */
function buildPages(scratch: string, patches: readonly Patch[]): string {
  const root = join(scratch, "source");
  cpSync(LAB, root, { recursive: true, filter: (src) => !/[/\\](node_modules|dist-client|\.fsdev)$/.test(src) });
  symlinkSync(join(LAB, "node_modules"), join(root, "node_modules"));
  const tsconfig = join(root, "tsconfig.json");
  writeFileSync(tsconfig, readFileSync(tsconfig, "utf8").replace('"../../tsconfig.base.json"', JSON.stringify(join(REPO_ROOT, "tsconfig.base.json"))));
  for (const patch of patches) {
    const path = join(root, patch.file);
    const before = readFileSync(path, "utf8");
    const after = before.replace(patch.from, patch.to);
    if (after === before) throw new Error(`setup: ${patch.why}, but ${patch.file} has nothing to patch (looked for ${patch.from})`);
    writeFileSync(path, after);
    say(`control ${CONTROL}: ${patch.file}: ${patch.why}\n    - ${patch.from}\n    + ${patch.to}`);
  }
  const pages = join(scratch, "pages");
  const built = spawnSync(join(LAB, "node_modules", ".bin", "vite"), ["build", "--config", join(root, "vite.config.ts"), "--outDir", pages, "--emptyOutDir", "--logLevel", "error"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (built.status !== 0) throw new Error(`setup: vite build failed: ${(built.stderr || built.stdout).slice(-1500)}`);
  return pages;
}

type Row = InboxTaskInput & { goal: string; title?: string; assignee?: string; attempts?: number; error?: string };
/** A row as `getTask` answers it: its brief and its steers too. */
type WholeRow = { status?: string; goal?: string; title?: string; context?: string; assignee?: string; attempts?: number; error?: string; steers?: { message: string }[] };
type Board = { flow: string; sessionId: string };

/** A board's rows, as its task-list view answers: stores nothing, touches no row. */
async function rowsOf(fsd: Fsd, board: Board): Promise<Row[]> {
  try {
    return (await fsd.view(taskListViewRef(board.flow, BOARD), {}, { sessionId: board.sessionId })).value as Row[];
  } catch (error) {
    // A conversation nothing was ever filed on has no board yet: it holds no rows.
    if (error instanceof ClientHttpError && error.status === 422) return [];
    throw error;
  }
}

/** One board action on `board`, and its output. */
async function act(fsd: Fsd, board: Board, action: string, input: unknown): Promise<any> {
  const sent = await fsd.flow(board.flow).send(action, input, { sessionId: board.sessionId });
  await sent.wait({ timeoutMs: 60_000 });
  const requests = (await fsd.sessions.requests(board.sessionId, { limit: 100, includeResultOutput: true })) as Array<{ id: string; result?: { output?: unknown } }>;
  return requests.find((request) => request.id === sent.id)?.result?.output;
}

/** One whole row, with its steers and context, through the board's `getTask`. */
async function wholeRow(fsd: Fsd, board: Board, id: string): Promise<WholeRow | undefined> {
  const output = await act(fsd, board, GET_TASK, { id });
  return output?.ok === true ? (output.task ?? output) : undefined;
}

/** Poll `read` until `done` holds of it, or `ms` pass; the last value read, and whether it held. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number, every = 1_000): Promise<{ value: T; held: boolean }> {
  let value = await read();
  for (const end = Date.now() + ms; !done(value) && Date.now() < end; ) {
    await sleep(every);
    value = await read();
  }
  return { value, held: done(value) };
}

/** The steps a run said in its session so far. */
async function stepsOf(fsd: Fsd, runSession: string): Promise<number> {
  return (await itemsOf(fsd, runSession)).filter((item) => item.type === "message" && item.role === "assistant").length;
}

const inProgress = async (fsd: Fsd, sessionId: string) =>
  ((await fsd.sessions.requests(sessionId, { limit: 50 })) as Array<{ id: string; status: string }>).filter((r) => r.status === "in_progress");

/** The row action's last outcome or refusal, once the press has ended. */
async function pressed(page: Page): Promise<{ outcome?: string; refusal?: string }> {
  await page.waitForFunction(
    () => {
      const row = document.querySelector('[role="dialog"] [data-testid="task-action-row"]');
      return row !== null && row.getAttribute("aria-busy") === "false" && row.querySelector('[data-testid="task-action-outcome"], [data-testid="task-action-refusal"]') !== null;
    },
    undefined,
    { timeout: 90_000 },
  );
  const text = (id: string) => page.locator(`[role="dialog"] [data-testid="${id}"]`).textContent({ timeout: 1_000 }).catch(() => undefined);
  const [outcome, refusal] = [await text("task-action-outcome"), await text("task-action-refusal")];
  return { ...(outcome == null ? {} : { outcome }), ...(refusal == null ? {} : { refusal }) };
}

/** Click `selector` in the open popup once it shows, or say it never did. */
async function click(page: Page, selector: string, ms = 20_000): Promise<boolean> {
  const target = page.locator(`[role="dialog"] ${selector}`).first();
  try {
    await target.waitFor({ state: "visible", timeout: ms });
    await target.click({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** The row's open review, as the Inbox reads it: where its answer goes. */
async function reviewHold(fsd: Fsd, board: Board, row: Row): Promise<InboxHold | undefined> {
  const runFlow = row.run == null ? null : await fsd.sessions.get(row.run.sessionId).then((d) => d.flowId ?? d.flowKind ?? null);
  const [item] = inboxItems({
    rows: [{ ...row, board: board.sessionId, holder: { sessionId: board.sessionId, action: UPDATE_TASK } }],
    suspensions: [],
    flowOf: (id) => (id === board.sessionId ? board.flow : runFlow),
  });
  return item?.holds.find((h) => h.ask.kind === "review");
}

await runGoal(async (failures, tell) => {
  if (process.env.AI_GATEWAY_API_KEY === undefined) throw new Error("setup: needs AI_GATEWAY_API_KEY (Lead's woken turns and the run's judge)");
  const scratch = goalTmpDir(`tm-task-buttons${CONTROL === "" ? "" : `-${CONTROL}`}`);
  const pages = buildPages(scratch, CONTROLS[CONTROL]!);
  // A checkout with one commit, so a run has a HEAD to cut its branch from, that ignores `.fsdev/`.
  const workdir = join(scratch, "workdir");
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, "README.md"), "# Team\n");
  writeFileSync(join(workdir, ".gitignore"), ".fsdev/\n");
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args], { cwd: workdir });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "Start the README");

  const lab = await startTeammates(scratch, USER, { GOAL_HARNESS: "stub", GOAL_HARNESS_STEP_MS: String(STEP_MS) }, workdir, pages);
  const browser = await launchChromium();
  try {
    const fsd: Fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const workforce = createWorkforceClient(fsd);
    const boardOf = async (worker: string): Promise<Board> => {
      const session = await workforce.ensureWorkerSession({ worker });
      return { flow: session.flowId ?? session.flowKind, sessionId: session.id };
    };
    const cos = await boardOf(fixture.filer);
    // A second conversation with Lead, which files too: where a control's re-run is sent.
    // Opened in every run, so the boards read are the same with or without a control.
    const second = await fsd.flow(cos.flow).createSession({ title: "Another conversation", state: { [WORKER_ID_STATE_KEY]: fixture.filer } });
    const other: Board = { flow: cos.flow, sessionId: second.id };
    if ((await workforce.listWorkerSessions(fixture.filer)).filter((s) => !s.isDefault).map((s) => s.session.id).join() !== second.id) {
      throw new Error("setup: the second conversation with Lead isn't listed as its one other session");
    }
    const everyRow = async () => [...(await rowsOf(fsd, cos)).map((row) => ({ row, board: cos })), ...(await rowsOf(fsd, other)).map((row) => ({ row, board: other }))];

    // The coding task, filed as a screen files one, on Lead's board.
    const filed = await act(fsd, cos, CREATE_TASK, { assignee: fixture.coder, ...fixture.task });
    const taskId: string | undefined = filed?.taskId;
    if (taskId === undefined) throw new Error(`setup: ${CREATE_TASK} filed nothing: ${JSON.stringify(filed)}`);
    // Steer and cancel only once the run is read as running: never on a timer.
    const running = await until(
      async () => {
        const row = (await rowsOf(fsd, cos)).find((r) => r.id === taskId);
        const runSession = row?.status === "in_progress" ? row.run?.sessionId : undefined;
        return { row, runSession, live: runSession == null ? [] : await inProgress(fsd, runSession) };
      },
      (read) => read.live.length > 0,
      120_000,
    );
    if (!running.held) throw new Error(`setup: the coding run never read as running: ${JSON.stringify(running.value.row)}`);
    const runSession = running.value.runSession!;
    say(`task ${taskId} running in ${runSession}`);

    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(lab.origin);
    await page.locator(`nav[aria-label="Workers"] button[data-worker="Lead"]`).click();
    const panel = page.locator(`aside[aria-label="Lead's panel"]`);
    await panel.locator(`button[aria-label^="Coding task: ${fixture.task.title}, on Cursor"]`).click();
    await page.locator('[role="dialog"] [data-testid="task-action-row"]').waitFor();

    // ---- steer: the words reach the row -------------------------------------------------
    const words = `Say it opens at nine sharp (${Date.now() % 100_000}).`;
    await page.locator('[role="dialog"] [data-testid="task-action-steer-input"]').fill(words);
    await page.locator('[role="dialog"] [data-testid="task-action-steer"]').click();
    const steered = await pressed(page);
    const steers = await until(
      async () => (await wholeRow(fsd, cos, taskId))?.steers ?? [],
      (list) => list.some((s) => s.message === words),
      10_000,
    );
    if (!steers.held) failures.push(`steer — the row's steers don't hold the words (${JSON.stringify(steers.value.map((s) => s.message))}); the page said ${JSON.stringify(steered)}`);

    // ---- cancel: the row ends cancelled, and its run stops within one steer poll --------------
    const stepsBefore = await stepsOf(fsd, runSession);
    let cancelled = false;
    if (!(await click(page, '[data-testid="task-action-cancel"]')) || !(await click(page, '[data-testid="task-action-confirm-yes"]'))) {
      failures.push("cancel — the popup offered no Cancel and Yes");
    } else {
      const pressedAt = Date.now();
      const answer = await pressed(page);
      const row = await until(async () => (await rowsOf(fsd, cos)).find((r) => r.id === taskId), (r) => r?.status === "cancelled", 10_000);
      cancelled = row.held;
      if (!row.held) failures.push(`cancel — the row reads ${row.value?.status}, not cancelled; the page said ${JSON.stringify(answer)}`);
      // The bound runs from the press, not from the row's read above.
      const stopped = await until(() => inProgress(fsd, runSession), (live) => live.length === 0, Math.max(0, STOP_BOUND_MS - (Date.now() - pressedAt)), 250);
      const tookMs = Date.now() - pressedAt;
      if (!stopped.held || tookMs > STOP_BOUND_MS) failures.push(`cancel — the run's request ${stopped.held ? "left in_progress only" : "is still in_progress"} ${tookMs} ms after the press (bound ${STOP_BOUND_MS} ms)`);
      else {
        const stepsAtStop = await stepsOf(fsd, runSession);
        await sleep(STEP_MS * 2);
        const stepsLater = await stepsOf(fsd, runSession);
        if (stepsLater !== stepsAtStop) failures.push(`cancel — the run said ${stepsLater - stepsAtStop} more step(s) after its request ended`);
        say(`cancel: run stopped ${tookMs} ms after the press, ${stepsAtStop - stepsBefore} step(s) said meanwhile, none after`);
      }
    }

    // ---- re-run on another harness: one new row on that worker, the old brief and a line naming it --
    const before = await wholeRow(fsd, cos, taskId);
    const idsBefore = new Set((await everyRow()).map(({ row }) => row.id));
    const rerunButton = `[data-testid="task-action-rerun"][data-label="${fixture.rerunOn.label}"]`;
    let rerun: { row: Row; board: Board } | undefined;
    if (!(await click(page, rerunButton))) {
      failures.push(`re-run — the popup offered no "Re-run on ${fixture.rerunOn.label}" (the task reads ${cancelled ? "cancelled" : "not cancelled"})`);
    } else {
      const answer = await pressed(page);
      const added = await until(async () => (await everyRow()).filter(({ row }) => !idsBefore.has(row.id)), (rows) => rows.length > 0, 10_000);
      const onWorker = added.value.filter(({ row }) => row.assignee === fixture.rerunOn.worker);
      if (added.value.length !== 1 || onWorker.length !== 1) {
        failures.push(`re-run — ${added.value.length} new row(s), ${onWorker.length} on ${fixture.rerunOn.worker}, not exactly one; the page said ${JSON.stringify(answer)}`);
      }
      rerun = onWorker[0];
      if (rerun !== undefined) {
        const whole = await wholeRow(fsd, rerun.board, rerun.row.id);
        const context = whole?.context ?? "";
        const head = `${fixture.task.context}\n\n`;
        if (!context.startsWith(head) || !context.slice(head.length).includes(`"${fixture.task.title}"`)) {
          failures.push(`re-run — its context is ${JSON.stringify(context)}, not the old context plus a line naming "${fixture.task.title}"`);
        }
        if (whole?.goal !== fixture.task.goal) failures.push(`re-run — its goal is ${JSON.stringify(whole?.goal)}, not the old task's`);
      }
      const after = await wholeRow(fsd, cos, taskId);
      const kept = (r: WholeRow | undefined) => JSON.stringify([r?.status, r?.goal, r?.title, r?.context, r?.assignee, r?.attempts, r?.steers?.length, r?.error]);
      if (kept(after) !== kept(before)) failures.push(`re-run — the old row changed: ${kept(before)} → ${kept(after)}`);
    }

    // ---- re-run on the same harness again: the board's own refusal, no row added ----------------
    const idsBeforeAgain = (await everyRow()).length;
    if (!(await click(page, rerunButton, 5_000))) {
      failures.push(`re-run again — the popup offered no "Re-run on ${fixture.rerunOn.label}" to press again`);
    } else {
      const answer = await pressed(page);
      if (!/^already_open: /.test(answer.refusal ?? "")) failures.push(`re-run again — the page shows ${JSON.stringify(answer)}, not the board's already_open words`);
      await sleep(3_000);
      const idsAfterAgain = (await everyRow()).length;
      if (idsAfterAgain !== idsBeforeAgain) failures.push(`re-run again — the boards went from ${idsBeforeAgain} to ${idsAfterAgain} rows`);
    }

    // ---- the re-run's result reaches Lead's conversation ----------------------------------
    // The scripted run commits, so its task waits for a review: accepted here, as the popup's Accept would.
    if (rerun === undefined) {
      failures.push("result — no re-run was filed, so no result can reach Lead");
    } else {
      const { board } = rerun;
      const held = await until(async () => (await rowsOf(fsd, board)).find((r) => r.id === rerun!.row.id), (r) => r !== undefined && (r.holds ?? []).some((h) => h.ask.kind === "review"), 300_000, 3_000);
      const hold = held.held ? await reviewHold(fsd, board, held.value!) : undefined;
      if (hold === undefined) failures.push(`result — the re-run never waited for its review (it reads ${held.value?.status}${held.value?.error ? `: ${held.value.error}` : ""})`);
      else {
        await createInboxClient(fsd).answerOne(hold, { value: { verdict: "accepted" } });
        const done = await until(async () => (await rowsOf(fsd, board)).find((r) => r.id === rerun!.row.id), (r) => r?.status === "completed", 120_000, 2_000);
        if (!done.held) failures.push(`result — the re-run reads ${done.value?.status} after its review was accepted, not completed`);
        const notice = await until(
          async () => (await itemsOf(fsd, cos.sessionId)).filter((item) => parseNotice(item as never)?.taskId === rerun!.row.id),
          (found) => found.length > 0,
          90_000,
          2_000,
        );
        if (!notice.held) failures.push(`result — Lead's conversation holds no notice of the re-run's ending (${rerun.row.id}, filed on ${board.sessionId === cos.sessionId ? "its board" : "another conversation's board"})`);
      }
    }

    // ---- Lead files nothing of its own beside the pressed re-run --------------------------
    // Its woken turns (the cancel's notice, the re-run's) end first; then its board holds the old task and the re-run, and nothing else.
    await until(() => inProgress(fsd, cos.sessionId), (live) => live.length === 0, 240_000, 3_000);
    await sleep(5_000);
    await until(() => inProgress(fsd, cos.sessionId), (live) => live.length === 0, 120_000, 3_000);
    const cosRows = tell.over("Lead's board rows", await rowsOf(fsd, cos));
    const expected = [taskId, ...(rerun?.board === cos ? [rerun.row.id] : [])];
    const extra = cosRows.filter((r) => !expected.includes(r.id));
    if (extra.length > 0) failures.push(`cos-files-nothing — Lead's board holds ${extra.length} row(s) beside the old task and the re-run: ${extra.map((r) => `${r.title ?? r.goal} → ${r.assignee}`).join("; ")}`);
    if (!cosRows.some((r) => r.id === rerun?.row.id)) failures.push("cos-files-nothing — Lead's board doesn't hold the pressed re-run");

    return {
      failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
      evidence: `steered, cancelled and re-ran ${taskId} from its popup; re-run ${rerun?.row.id} on ${fixture.rerunOn.worker}, refused again as already_open, its result noticed in Lead's conversation; the board holds ${cosRows.length} rows`,
    };
  } finally {
    await browser.close().catch(() => {});
    stopProcessGroup(lab.child, "SIGKILL");
  }
});

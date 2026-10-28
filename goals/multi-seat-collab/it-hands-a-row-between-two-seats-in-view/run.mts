/**
 * Goal check — a planner files work for its two delegates on its own
 * conversation's board, a person answers a held row's question through that
 * conversation, the work changes hands, and a reader can say what happened
 * from the DevTool's own screens.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * The server is the shipped `fsdev dev` over the lab's `fsdev.config.mts`, and
 * Chromium loads the shipped DevTool bundle, so what is graded is what a person
 * running the dev server sees — not a harness assembled around the pieces.
 *
 * Legs (every failure line is tagged with its leg, so a control can prove it
 * went red where it says it does and nowhere else):
 *
 *   V0  no file declares a board: no MAILBOX.md, no `boards:`; the planner's
 *       file names its delegates
 *   V1  one row per piece, for a delegate; a row for nobody runs nowhere
 *   V2  each row ran on the worker whose OWN FILE answers for its desk
 *   V3  the worker asks, the row holds on its question and nothing stays running; the
 *       answer lands through the planner's conversation and the same task
 *       session finishes; a second answer is declined
 *   V4  every claim is the planner's board's; an answer sent as a second
 *       person does not land
 *   V5  the follow-on row, for the other desk, waits on the first and runs
 *       on another worker; the assignee is never moved
 *   V6  `TaskStatus` has gained no value
 *   VB  three screens, on the DevTool's own navigation, in a real browser
 *
 * Run:      pnpm tsx goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view/run.mts
 * Controls: GOAL_CONTROL=swapped-desks | ignore-the-answer | second-principal |
 *           silent-park | one-worker  (each must FAIL, at the legs goal.md names)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { REPO_ROOT, goalTmpDir, loadFixture, runGoal } from "../../lib/index.mts";
import { LAB_USER_ID, readLabTree, routesFor } from "../../../packages/shift-manager/test/fixtures/multi-worker-collab/host.mts";
import { LAB_CONFIG, Scenario, serveLab, type ActResult, type BoardRow, type ChangeRecord } from "../run-scenario.mts";
import type { WorkLine } from "../../../packages/shift-manager/test/fixtures/multi-worker-collab/workforce/flows/workers/worker.mts";

type Fixture = {
  piece: { goal: string; desk: string; asks: string; then: { goal: string; desk: string } };
  answer: string;
  secondAnswer: string;
  otherPrincipal: string;
  orphan: string;
};

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
/** Every file this proof ships — the lab and this goal — for V0's scan. */
const PROOF_DIRS = [fileURLToPath(new URL("..", import.meta.url)), dirname(LAB_CONFIG)];
const SHOTS = goalTmpDir("multi-seat-collab");

/**
 * The legs each control must redden, and only those. `one-worker` is the one
 * that reddens two, and must redden BOTH: filing the review row for the build
 * desk's worker is what puts a review row on a worker that answers for build.
 */
const EXPECTED: Record<string, readonly string[]> = {
  "swapped-desks": ["V2"],
  "ignore-the-answer": ["V3"],
  "second-principal": ["V4"],
  "silent-park": ["VB"],
  "one-worker": ["V2", "V5"],
};

/**
 * `TaskStatus`, written out. **Pinned** — a later widening (for *handed-off*,
 * *notified* or *waiting on you*) must fail here rather than pass.
 */
const TASK_STATUSES = ["pending", "in_progress", "held", "completed", "errored", "cancelled"];

/** How long a second person's delivery gets to land before it is judged not to have. */
const SECOND_PRINCIPAL_WINDOW_MS = 3_000;

/** The board run's own action on the filing conversation: where every claim is made. */
const BOARD_RUN_ACTION = "dispatch";

const failures: string[] = [];
const notes: string[] = [];
function fail(leg: string, line: string): void {
  failures.push(`[${leg}] ${line}`);
}

/**
 * V4's rule for a `404` to the second person's delivery, in one place.
 *
 * The engine answers another user's session with `404 Unknown session`, the
 * same answer an unused id gets. So the 404 counts as the refusal only when its
 * `error` names the planner's conversation AND the owner's own delivery to that
 * same session is then admitted: that admission is what tells "refused this
 * caller" from "no such session".
 *
 * @param other The second person's delivery, which came back `404`.
 * @param ownerAnswer The owner's own delivery to the same session, sent after.
 * @param sessionId The conversation both were addressed to.
 * @returns A failure line for V4, or a note when the 404 is the refusal.
 */
function judgeHiddenSession(
  other: ActResult,
  ownerAnswer: ActResult,
  sessionId: string,
): { fail: string } | { note: string } {
  let error: unknown;
  try {
    error = (JSON.parse(other.refusal ?? "") as { error?: unknown } | null)?.error;
  } catch {
    error = undefined;
  }
  if (error !== `Unknown session "${sessionId}"`) {
    return { fail: `the second person's delivery came back 404 ${other.refusal} — neither an explicit refusal nor a request the fence was exercised on` };
  }
  if (ownerAnswer.httpStatus !== 202) {
    return { fail: `the second person's delivery came back 404 ${other.refusal}, and the owner's own delivery to the same session came back ${ownerAnswer.httpStatus} — a 404 there cannot be told from an unused id` };
  }
  return { note: `the second person's delivery was refused at admission as an unknown session (404 ${other.refusal}), and the owner's own delivery to the same session was admitted` };
}

function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

/** A Chromium already on the machine, when the pinned build is not. See `flow-instances`. */
function preinstalledChromium(): string | undefined {
  const pool = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pool === undefined || !existsSync(pool)) return undefined;
  for (const entry of readdirSync(pool)) {
    if (!entry.startsWith("chromium-")) continue;
    const binary = join(pool, entry, "chrome-linux", "chrome");
    if (existsSync(binary)) return binary;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The browser half: the DevTool's own navigation, nothing else
// ---------------------------------------------------------------------------

/**
 * Open the one copy of `flow` in the navigator: its kind row, then the copy's
 * own row (a copy's id is its kind), which lists the sessions on it.
 */
async function openCopy(page: Page, flow: string): Promise<void> {
  const kindRow = page.locator(`[data-kind="${flow}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const copyRow = page.locator(`[data-instance-id="${flow}"]`);
  if ((await copyRow.getAttribute("aria-expanded")) !== "true") await copyRow.click();
}

/** Open one session from the navigator: the copy of the flow it is on, then the session row. */
async function openSession(page: Page, flow: string, sessionId: string): Promise<void> {
  await openCopy(page, flow);
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await waitForBadge(page, sessionId);
}

async function waitForBadge(page: Page, sessionId: string): Promise<void> {
  await page.waitForFunction(
    (id) => [...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(id)),
    sessionId,
    { timeout: 15_000 },
  );
}

async function openBadgeSession(page: Page): Promise<string | undefined> {
  const title = await page.getByTitle(/^Session ID: /).getAttribute("title");
  return /^Session ID: (\S+)/.exec(title ?? "")?.[1];
}

/**
 * One row of the Tasks tab, found by its task id, read slot by slot (status,
 * goal, reason, assignee) off the collapsed row — or `undefined` if it never
 * appeared.
 */
async function taskRow(
  page: Page,
  taskId: string,
  until: (cells: Record<string, string>) => boolean = () => true,
): Promise<
  { cells: Record<string, string>; reasonClipped: boolean; reasonTitle: string | null } | undefined
> {
  const tab = page.getByRole("tab", { name: "Tasks" });
  await tab.click();
  await page.waitForFunction(
    () => document.querySelector("[role='tab'][aria-selected='true']")?.textContent?.trim() === "Tasks",
    undefined,
    { timeout: 10_000 },
  );
  for (let waited = 0; waited < 10_000; waited += 250) {
    const read = await page.evaluate((id) => {
      // Only the Tasks tab's own panel — never a row some other view drew.
      for (const row of document.querySelectorAll("main [role='tabpanel'][data-state='active'] [data-task-id]")) {
        if (row.getAttribute("data-task-id") !== id) continue;
        const cells: Record<string, string> = {};
        for (const [head, name] of [["Status", "status"], ["Goal", "goal"], ["Reason", "reason"], ["Assignee", "assignee"]]) {
          const el = row.querySelector(`[data-slot="${name}"]`);
          if (el !== null) cells[head!] = (el.textContent ?? "").trim();
        }
        const reasonCell = row.querySelector<HTMLElement>('[data-slot="reason"]');
        // A long note is clamped to its slot and carries its whole text on
        // the slot's title — the DevTool's own design. Read both, so a clamp
        // is graded on the title rather than passed on text nobody can see.
        const reasonClipped = reasonCell !== null && reasonCell.scrollWidth > reasonCell.clientWidth;
        return { cells, reasonClipped, reasonTitle: reasonCell?.getAttribute("title") ?? null };
      }
      return undefined;
    }, taskId);
    if (read !== undefined && until(read.cells)) return read;
    await page.waitForTimeout(250);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function main() {
  if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
    return { failures: [`unknown control ${JSON.stringify(CONTROL)}`], evidence: "" };
  }
  const tree = await readLabTree();
  const workers = tree.workerIds;
  const desks = new Set(Object.values(tree.declaredDesks));
  // The app's desk -> delegate map, as the filer reads it. Never graded
  // against: every leg below grades against the tree.
  const routes = routesFor(CONTROL);

  // The fixture's desks have to be desks the TREE declares, or every leg below
  // grades a desk nobody answers for.
  for (const desk of [fixture.piece.desk, fixture.piece.then.desk]) {
    if (!desks.has(desk)) {
      return { failures: [`the fixture names desk "${desk}", which no WORKER.md answers for`], evidence: "" };
    }
  }

  // ---- V0. no file declares a board ----------------------------------------
  const files = PROOF_DIRS.flatMap(treeFiles);
  for (const path of files.filter((candidate) => candidate.endsWith("MAILBOX.md"))) {
    fail("V0", `${path} declares a mailbox; the planner's board is its own conversation's`);
  }
  for (const path of files.filter((candidate) => candidate.endsWith("WORKER.md"))) {
    if (/^boards\s*:/m.test(readFileSync(path, "utf8"))) fail("V0", `${path} declares a board by name`);
  }
  if (tree.delegates.length !== workers.length) {
    fail("V0", `the planner's file delegates to [${tree.delegates.join(", ")}], not to the two workers`);
  }

  // ---- V6. no new status --------------------------------------------------
  const statuses = [...taskStatusSchema.options];
  if (statuses.length === 0 || statuses.join(",") !== TASK_STATUSES.join(",")) {
    fail("V6", `TaskStatus is [${statuses.join(", ")}], not the written [${TASK_STATUSES.join(", ")}]`);
  }

  // The bundle the server hands out, built here so the run cannot grade a stale one.
  try {
    execFileSync("pnpm", ["--filter", "@flow-state-dev/devtool", "build:assets"], { cwd: REPO_ROOT, stdio: "ignore" });
  } catch {
    throw new Error(
      "could not build the DevTool bundle. On a clean checkout build the package first:\n" +
        "  pnpm --filter @flow-state-dev/devtool build\n  pnpm --filter @flow-state-dev/devtool build:assets",
    );
  }

  const served = await serveLab({ control: CONTROL, workDir: join(SHOTS, "server") });
  const lab = new Scenario(served, tree, routes);
  const plannerFlow = tree.workerFlows[tree.plannerId]!;
  let browser: Browser | undefined;
  try {
    await lab.open();
    browser = await chromium.launch({ headless: true, ...(preinstalledChromium() === undefined ? {} : { executablePath: preinstalledChromium() }) });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(served.origin, { waitUntil: "networkidle" });

    // ---- V1. the planner files one row per piece -------------------------
    const filed = await lab.file({ goal: fixture.piece.goal, desk: fixture.piece.desk, asks: fixture.piece.asks });
    const firstId = typeof filed.output?.taskId === "string" ? (filed.output.taskId as string) : undefined;
    if (filed.status !== "completed" || filed.output?.ok !== true || firstId === undefined) {
      return { failures: [...failures, `[V1] the planner's filing ended ${filed.status ?? filed.refusal}: ${JSON.stringify(filed.output)}`], evidence: "" };
    }
    // The work the first piece implies for the other desk, filed now and
    // waiting on it: one board, a second row, a second assignee.
    const filedNext = await lab.file({ goal: fixture.piece.then.goal, desk: fixture.piece.then.desk, follows: firstId });
    const secondId = typeof filedNext.output?.taskId === "string" ? (filedNext.output.taskId as string) : undefined;
    if (filedNext.status !== "completed" || filedNext.output?.ok !== true || secondId === undefined) {
      fail("V1", `the planner's filing of the follow-on row ended ${filedNext.status ?? filedNext.refusal}: ${JSON.stringify(filedNext.output)}`);
    }
    const first = await lab.waitForRow((row) => row.id === firstId);
    if (first === undefined) {
      return { failures: [...failures, `[V1] the row the filing answered (${firstId}) never reached the board`], evidence: "" };
    }
    const rowsAfterFiling = lab.rows();
    if (rowsAfterFiling.length !== 2) {
      fail("V1", `${rowsAfterFiling.length} rows landed for two pieces of work (the planner has ${tree.delegates.length} delegates)`);
    }
    for (const [row, piece] of [[first, fixture.piece], [rowsAfterFiling.find((row) => row.id === secondId), fixture.piece.then]] as const) {
      if (row === undefined) {
        fail("V1", `the follow-on row ${secondId} never reached the board`);
        continue;
      }
      if (row.goal !== piece.goal) fail("V1", `row ${row.id} does not carry its piece verbatim: ${JSON.stringify(row.goal)}`);
      if (row.input?.desk !== piece.desk) fail("V1", `row ${row.id} carries desk ${JSON.stringify(row.input?.desk)}, not "${piece.desk}"`);
      if (!tree.delegates.includes(String(row.assignee))) fail("V1", `row ${row.id} is for "${row.assignee}", who is not among the planner's delegates`);
      if (row.partition !== first.partition) fail("V1", `row ${row.id} is on board ${row.partition}, not the planner's conversation's ${first.partition}`);
    }

    // ---- V3 (the ask). the worker asks, the row holds on the question, and nothing stays running
    const askedLines = () => lab.workLines().filter((line) => line.taskId === firstId && line.event === "asked");
    /** The row's open question: a row hold no steer answers yet. */
    const openQuestion = (row: BoardRow | undefined) => {
      const answered = new Set((row?.steers ?? []).flatMap((steer) => (steer.answers === undefined ? [] : [steer.answers])));
      return row?.status === "in_progress" ? row.questions?.find((hold) => hold.source.kind === "row" && !answered.has(hold.id)) : undefined;
    };
    const heldRow = await lab.waitForRow((row) => row.id === firstId && openQuestion(row) !== undefined);
    const askedLine = askedLines()[0];
    if (askedLine === undefined || heldRow === undefined) {
      return {
        failures: [...failures, `[V3] the first row never held on its question (lines: ${askedLines().length}, status: ${lab.rows().find((row) => row.id === firstId)?.status})`],
        evidence: "",
      };
    }
    const owner = askedLine.worker;
    const question = openQuestion(heldRow)!;
    if (question.ask.kind !== "question") fail("V3", `the row holds on a ${question.ask.kind}, not its worker's question`);
    if (CONTROL !== "silent-park" && question.ask.prompt !== fixture.piece.asks) {
      fail("V3", `the row holds on ${JSON.stringify(question.ask.prompt)}, not the question its worker asked`);
    }
    if (!(await lab.settled())) fail("V3", `a request was still running with the row held; a question holds nothing open`);
    const askingRequest = (await lab.requests(askedLine.session)).find((request) => request.id === heldRow.run?.requestId);
    if (askingRequest?.status !== "completed") {
      fail("V3", `the turn that asked ended "${askingRequest?.status}", not completed: an ask is the turn's end, not a wait`);
    }
    const stillHeld = lab.rows().find((row) => row.id === firstId);
    if (openQuestion(stillHeld) === undefined) fail("V3", `with nothing running the first row is "${stillHeld?.status}", not held on its question`);

    // ---- V5 (the freeze). the held row's assignee cannot be moved -----------
    const otherDelegate = tree.delegates.find((id) => id !== first.assignee) ?? tree.delegates[0]!;
    const moved = await lab.onConversation("updateTask_tasks", { id: firstId, assignee: otherDelegate });
    const movedError = String(moved.output?.error ?? "");
    // A started task keeps one accountable worker (FIX-2081): the field table refuses the move.
    if (moved.output?.ok !== false || !movedError.startsWith("field_locked_after_start: assignee")) {
      fail("V5", `moving the held row to ${otherDelegate} was not refused as field_locked_after_start: ${JSON.stringify(moved.output)}`);
    }

    // ---- VB (1). the planner's Tasks tab: the row, as filed ---------------
    // A worker has no flow of its own: the navigator lists the one copy of the
    // flow it runs on, each worker's own session under it, and each task
    // session the planner's board opened under the copy of the flow it runs on.
    for (const flow of new Set([...workers, tree.plannerId].map((id) => tree.workerFlows[id]!))) await openCopy(page, flow);
    await page.locator(`[data-session-id="${lab.conversation}"]`).waitFor();
    const listed = await page.locator("[data-session-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-session-id")));
    for (const id of [...workers, tree.plannerId]) {
      if (!listed.includes(lab.seatSession(id))) {
        fail("VB", `the navigator lists no session of ${id} under the copy of "${tree.workerFlows[id]}" (listed: ${listed.join(", ")})`);
      }
    }
    await openSession(page, plannerFlow, lab.conversation);
    const screen1 = await taskRow(page, firstId, (cells) => cells.Assignee !== undefined);
    await page.screenshot({ path: join(SHOTS, "1-planner-tasks.png") });
    if (screen1 === undefined) {
      fail("VB", `screen 1: the planner's Tasks tab never showed row ${firstId}`);
    } else {
      if (screen1.cells.Goal !== fixture.piece.goal) fail("VB", `screen 1: the row's goal reads ${JSON.stringify(screen1.cells.Goal)}`);
      if (screen1.cells.Assignee !== first.assignee) fail("VB", `screen 1: the row's assignee reads ${JSON.stringify(screen1.cells.Assignee)}, the board holds "${first.assignee}"`);
    }

    // ---- VB (2a). the session the row names: the reason, nothing expanded --
    // The row names the task session it ran in (`run`); a reader opens that
    // session from the navigator, under the copy of the flow its worker runs on.
    const runSession = heldRow.run?.sessionId;
    let childSession: string | undefined;
    if (runSession !== askedLine.session) {
      fail("VB", `screen 2: the row names ${runSession} as its run, not ${askedLine.session}, where it ran`);
    } else {
      await openCopy(page, tree.workerFlows[owner]!);
      await openSession(page, tree.workerFlows[owner]!, runSession);
      childSession = await openBadgeSession(page);
      if (childSession !== askedLine.session) {
        fail("VB", `screen 2: the navigator opened ${childSession}, not ${askedLine.session}, where the row ran`);
      }
      const screen2 = await taskRow(page, firstId, (cells) => cells.Status === "in_progress");
      await page.screenshot({ path: join(SHOTS, "2a-task-session-held.png") });
      const expanded = await page.locator("main [data-task-id] button[aria-expanded='true']").count();
      if (expanded !== 0) fail("VB", `screen 2: ${expanded} row(s) open; the reason must be legible without opening one`);
      if (screen2 === undefined) {
        fail("VB", `screen 2: the task session never showed row ${firstId} running`);
      } else if (screen2.cells.Reason === undefined || screen2.cells.Reason.trim().length <= 1 || screen2.cells.Reason === "—") {
        // A question that says nothing ("?", the silent-park control) is no reason a reader can act on.
        fail("VB", `screen 2: the held row shows no reason — a reader cannot say what it waits for`);
      } else if (screen2.cells.Reason !== question.ask.prompt) {
        fail("VB", `screen 2: the reason reads ${JSON.stringify(screen2.cells.Reason)}, the row holds on ${JSON.stringify(question.ask.prompt)}`);
      } else if (screen2.reasonClipped) {
        if (screen2.reasonTitle !== question.ask.prompt) {
          fail("VB", `screen 2: the reason is clamped on screen and its title reads ${JSON.stringify(screen2.reasonTitle)}`);
        } else {
          notes.push("the reason is clamped to its slot on screen and whole on hover");
        }
      }
    }

    // ---- V4 (the fence). a second person's answer does not land ------------
    const beforeOther = JSON.stringify(lab.rows().find((row) => row.id === firstId));
    let otherPerson: ActResult | undefined;
    try {
      otherPerson = await lab.answer(
        firstId,
        fixture.answer,
        CONTROL === "second-principal" ? LAB_USER_ID : fixture.otherPrincipal,
        SECOND_PRINCIPAL_WINDOW_MS,
      );
    } catch (error) {
      fail("V4", `the second person's delivery never reached the server: ${error instanceof Error ? error.message : String(error)}`);
    }
    // The positive record first: the delivery reached the server, either as a
    // request on the planner's conversation or as an explicit refusal at the
    // door. Only then is its fate judged. An explicit 401/403 is a loud
    // refusal, so it counts. A 404 is judged by `judgeHiddenSession` once the
    // owner's own delivery to the same session has been sent. Anything else
    // that is not a 202 with a request id proves nothing about the fence.
    if (otherPerson !== undefined) {
      if (otherPerson.httpStatus === 401 || otherPerson.httpStatus === 403) {
        notes.push(`the second person's delivery was refused at the door (${otherPerson.httpStatus} ${otherPerson.refusal})`);
      } else if (otherPerson.httpStatus === 404) {
        // Judged below, with the owner's admission.
      } else if (otherPerson.httpStatus !== 202 || otherPerson.requestId === undefined) {
        fail("V4", `the second person's delivery came back ${otherPerson.httpStatus} ${otherPerson.refusal ?? "with no request id"} — neither an explicit refusal nor a request the fence was exercised on`);
      } else {
        notes.push(`the second person's delivery was admitted as ${otherPerson.requestId} and ended ${otherPerson.status}`);
      }
    }
    await lab.settled();
    const afterOther = JSON.stringify(lab.rows().find((row) => row.id === firstId));
    if (afterOther !== beforeOther) {
      fail("V4", `an answer sent as a second person moved the row: ${beforeOther} -> ${afterOther}`);
    }

    // ---- V3 (the answer). the person answers through the planner's conversation
    const answered = await lab.answer(firstId, fixture.answer);
    if (otherPerson?.httpStatus === 404) {
      const verdict = judgeHiddenSession(otherPerson, answered, lab.conversation);
      if ("fail" in verdict) fail("V4", verdict.fail);
      else notes.push(verdict.note);
    }
    if (answered.status !== "completed") fail("V3", `the answer request ended ${answered.status ?? answered.refusal}`);
    await lab.settled();
    const afterAnswer = lab.rows().find((row) => row.id === firstId);
    const finishedFirst = lab.workLines().filter((line) => line.taskId === firstId && line.event === "finished");
    if (afterAnswer?.status !== "completed") fail("V3", `after the answer the first row is "${afterAnswer?.status}", not completed`);
    const answerOnRow = (afterAnswer?.steers ?? []).find((steer) => steer.answers === question.id)?.message;
    if (answerOnRow !== fixture.answer) fail("V3", `after the answer the row's question is answered with ${JSON.stringify(answerOnRow)}, not the answer`);
    if (askedLines().length !== 1) fail("V3", `the first row asked ${askedLines().length} times; the answered turn must finish, not ask again`);
    if (afterAnswer !== undefined && heldRow.attempts !== afterAnswer.attempts) {
      fail("V3", `the answer moved the row from attempt ${heldRow.attempts} to ${afterAnswer.attempts}; an answer owes the same attempt one more turn`);
    }
    if (finishedFirst.length !== 1) {
      fail("V3", `the first row finished ${finishedFirst.length} times`);
    } else {
      const finished = finishedFirst[0]!;
      if (finished.worker !== owner) fail("V3", `the row asked on ${owner} and finished on ${finished.worker}`);
      if (finished.session !== askedLine.session) {
        fail("V3", `the row asked in ${askedLine.session} and finished in ${finished.session}; an answer carries on where the question was asked`);
      }
      if (finished.answer !== fixture.answer) fail("V3", `the finishing turn read ${JSON.stringify(finished.answer)} as its answer`);
    }
    // The answer reached the row through the planner's conversation's own
    // door, as the one person: the question was answered by an
    // `updateTask_tasks` request there, not by anything that happened by.
    const changesAfterAnswer = await lab.changes();
    const answeredByPerson = changesAfterAnswer.some(
      (change) =>
        change.taskId === firstId &&
        change.kind === "answered" &&
        change.sessionId === lab.conversation &&
        change.action === "updateTask_tasks" &&
        change.userId === LAB_USER_ID,
    );
    if (!answeredByPerson) fail("V3", `no updateTask_tasks request on ${lab.conversation} answered the row's question`);

    // ---- V3 (one ask, one answer). a second answer is declined --------------
    const beforeSecond = JSON.stringify(lab.rows().find((row) => row.id === firstId));
    const firstLines = () => lab.workLines().filter((line) => line.taskId === firstId).length;
    const linesBeforeSecond = firstLines();
    const second = await lab.answer(firstId, fixture.secondAnswer);
    // Completed is the positive record: the delivery ran and found the row.
    if (second.status !== "completed") fail("V3", `the second delivery ended ${second.status ?? second.refusal}, so it never reached the row`);
    // The answer door's own verdict, not just its silence: one question takes
    // one answer, so the second, naming the same question, must come back
    // declined as already answered. An accepted no-op would leave the row and
    // the work file exactly as a decline does, and only this catches it.
    if (second.output?.ok !== false || !String(second.output?.error ?? "").startsWith("question_answered")) {
      fail("V3", `the second delivery was not declined as already answered: ${JSON.stringify(second.output)}`);
    }
    await lab.settled();
    const afterSecond = JSON.stringify(lab.rows().find((row) => row.id === firstId));
    if (afterSecond !== beforeSecond) fail("V3", `a second delivery changed the answered row: ${afterSecond}`);
    if (firstLines() !== linesBeforeSecond) fail("V3", `a second delivery ran the row's work again`);

    // ---- VB (2b, 3). the answer in its place; both rows on the ledger ------
    const ledgerNow = lab.rows();
    const firstNow = ledgerNow.find((row) => row.id === firstId);
    if (childSession !== undefined) {
      // Re-selected through the navigator, the way a person comes back to it.
      await openSession(page, plannerFlow, lab.conversation);
      await openSession(page, tree.workerFlows[owner]!, childSession);
      const screen2b = await taskRow(page, firstId, (cells) => cells.Status === firstNow?.status);
      await page.screenshot({ path: join(SHOTS, "2b-task-session-answered.png") });
      if (screen2b === undefined) {
        fail("VB", `screen 2: after the answer the task session never showed the row as "${firstNow?.status}"`);
      } else if (firstNow?.status === "completed" && screen2b.cells.Reason !== undefined && screen2b.cells.Reason === question.ask.prompt) {
        // Graded on a finished row only: one that asked again is V3's failure,
        // and on screen it rightly reads the new question.
        fail("VB", `screen 2: after the answer the row still reads its question ${JSON.stringify(screen2b.cells.Reason)} as what it waits for`);
      }
    }
    // Screen 3: the ledger collection, on the Resources panel of the session
    // open now — any session whose flow declares the ledger will do.
    await screenThree(page, ledgerNow.filter((row) => row.partition === first.partition), lab.workLines());

    // ---- V1 (a row for nobody). it reaches the board and runs nowhere -------
    const orphanFiled = await lab.file({ goal: fixture.orphan, maxAttempts: 1 });
    const orphanId = typeof orphanFiled.output?.taskId === "string" ? (orphanFiled.output.taskId as string) : undefined;
    const orphan = orphanId === undefined ? undefined : await lab.waitForRow((row) => row.id === orphanId);
    if (orphan === undefined) {
      fail("V1", `the row for nobody never reached the board: ${JSON.stringify(orphanFiled.output)}`);
    } else {
      if (orphan.assignee !== undefined) fail("V1", `the row for nobody was filed for "${orphan.assignee}"`);
      await lab.settled();
      const settled = lab.rows().find((row) => row.id === orphan.id);
      if (settled?.status !== "pending" || settled.run !== undefined || settled.attempts !== 0) {
        fail("V1", `the row for nobody is "${settled?.status}" after ${settled?.attempts} attempt(s); with no assignee it must wait, handed to no worker`);
      }
      if (lab.workLines().some((line) => line.taskId === orphan.id)) fail("V1", `the row for nobody ran anyway`);
      if ((await lab.sessions()).some((session) => session.state?.taskId === orphan.id)) {
        fail("V1", `a task session was opened for the row for nobody`);
      }
    }

    // ---- V2. each row against the file of the worker that ran it -------------
    const rowsNow = lab.rows();
    const ran: WorkLine[] = lab.workLines();
    if (ran.length === 0) fail("V2", `no row ran at all`);
    for (const line of ran) {
      const row = rowsNow.find((candidate) => candidate.id === line.taskId);
      const oracle = tree.declaredDesks[line.worker];
      if (row?.input?.desk !== oracle) {
        fail("V2", `row ${line.taskId} is for desk "${row?.input?.desk}" and ran on ${line.worker}, whose own file answers for "${oracle}"`);
      }
      if (line.declaredDesk !== oracle) {
        fail("V2", `${line.worker} reported answering for "${line.declaredDesk}" from inside its run; its file says "${oracle}"`);
      }
    }

    // ---- V4 (the claims). every claim is the planner's board's ---------------
    const changes = await lab.changes();
    const claims = changes.filter((change) => change.kind === "claimed");
    for (const id of [...new Set(ran.map((line) => line.taskId))]) {
      if (!claims.some((claim) => claim.taskId === id)) fail("V4", `row ${id} ran with no claim on record`);
    }
    const boardsOwn = (change: ChangeRecord) =>
      change.sessionId === lab.conversation && change.action === BOARD_RUN_ACTION && change.userId === LAB_USER_ID;
    for (const claim of claims) {
      if (!boardsOwn(claim)) {
        fail("V4", `row ${claim.taskId} was claimed by a "${claim.action}" request in ${claim.sessionId} as ${claim.userId}, not by the planner's board run as the one person`);
      }
    }
    // Every attempt ran in the task session the planner's board opened for
    // that row and its assignee: a child of the planner's conversation, naming
    // the row and the worker, born for the conversation that filed it.
    const sessionsNow = await lab.sessions();
    for (const line of ran) {
      const row = rowsNow.find((candidate) => candidate.id === line.taskId);
      const session = sessionsNow.find((candidate) => candidate.id === line.session);
      if (session?.parentSessionId !== lab.conversation) {
        fail("V4", `row ${line.taskId} ran in ${line.session}, which is not a child of the planner's conversation (parent ${session?.parentSessionId})`);
      }
      if (session?.state?.taskId !== line.taskId || session?.state?.workerId !== row?.assignee || line.worker !== row?.assignee) {
        fail("V4", `row ${line.taskId} (for ${row?.assignee}) ran on ${line.worker} in a session naming task ${session?.state?.taskId} and worker ${session?.state?.workerId}`);
      }
      if (line.filingSession !== row?.partition) {
        fail("V4", `row ${line.taskId} ran in a session born for ${line.filingSession}, not the board it is on (${row?.partition})`);
      }
    }

    // ---- V5. the handoff ----------------------------------------------------
    const finishedFirstLine = ran.find((line) => line.taskId === firstId && line.event === "finished");
    if (finishedFirstLine === undefined) {
      notes.push("V5 not graded past the freeze: the first row never finished, which is V3's failure");
    } else {
      const secondRow = rowsNow.find((row) => row.id === secondId);
      const firstFinal = rowsNow.find((row) => row.id === firstId);
      if (secondRow === undefined) {
        fail("V5", `the follow-on row is not on the board`);
      } else {
        if (secondRow.input?.follows !== firstId || !(secondRow.deps ?? []).includes(firstId)) {
          fail("V5", `the follow-on row does not name and wait on the first (follows: ${secondRow.input?.follows}, deps: ${JSON.stringify(secondRow.deps)})`);
        }
        if (secondRow.assignee === first.assignee) fail("V5", `both rows are for "${secondRow.assignee}"; nothing changed hands`);
        const secondRan = ran.find((line) => line.taskId === secondId && line.event === "finished");
        if (secondRan === undefined) {
          fail("V5", `the follow-on row never ran`);
        } else {
          if (secondRan.worker === finishedFirstLine.worker) {
            fail("V5", `both rows ran on ${secondRan.worker}; one worker did the whole thing and nothing changed hands`);
          }
          if (secondRan.session === finishedFirstLine.session) fail("V5", `both rows ran in one session, ${secondRan.session}`);
          if (secondRow.status !== "completed") fail("V5", `the follow-on row is "${secondRow.status}"`);
          // It waited: the board took it only once the row it follows was done.
          if (secondRow.startedAt === undefined || firstFinal?.completedAt === undefined || secondRow.startedAt < firstFinal.completedAt) {
            fail("V5", `the follow-on row started at ${secondRow.startedAt}, before the row it follows completed at ${firstFinal?.completedAt}`);
          }
        }
      }
    }
    const firstFinalAssignee = rowsNow.find((row) => row.id === firstId)?.assignee;
    if (firstFinalAssignee !== first.assignee) fail("V5", `the first row's assignee moved to "${firstFinalAssignee}"`);
  } finally {
    await browser?.close().catch(() => {});
    served.stop();
  }

  // ---- the controls grade THEMSELVES --------------------------------------
  // A control certifies that THIS check fails when THIS thing breaks, so it
  // must go red at the legs it names and at no other.
  if (CONTROL !== "") {
    const expected = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((line) => /^\[(\w+)\]/.exec(line)?.[1]));
    const offLeg = failures.filter((line) => !expected.some((leg) => line.startsWith(`[${leg}]`)));
    const missing = expected.filter((leg) => !legs.has(leg));
    if (failures.length === 0) {
      failures.push(`the ${CONTROL} control did not go red at all; ${expected.join(" and ")} do not grade what they claim`);
    } else if (offLeg.length > 0 || missing.length > 0) {
      failures.push(
        `the ${CONTROL} control must redden ${expected.join(" and ")} and nothing else` +
          (missing.length > 0 ? `; never reddened: ${missing.join(", ")}` : "") +
          (offLeg.length > 0 ? `; reddened elsewhere: ${offLeg.join(" | ")}` : ""),
      );
    }
  }

  return {
    failures,
    evidence:
      `the shipped \`fsdev dev\` served a hire read from ${tree.roster.workers.length} WORKER.md files and no MAILBOX.md; ` +
      `no file declares a board. The planner filed one row for "${fixture.piece.desk}" and one for "${fixture.piece.then.desk}" waiting on it, ` +
      `on its own conversation's board; the worker whose own file answers for "${fixture.piece.desk}" held the first on its question ` +
      `and nothing stayed running; moving its assignee was refused; a second person's answer did not land; the person's answer through ` +
      `the planner's conversation did, and the same task session finished the row; a second answer was declined as already answered; the other ` +
      `worker then ran the follow-on row in its own task session; a row for nobody waited, handed to no one; every claim was the planner's ` +
      `board run's. In Chromium on the shipped bundle: the planner's Tasks tab showed the row as filed, the task session the row names, opened ` +
      `from the navigator, showed the question as its reason with nothing expanded and then the finished row, and the ledger collection showed both rows ` +
      `with their assignees and the task session each ran in. ` +
      (notes.length > 0 ? `Notes: ${notes.join("; ")}. ` : "") +
      `Screenshots: ${SHOTS}`,
  };
}

/**
 * Screen 3: the ledger collection on the Resources panel of the session open
 * now, each listed row opened and read against what the board holds.
 */
async function screenThree(page: Page, rows: readonly BoardRow[], workLines: readonly WorkLine[]): Promise<void> {
  const aside = page.locator("aside").last();
  await page.getByTitle("Refresh debug resources").click();
  await aside.getByRole("button", { name: /^\s*tasks\b/ }).first().click();
  for (const row of rows) {
    const topic = aside.getByRole("button", { name: new RegExp(`${row.id}$`) });
    try {
      await topic.first().waitFor({ timeout: 10_000 });
      await topic.first().click();
    } catch {
      fail("VB", `screen 3: the ledger collection does not list row ${row.id}`);
    }
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, "3-resources.png"), fullPage: true });
  // The body folds after 20 lines behind a "… (N more lines)" button. A person
  // reading the row clicks it, so the check does too before reading what the
  // row says. One row at a time, and re-clicked if the panel's refresh folds
  // it again before the read.
  for (const row of rows) {
    const box = aside.locator("div", { has: page.getByRole("button", { name: new RegExp(`${row.id}$`) }) }).last();
    let text = "";
    for (let tries = 0; tries < 5 && (await box.count()) > 0; tries += 1) {
      const more = box.getByRole("button", { name: /more lines/ });
      if ((await more.count()) > 0) await more.first().click();
      text = await box.innerText();
      if (!/more lines\)/.test(text)) break;
      await page.waitForTimeout(200);
    }
    // A listed row whose body shows nothing is a screen a person cannot read,
    // and must fail here — skipping it would pass screen 3 on no data at all.
    if (!text.includes(`"id": "${row.id}"`)) {
      fail("VB", `screen 3: row ${row.id} is listed but its expanded body shows none of it`);
      continue;
    }
    const shown = (field: string) => new RegExp(`"${field}":\\s*"([^"]*)"`).exec(text)?.[1];
    if (shown("status") !== row.status) fail("VB", `screen 3: row ${row.id} reads "${shown("status")}", the board holds "${row.status}"`);
    if (shown("assignee") !== row.assignee) fail("VB", `screen 3: row ${row.id}'s assignee reads "${shown("assignee")}", the board holds "${row.assignee}"`);
    const ranOn = workLines.find((line) => line.taskId === row.id && line.event === "finished");
    if (ranOn !== undefined && !text.includes(ranOn.session)) {
      fail("VB", `screen 3: row ${row.id} does not name the task session it ran in (${ranOn.session}, on ${ranOn.worker})`);
    }
  }
}

mkdirSync(SHOTS, { recursive: true });
void runGoal(async () => {
  const result = await main();
  // Notes travel with a failure too — a control's red state is read with them.
  if (result.failures.length > 0 && notes.length > 0) {
    return { ...result, failures: [...result.failures, ...notes.map((note) => `(note) ${note}`)] };
  }
  return result;
});

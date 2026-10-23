/**
 * Goal check, FIX-2087: Workforce coordination runs on one task primitive. The closure of epic
 * FIX-2056, run on one `main` commit with every other child merged. See goal.md.
 *
 * Parts (`GOAL_PARTS`, default all, in this order):
 *
 * - `walk`: legs a to c on the closure's Lab (`lab/`, the cast written by `cast.mts`) served by
 *   Shift Manager's command, on a real model. a is the concept's walk less the call and the
 *   Inbox, with the journeys j1 (a worker hands out work and waits on it) and j2 (Alice steers
 *   one routed task and cancels another) on the same Lab; b kills the server after researcher's
 *   ending is written and before it is sent; c has researcher fail out.
 * - `sweep`: the task-surface sweep (`engine.mjs`, the same engine CI runs), and its plants.
 * - `children`: every child goal and check with its controls (`children.mts`), the set of
 *   children read from Linear at run time when `LINEAR_API_KEY` is set.
 * - `gaps`: the 31 in-scope gaps rows, each mapped to the checks that read it (`gaps.mts`).
 *
 * D1: every assertion is tagged structural or judgment (`TAGS`). A structural FAIL on any
 * attempt ends that leg's attempts and is a finding; only a judgment FAIL earns another attempt
 * (`GOAL_ATTEMPTS`, default 3). Every attempt is printed.
 *
 * Controls (each runs only the leg it targets): `GOAL_CONTROL=no-sweeper-payment` (FIX-2078's,
 * reused from its goal) must FAIL `b:hears-in-due-time`; `GOAL_CONTROL=no-cascade` (FIX-2080's)
 * must FAIL `c:dependent-cancelled`.
 *
 * Run: pnpm tsx goals/workforce-coordination/runs-on-one-task/run.mts
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, RUN_STAMP, gatewayModel, goalAttempts, goalModel, goalTmpDir, keysServing, runGoal, type Tell } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, startShiftManager, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { loadShipped, type Shipped } from "../../workers/files-and-splits-down-the-chain/scripted.mts";
import { allTaskRows, items, requests, textOf, type StoredTask } from "../../coordinators/files-tasks-down-the-owners-chain/store.mts";
import { KILL_AFTER_ENDING, PATCHES as ENDING_CONTROLS } from "../../task-board/every-ending-reaches-its-filer/controls.mts";
import { PATCHES as FILING_CONTROLS } from "../../task-board/runs-by-its-filing-settings/controls.mts";
import { CAST, pickCast, writeCast, type Cast } from "./cast.mts";
import { journeyCoordinator, journeyHandsOut, planRows, walkA, walkFails, walkUntilKilled, type WalkA } from "./legs.mts";
import { runChildren } from "./children.mts";
import { printGaps } from "./gaps.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SCRATCH = goalTmpDir("one-task");
const MODEL = gatewayModel(goalModel());
/** The notice's due time after an ending (orchestration's `NOTICE_DUE_MS`). */
const NOTICE_DUE_MS = 2_000;
const say = (s: string) => console.error(`[one-task ${new Date().toISOString().slice(11, 19)}] ${s}`);
const show = (value: unknown, n = 400) => JSON.stringify(value)?.slice(0, n);

/** The task-surface sweep, the engine CI runs, as one JSON result. */
interface Swept {
  findings: Array<{ rule: string; where: string; what: string }>;
  tools: string[];
  scanned: Record<string, number>;
  rows: Array<{ row: string; by: string }>;
  allowed: string[];
}
const sweepJson = (): Swept => JSON.parse(spawnSync(process.execPath, [join(HERE, "sweep.mjs"), "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout) as Swept;
let swept: Swept | undefined;
const allowedTools = () => new Set((swept ??= sweepJson()).allowed);

// ---- D1: every assertion's kind ---------------------------------------------------------------

type Kind = "structural" | "judgment";
/** Each assertion and its kind. A structural FAIL is a finding on any attempt; a judgment FAIL may be retried. */
export const TAGS: Record<string, Kind> = {
  "a:routed-listed": "structural",
  "a:files-research": "judgment",
  "a:ends-running": "structural",
  "a:one-settled": "structural",
  "a:step-dispatched": "judgment",
  "a:drain-waits": "structural",
  "a:answers-after-steps": "structural",
  "a:lands-once": "structural",
  "a:draft-content": "judgment",
  "a:follow-up": "structural",
  "a:original-unchanged": "structural",
  "a:once": "structural",
  "j1:files": "judgment",
  "j1:waits-in-request": "structural",
  "j1:answer": "judgment",
  "j1:tools": "structural",
  "j1:read-once": "structural",
  "j1:once": "structural",
  "j2:steered": "structural",
  "j2:steer-shows": "judgment",
  "j2:cancelled": "structural",
  "j2:cancel-heard-once": "structural",
  "b:killed": "structural",
  "b:hears-in-due-time": "structural",
  "b:once": "structural",
  "c:files-dependent": "judgment",
  "c:fails-out": "structural",
  "c:dependent-cancelled": "structural",
  "c:one-failure-notice": "structural",
  "c:once": "structural",
};
const tagOf = (failure: string) => failure.split(" — ")[0]!;
const kindOf = (failure: string): Kind => TAGS[tagOf(failure)] ?? "structural";

// ---- controls ---------------------------------------------------------------------------------

interface Control {
  leg: "b" | "c";
  mustFail: string;
  patches: ModulePatch[];
}
const CONTROLS: Record<string, Control> = {
  "no-sweeper-payment": { leg: "b", mustFail: "b:hears-in-due-time", patches: ENDING_CONTROLS["no-sweeper-payment"]! },
  "no-cascade": { leg: "c", mustFail: "c:dependent-cancelled", patches: FILING_CONTROLS["no-cascade"]! },
};
const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && CONTROLS[controlName] === undefined) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = controlName === "" ? undefined : CONTROLS[controlName];
const parts = new Set((process.env.GOAL_PARTS ?? (control !== undefined ? "walk" : "walk,sweep,children,gaps")).split(",").map((s) => s.trim()));
const walkLegs = new Set((process.env.GOAL_LEGS ?? (control !== undefined ? control.leg : "a,b,c")).split(",").map((s) => s.trim()));

// ---- the Lab ----------------------------------------------------------------------------------

let pages: string | undefined;
/** Serve the closure's Lab over `store` and `tree`, with `patches` applied as it loads. */
async function serve(label: string, store: string, tree: string, patches: ModulePatch[] = [], env: Record<string, string> = {}): Promise<{ served: ServedShiftManager; mark: string }> {
  pages ??= await buildShiftManagerPages(join(SCRATCH, "pages"));
  const mark = join(SCRATCH, `patch-mark-${label}-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  const served = await startShiftManager({
    scratch: SCRATCH,
    label,
    config: join(HERE, "lab", "fsdev.config.mts"),
    pages,
    env: {
      GOAL_STORE: store,
      GOAL_TREE: tree,
      GOAL_REAL_MODEL: MODEL,
      GOAL_TOOLS_LOG: `${store}.tools.ndjson`,
      ...(patches.length > 0 ? modulePatchEnv(patches, REPO_ROOT, mark) : {}),
      ...env,
    },
    timeoutMs: 180_000,
  });
  return { served, mark };
}

// ---- store reads ------------------------------------------------------------------------------

const lines = (store: string, sessionId: string) => items(store, sessionId, "message").filter((m) => m.role === "assistant");
const linesBy = (store: string, sessionId: string, agent: string) => lines(store, sessionId).filter((m) => m.agentName === agent);
const filedBy = (store: string, taskId: string) => allTaskRows(store).filter((r) => (r as { filedByTask?: string }).filedByTask === taskId);
const settledRequests = (store: string, sessionId: string | undefined) => requests(store).filter((r) => r.sessionId === sessionId && r.actionName === "onTaskSettled");
const outputText = (output: unknown) => (typeof output === "string" ? output : JSON.stringify(output ?? ""));
const taskOf = (acted: { output?: any } | undefined) => acted?.output?.task ?? acted?.output;

// ---- grading ----------------------------------------------------------------------------------

function gradeA(store: string, w: WalkA, cast: Cast, tell: Tell): string[] {
  const f: string[] = [];
  const R = w.routed;
  const listed = (w.listedAtOnce.output?.tasks ?? []) as Array<{ id: string; assignee?: string }>;
  if (!listed.some((t) => t.id.startsWith(`routed:${w.turn.requestId}:`) && t.assignee === CAST.writer)) {
    f.push(`a:routed-listed — Alice's listTasks_tasks right after her message holds no routed task for desk.writer: ${show(w.listedAtOnce.output)}`);
  }
  if (R === undefined) return [...f, `a:ends-running — no routed task for desk.writer was filed`];
  const writerSession = R.run?.sessionId;
  const research = tell.over("a · research rows writer filed", filedBy(store, R.id).filter((r) => r.assignee === CAST.researcher));
  if (research.length === 0) f.push(`a:files-research — writer filed nothing for desk.researcher`);
  const work = requests(store).find((r) => r.sessionId === writerSession && r.actionName === "work");
  const lastEnd = Math.max(...research.map((r) => r.completedAt ?? r.updatedAt ?? Infinity));
  // Its first request ends with the research it filed open, and the task stays running past
  // both: nothing settles it until a request after the research's ending.
  if (research.length > 0 && !(work !== undefined && work.status === "completed" && (R.completedAt ?? Infinity) > Math.max(work.updatedAt, lastEnd))) {
    f.push(`a:ends-running — wanted writer's task to stay running past its first request and its research: work ${show(work)}, research ended ${lastEnd}, task ${R.status} at ${R.completedAt}`);
  }
  const settled = settledRequests(store, writerSession);
  if (research.length > 0 && settled.length !== research.length) {
    f.push(`a:one-settled — ${settled.length} onTaskSettled request(s) in writer's task session for ${research.length} research ending(s)`);
  }
  const steps = planRows(store).filter((r) => r.partition.startsWith(`${writerSession}~`) && (r as { session?: string }).session === "new");
  const step = steps[0];
  if (step === undefined) f.push(`a:step-dispatched — writer filed no step for itself in a session of its own`);
  else {
    if (step.status !== "completed" || step.run?.sessionId === writerSession) f.push(`a:step-dispatched — the fact-check step ${step.status}, run in ${step.run?.sessionId}`);
    if (!((R.completedAt ?? 0) >= (step.completedAt ?? Infinity))) f.push(`a:drain-waits — writer's task ended at ${R.completedAt}, before its dispatched step at ${step.completedAt}`);
    const answeredAfter = items(store, writerSession ?? "", "message").filter((m) => m.role === "assistant" && m.agentName === "agent-answer" && Number(m.ts ?? 0) > (step.completedAt ?? Infinity));
    if (answeredAfter.length === 0) {
      f.push(`a:answers-after-steps — writer was given no turn after its dispatched step ended; its task completed with its earlier answer ${show(R.output, 120)}`);
    }
  }
  const draftLines = linesBy(store, w.conv, CAST.writer).filter((m) => textOf(m) === outputText(R.output));
  if (R.status !== "completed" || draftLines.length !== 1) f.push(`a:lands-once — writer's task ${R.status}; ${draftLines.length} line(s) of its result in Alice's conversation`);
  const draft = outputText(R.output);
  if (!draft.includes(cast.word) || !draft.includes(cast.factMark)) f.push(`a:draft-content — the draft lacks ${!draft.includes(cast.word) ? `the word "${cast.word}"` : ""} ${!draft.includes(cast.factMark) ? `researcher's fact (${cast.factMark})` : ""}: ${show(draft, 200)}`);
  // The follow-up, from the finished task: a new version, and the original untouched.
  const fu = w.followUpRow;
  if (w.followUp === undefined) f.push(`a:follow-up — not filed: writer's task never completed`);
  else if (fu === undefined || fu.status !== "completed" || (fu as { followUpOf?: string }).followUpOf !== R.id || !fu.partition.startsWith(w.conv) || fu.run?.sessionId !== writerSession || outputText(fu.output) === draft) {
    f.push(`a:follow-up — wanted a completed follow-up of ${R.id}, filed from Alice's conversation, run in writer's task session, with a new version: ${show(w.followUp.output)} ${show({ ...fu, output: outputText(fu?.output).slice(0, 80) })}`);
  }
  if (w.before !== undefined && JSON.stringify(taskOf(w.before)?.output) !== JSON.stringify(taskOf(w.after)?.output)) {
    f.push(`a:original-unchanged — the original's output changed: ${show(taskOf(w.before)?.output, 120)} then ${show(taskOf(w.after)?.output, 120)}`);
  }
  // Every ending reaches its filer once.
  for (const r of research) {
    const heard = lines(store, writerSession ?? "").filter((m) => textOf(m).includes(`(${r.id})`));
    if (heard.length !== 1) f.push(`a:once — researcher's ending of ${r.id} reached writer ${heard.length} time(s)`);
  }
  if (fu?.status === "completed" && linesBy(store, w.conv, CAST.writer).filter((m) => textOf(m) === outputText(fu.output)).length !== 1) f.push(`a:once — the follow-up's result did not land once in Alice's conversation`);
  return f;
}

function gradeJ1(store: string, j: Awaited<ReturnType<typeof journeyHandsOut>>, cast: Cast, tell: Tell): string[] {
  const f: string[] = [];
  const E = j.routed;
  if (E === undefined) return [`j1:files — no routed task for desk.editor`];
  const editorSession = E.run?.sessionId;
  const research = filedBy(store, E.id).filter((r) => r.assignee === CAST.researcher);
  if (research.length === 0) f.push(`j1:files — editor filed nothing for desk.researcher`);
  const works = requests(store).filter((r) => r.sessionId === editorSession && r.actionName === "work");
  // The work request read the research's ending with getTask, in the same request.
  const read = items(store, editorSession ?? "", "tool_output").filter(
    (i) => i.toolCall?.name === "getTask" && works.some((w) => w.id === i.requestId) && JSON.stringify(i.output ?? "").includes('"status":"completed"'),
  );
  if (research.length > 0 && (E.status !== "completed" || works.length !== 1 || read.length === 0)) {
    f.push(`j1:waits-in-request — wanted editor's one work request to read the research's ending with getTask: task ${E.status}, ${works.length} work request(s), ${read.length} completed getTask read(s)`);
  }
  // That ending reaches editor once: read in the request, so no notice turn runs for it.
  const notices = settledRequests(store, editorSession);
  if (research.length > 0 && read.length > 0 && notices.length > 0) {
    const ended = research[0]!.completedAt ?? 0;
    const asked = Math.min(...read.map((i) => Number(i.ts ?? Infinity)));
    f.push(`j1:read-once — researcher's ending reached editor twice: its work request read it with getTask (${asked - ended} ms after the ending) and ${notices.length} onTaskSettled turn(s) ran for it too`);
  }
  if (!outputText(E.output).includes(cast.factMark)) f.push(`j1:answer — editor's answer lacks researcher's fact: ${show(E.output, 160)}`);
  const offered = tell.over(
    "j1 · tool lists the engine handed a task turn",
    readNdjson<{ who: string; tools: string[] }>(`${store}.tools.ndjson`).filter((c) => c.who === CAST.editor || c.who === CAST.writer),
  );
  const taskish = new Set(offered.flatMap((c) => c.tools).filter((n) => /Tasks?$|_tasks$|^(reportProgress|parkOnQuestion)$/.test(n)));
  const allowed = allowedTools();
  const beyond = [...taskish].filter((n) => !allowed.has(n));
  if (beyond.length > 0) f.push(`j1:tools — a task turn was offered ${beyond.join(", ")}, beyond the allow list`);
  if (linesBy(store, j.conv, CAST.editor).filter((m) => textOf(m) === outputText(E.output)).length !== 1) f.push(`j1:once — editor's answer did not land once in Alice's conversation with chief`);
  return f;
}

function gradeJ2(store: string, j: Awaited<ReturnType<typeof journeyCoordinator>>, cast: Cast): string[] {
  const f: string[] = [];
  if (j.steer === undefined || j.steer.output?.ok !== true) f.push(`j2:steered — Alice's steer of an open task was not taken: ${show(j.steer)}`);
  if (!outputText(j.steered?.output).includes(cast.steerWord)) f.push(`j2:steer-shows — the steered draft lacks "${cast.steerWord}": ${show(j.steered?.output, 200)}`);
  if (j.cancel === undefined || j.cancel.output?.ok !== true || j.cancelledRow?.status !== "cancelled") f.push(`j2:cancelled — Alice's cancel: ${show(j.cancel?.output)}, the row ${j.cancelledRow?.status}`);
  // The coordinator hears the cancel once (its round closes on it); a routed task's cancel lands no line (coordinators.md).
  const heard = settledRequests(store, j.cancelConv);
  const said = linesBy(store, j.cancelConv, CAST.writer);
  if (j.cancelledRow?.status === "cancelled" && (heard.length !== 1 || said.length !== 0)) f.push(`j2:cancel-heard-once — ${heard.length} onTaskSettled in launch's conversation for the cancel, ${said.length} line(s) from writer: ${show(said.map(textOf))}`);
  return f;
}

function readNdjson<T>(file: string): T[] {
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T) : [];
}

// ---- the walk ---------------------------------------------------------------------------------

/** One leg's attempts under D1: retried only while every failure is a judgment miss. */
async function attempts(leg: string, once: (attempt: number) => Promise<string[]>, report: string[], failures: string[]): Promise<void> {
  const max = control === undefined ? goalAttempts() : 1;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    let got: string[];
    try {
      got = await once(attempt);
    } catch (error) {
      got = [`${leg}:setup — ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1200) : String(error)}`];
    }
    const structural = got.filter((g) => kindOf(g) === "structural");
    report.push(`${leg} attempt ${attempt}/${max}: ${got.length === 0 ? "PASS" : `FAIL ${[...new Set(got.map((g) => `${tagOf(g)} (${kindOf(g)})`))].join(", ")}`}`);
    for (const g of got) report.push(`  ${g}`);
    if (got.length === 0) return;
    if (structural.length > 0 || attempt === max) {
      failures.push(...got);
      return;
    }
  }
}

async function walk(failures: string[], tell: Tell, report: string[]): Promise<void> {
  const keys = keysServing(MODEL);
  if (!keys.some((k) => (process.env[k] ?? "") !== "")) {
    failures.push(`walk:blocked — no key here serves ${MODEL}; set one of ${keys.join(", ")}`);
    return;
  }
  const shipped: Shipped = await loadShipped(REPO_ROOT);
  report.push(`model ${MODEL}`);

  if (walkLegs.has("a")) {
    await attempts("a", async (attempt) => {
      const cast = pickCast();
      const store = join(SCRATCH, `a-${attempt}-${RUN_STAMP}.sqlite`);
      const tree = writeCast(join(SCRATCH, `tree-a-${attempt}-${RUN_STAMP}`), cast);
      report.push(`a attempt ${attempt}: ${cast.topic}, word "${cast.word}", fact "${cast.fact}", steer "${cast.steerWord}", store ${store}`);
      const { served } = await serve(`a-${attempt}`, store, tree);
      try {
        const w = await walkA({ origin: served.origin, store, shipped, cast, say });
        const j1 = await journeyHandsOut({ origin: served.origin, store, shipped, cast, say });
        const j2 = await journeyCoordinator({ origin: served.origin, store, shipped, cast, say });
        return [...gradeA(store, w, cast, tell), ...gradeJ1(store, j1, cast, tell), ...gradeJ2(store, j2, cast)];
      } finally {
        await served.stop();
      }
    }, report, failures);
  }

  if (walkLegs.has("b")) {
    await attempts("b", async (attempt) => {
      const cast = pickCast();
      const store = join(SCRATCH, `b-${attempt}-${RUN_STAMP}.sqlite`);
      const tree = writeCast(join(SCRATCH, `tree-b-${attempt}-${RUN_STAMP}`), cast);
      const f: string[] = [];
      const first = await serve(`b-${attempt}-killed`, store, tree, [KILL_AFTER_ENDING], { GOAL_KILL: "after-ending" });
      const k = await walkUntilKilled({ origin: first.served.origin, store, shipped, cast, exited: first.served.exited, say });
      if (!k.died) {
        await first.served.stop();
        return [`b:killed — the server never died after an ending: nothing reached the delivery's send`];
      }
      assertPatched([KILL_AFTER_ENDING], REPO_ROOT, first.mark);
      const R = allTaskRows(store).find((r) => r.id.startsWith(`routed:${k.turn.requestId}:`));
      const research = R === undefined ? [] : filedBy(store, R.id).filter((r) => r.assignee === CAST.researcher);
      const ended = research.find((r) => r.status === "completed");
      if (R === undefined || ended === undefined || !Object.keys(ended.metadata ?? {}).some((m) => m.startsWith("noticeOwed:"))) {
        return [`b:killed — wanted researcher's ending written with its notice owed when the server died: ${show({ R: R?.status, research: research.map((r) => [r.status, Object.keys(r.metadata ?? {})]) })}`];
      }
      const writerSession = R.run?.sessionId;
      const before = settledRequests(store, writerSession).length;
      const patches = control?.leg === "b" ? control.patches : [];
      const second = await serve(`b-${attempt}-restarted`, store, tree, patches);
      const back = Date.now();
      try {
        // No action on any board: only a wake can pay what is owed.
        await new Promise((r) => setTimeout(r, NOTICE_DUE_MS + 10_000));
        if (patches.length > 0) assertPatched(patches, REPO_ROOT, second.mark);
        const heard = settledRequests(store, writerSession);
        const due = Math.max(back, (ended.completedAt ?? back) + NOTICE_DUE_MS);
        const at = heard[0]?.createdAt;
        if (heard.length === 0 || at === undefined || at - due > 2_000) f.push(`b:hears-in-due-time — ${heard.length} onTaskSettled in writer's session after the restart; the first ${at === undefined ? "never" : `${at - due} ms past its due time`}`);
        if (heard.length + before !== 1) f.push(`b:once — writer heard researcher's ending ${heard.length + before} time(s) (${before} before the kill)`);
        report.push(`b attempt ${attempt}: killed with ${ended.id} ended and its notice owed; restarted ${back - k.killedAt} ms later; due ${due - back} ms after the restart; heard ${at === undefined ? "never" : `${at - due} ms past due`}`);
      } finally {
        await second.served.stop();
      }
      return f;
    }, report, failures);
  }

  if (walkLegs.has("c")) {
    await attempts("c", async (attempt) => {
      const cast = pickCast();
      const store = join(SCRATCH, `c-${attempt}-${RUN_STAMP}.sqlite`);
      const tree = writeCast(join(SCRATCH, `tree-c-${attempt}-${RUN_STAMP}`), cast, "fails");
      const patches = control?.leg === "c" ? control.patches : [];
      const { served, mark } = await serve(`c-${attempt}`, store, tree, patches);
      const f: string[] = [];
      try {
        const c = await walkFails({ origin: served.origin, store, shipped, cast, say });
        if (patches.length > 0) assertPatched(patches, REPO_ROOT, mark);
        const R = c.routed;
        if (R === undefined) return [`c:files-dependent — no routed task for desk.writer`];
        const research = filedBy(store, R.id).filter((r) => r.assignee === CAST.researcher);
        const dependent = research.find((r) => ((r as { deps?: string[] }).deps ?? []).length > 0);
        const first = research.find((r) => r !== dependent && ((dependent as { deps?: string[] } | undefined)?.deps ?? []).includes(r.id));
        if (dependent === undefined || first === undefined) return [`c:files-dependent — wanted a research task and one depending on it: ${show(research.map((r) => [r.id, (r as any).deps]))}`];
        if (first.status !== "errored") f.push(`c:fails-out — the research task ended ${first.status}`);
        if (dependent.status !== "cancelled") f.push(`c:dependent-cancelled — the dependent ended ${dependent.status}`);
        const writerSession = R.run?.sessionId ?? "";
        const notices = lines(store, writerSession).filter((m) => textOf(m).includes(`(${first.id})`));
        const depNotices = lines(store, writerSession).filter((m) => textOf(m).includes(`(${dependent.id})`) && !textOf(m).includes(`(${first.id})`));
        if (notices.length !== 1 || !(textOf(notices[0]!).includes(dependent.id) || textOf(notices[0]!).includes(dependent.goal.slice(0, 30))) || depNotices.length !== 0) {
          f.push(`c:one-failure-notice — ${notices.length} notice(s) of the failure, naming the dependent: ${notices[0] === undefined ? "-" : textOf(notices[0]).includes(dependent.id)}; ${depNotices.length} of the dependent: ${show(notices.map(textOf), 300)}`);
        }
        if (["completed", "errored", "cancelled"].includes(R.status) && linesBy(store, c.conv, CAST.writer).length !== 1) f.push(`c:once — writer's task ${R.status}; ${linesBy(store, c.conv, CAST.writer).length} line(s) in Alice's conversation`);
        report.push(`c attempt ${attempt}: research ${first.status}, dependent ${dependent.status}, writer's task ${R.status}; notice ${show(notices.map(textOf), 240)}`);
      } finally {
        await served.stop();
      }
      return f;
    }, report, failures);
  }
}

// ---- the plan ---------------------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const report: string[] = [];
  const head = spawnSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  report.push(`commit ${head}${control === undefined ? "" : `, control ${controlName}:\n${describePatches(control.patches, REPO_ROOT)}`}`);
  if (parts.has("walk")) await walk(failures, tell, report);
  if (parts.has("sweep")) {
    const plain = (swept ??= sweepJson());
    tell.over("sweep · task tools the capability declares", plain.tools);
    for (const finding of plain.findings) failures.push(`sweep:${finding.rule} — ${finding.where} ${finding.what}`);
    report.push(`sweep: ${plain.tools.length} tools, ${plain.scanned.endings} ending writes, ${plain.rows.length} migration rows; ${plain.findings.length} live lines`);
    const ctl = spawnSync(process.execPath, [join(HERE, "sweep.mjs"), "--control"], { encoding: "utf8" });
    if (ctl.status !== 0) failures.push(`sweep:control — the plants were not reported exactly:\n${ctl.stdout.slice(-1500)}`);
    report.push(`sweep --control: ${/CONTROL (OK|BROKEN).*/.exec(ctl.stdout)?.[0] ?? "no verdict"}`);
  }
  if (parts.has("children")) await runChildren(failures, report, say);
  if (parts.has("gaps")) printGaps(report, failures);
  if (control !== undefined) {
    const red = failures.filter((x) => tagOf(x) === control.mustFail);
    report.push(red.length > 0 ? `control ${controlName}: ${control.mustFail} FAILed, as it must` : `control ${controlName}: ${control.mustFail} stayed green: the control is broken`);
  }
  for (const line of report) console.error(line);
  return { failures, evidence: `the closure's plan on ${head.slice(0, 9)}: ${[...parts].join(", ")}` };
});

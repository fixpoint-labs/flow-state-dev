/**
 * Goal check for FIX-2288. See goal.md.
 *
 * Run:      pnpm tsx goals/shift-manager/a-task-shows-its-model-and-tokens/run.mts
 * Controls: GOAL_CONTROL=end-only | zero-unreported | last-attempt-only | config-model | from-traces | add-result | by-session
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, goalTmpDir, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv } from "../../lib/module-patch.mts";
import { buildShiftManagerPages, labRoutes, startShiftManager, type LabRoutes, type LabUser, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { LAB_CROWD, LAB_USERS, PROJECTS_FLOW } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { SPEND_TICK_MS } from "../../../packages/orchestration/src/task-board/task-request.ts";
import { CONTROL_NAMES, CONTROLS, sdkSeam, type Control } from "./controls.mts";

const SCRATCH = goalTmpDir("task-spend");
const say = (s: string) => console.error(`[task-spend ${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Long enough for the run's next spend tick to land after the pause it reached. */
const PAST_A_TICK_MS = SPEND_TICK_MS + 1_500;

const controlName = process.env.GOAL_CONTROL ?? "";
if (controlName !== "" && !(CONTROL_NAMES as readonly string[]).includes(controlName)) {
  console.error(`unknown GOAL_CONTROL "${controlName}"; known: ${CONTROL_NAMES.join(", ")}`);
  process.exit(2);
}
const control: Control | undefined = controlName === "" ? undefined : CONTROLS[controlName as keyof typeof CONTROLS];

/** One user per leg, so each leg's worker usage is only its own. */
const USERS = {
  a: { label: "a", ...LAB_CROWD[0]! },
  b: { label: "b", ...LAB_CROWD[1]! },
  codex: { label: "c-codex", ...LAB_CROWD[2]! },
  cursor: { label: "c-cursor", ...LAB_CROWD[3]! },
  d: { label: "d", ...LAB_CROWD[4]! },
  g: { label: "g", ...LAB_CROWD[5]! },
} satisfies Record<string, LabUser & { label: string }>;

/** A task's spend, as a `listTasks` row carries it. */
type Spend = { harness: string | null; model: string | null; inputTokens: number | null; outputTokens: number | null; unreported: boolean; live: boolean } | null;
type TaskRow = { id: string; goal: string; status: string; attempts: number; spend?: Spend };
type UsageRow = { worker: string; tokens: { input: number; output: number } };

const step = (input: number, output: number) => ({ input, output });
const whole = (input: number, output: number) => ({ "claude-sonnet-4-5": { inputTokens: input, outputTokens: output, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });
const show = (spend: Spend | undefined) => JSON.stringify(spend);

await runGoal(async () => {
  const started = Date.now();
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  const scriptedSdk = pathToFileURL(fileURLToPath(new URL("./lab/scripted-sdk.mjs", import.meta.url))).href;
  const patches = [sdkSeam(scriptedSdk), ...(control?.patches ?? [])];
  const patchEnv = modulePatchEnv(patches, REPO_ROOT, mark);
  if (control !== undefined) say(`control ${control.name}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  const setupFile = join(SCRATCH, "setup.json");
  const runLog = join(SCRATCH, "runs.log");
  const releases = join(SCRATCH, "releases");
  mkdirSync(releases, { recursive: true });
  writeFileSync(runLog, "");
  const runs: Record<string, unknown[]> = {};
  const codex: Record<string, unknown> = {};
  const cursor: Record<string, unknown> = {};
  const writeSetup = () => writeFileSync(setupFile, JSON.stringify({ log: runLog, releases, runs, codex, cursor }));
  writeSetup();
  const logLines = () => readFileSync(runLog, "utf8").split("\n");
  const ranTimes = (tag: string) => logLines().filter((l) => l.startsWith(`RUN ${tag} `)).length;
  /** Wait until scripted run `run` reaches pause `n`. */
  const paused = async (run: string, n: number, timeoutMs = 180_000) => {
    for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(100)) {
      if (logLines().includes(`PAUSED ${run} ${n}`)) return;
    }
    throw new Error(`run ${run} never reached pause ${n}`);
  };
  const release = (run: string, n: number) => writeFileSync(join(releases, `${run}-${n}`), "");

  say("building Shift Manager's pages");
  const pages = await buildShiftManagerPages(join(SCRATCH, "pages"));
  const failures: string[] = [];
  const notes: string[] = [];

  /** Start a Lab over a store of its own, standing as `how` says. */
  const start = async (label: string, how: { production?: boolean; harness?: "claude-code" | "codex" | "cursor" }) => {
    const storeDir = join(SCRATCH, "store", label);
    mkdirSync(storeDir, { recursive: true });
    const served = await startShiftManager({
      scratch: SCRATCH,
      label,
      config: fileURLToPath(new URL("./lab/fsdev.config.mts", import.meta.url)),
      pages,
      env: {
        TASK_SPEND_GOAL_STORE: join(storeDir, "lab.sqlite"),
        TASK_SPEND_GOAL_SETUP: setupFile,
        TASK_SPEND_GOAL_HARNESS: how.harness ?? "claude-code",
        ...(how.production === true ? { TASK_SPEND_GOAL_PRODUCTION: "1" } : {}),
        ...patchEnv,
      },
      timeoutMs: 180_000,
    });
    const stood = /\[task-spend-goal\] (.*)/.exec(served.log())?.[1] ?? "(no line)";
    say(`${label}: Lab at ${served.origin}; ${stood}`);
    return { served, stood };
  };
  const stop = async (label: string, served: ServedShiftManager) => {
    await served.stop();
    writeFileSync(join(SCRATCH, `${label}.log`), served.log());
  };

  /** The `workerUsage` query, as `user`: the worker's tokens. */
  const usageOf = async (served: ServedShiftManager, user: LabUser, worker: (row: UsageRow) => boolean) => {
    const done = await labRoutes(served.origin, user).act(PROJECTS_FLOW, `${PROJECTS_FLOW}-own-${user.userId}`, "workerUsage", {});
    if (done.status !== "completed") throw new Error(`workerUsage as ${user.userId} ended ${done.status}: ${done.error ?? ""}`);
    return (done.output as { workers: UsageRow[] }).workers.find(worker)?.tokens ?? { input: 0, output: 0 };
  };

  /** A conversation that files tasks, as `user`: a Shift Coordinator's, or the general lead's. */
  const conversation = async (served: ServedShiftManager, user: LabUser & { label: string }, kind: "coordinator" | "agent", workerId: string) => {
    const routes = labRoutes(served.origin, user);
    const sessionId = `s-${kind}-${user.label}-${RUN_STAMP}`;
    const created = await routes.call("POST", `/${kind}/sessions`, { userId: user.userId, sessionId, state: { workerId } });
    if (created.status !== 201) throw new Error(`${user.label}: opening ${workerId}'s session answered ${created.status} ${JSON.stringify(created.body)}`);
    const say = async (message: string) => {
      const said = await routes.act(kind, sessionId, "respond", { message });
      if (said.status !== "completed") throw new Error(`${user.label}: ${workerId}'s turn ended ${said.status}: ${said.error ?? ""}`);
    };
    /** The rows, as the filer's client reads them: the board's `listTasks` action. */
    const rows = async (): Promise<TaskRow[]> => {
      const listed = await routes.act(kind, sessionId, LIST_TASKS_ACTION, {});
      const out = listed.output as { ok?: boolean; tasks?: TaskRow[]; error?: string } | undefined;
      if (out?.ok !== true) throw new Error(`${user.label}: listTasks answered ${listed.status} ${JSON.stringify(out ?? listed.error)}`);
      return out.tasks ?? [];
    };
    const rowOf = async (tag: string) => {
      for (const until = Date.now() + 60_000; Date.now() < until; await sleep(250)) {
        const row = (await rows()).find((r) => r.goal.includes(`:${tag}]]`));
        if (row !== undefined) return row;
      }
      throw new Error(`${user.label}: no task tagged ${tag} was filed`);
    };
    const ended = async (tag: string, timeoutMs = 180_000) => {
      let row: TaskRow | undefined;
      for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(300)) {
        row = await rowOf(tag);
        if (["completed", "errored", "cancelled"].includes(row.status) && row.spend?.live !== true) return row;
      }
      throw new Error(`${user.label}: the task tagged ${tag} never ended: ${row?.status} ${show(row?.spend)}`);
    };
    const act = (action: string, input: unknown) => routes.act(kind, sessionId, action, input);
    return { routes, sessionId, say, rows, rowOf, ended, act };
  };

  const tokens = (spend: Spend | undefined) => [spend?.inputTokens ?? null, spend?.outputTokens ?? null];
  /** f: the task's final tokens equal what worker usage added for its worker over the leg. */
  const equalsUsage = (leg: string, spend: Spend | undefined, usage: { input: number; output: number }) => {
    if (spend?.inputTokens !== usage.input || spend?.outputTokens !== usage.output) {
      failures.push(`f:equal — leg ${leg}: the task reads ${show(spend)}, its worker's usage added ${JSON.stringify(usage)}`);
    }
    notes.push(`f: ${leg} task ${JSON.stringify(tokens(spend))}, worker usage ${JSON.stringify(usage)}`);
  };

  /** Leg a: the researcher's task, filed by the general lead, two model calls of 4 + 4. */
  const legA = async (served: ServedShiftManager, user: typeof USERS.a, tag: string) => {
    const lead = await conversation(served, user, "agent", "general-lead");
    await lead.say(`Please look into it. [[research:${tag}]]`);
    const row = await lead.ended(tag);
    return { row, usage: await usageOf(served, user, (r) => r.worker === "researcher") };
  };

  /** Leg b: a coder task on Claude Code, read at each pause. */
  const legB = async (served: ServedShiftManager, user: typeof USERS.b, tag: string, paused_: boolean) => {
    const chief = await conversation(served, user, "coordinator", "shift-coordinator");
    await chief.say(`Please take this on. [[usage:${tag}]]`);
    const reads: Spend[] = [];
    if (paused_) {
      const run = `${tag}-1`;
      for (let n = 0; n <= 3; n += 1) {
        await paused(run, n);
        await sleep(PAST_A_TICK_MS);
        reads.push((await chief.rowOf(tag)).spend ?? null);
        release(run, n);
      }
    }
    const row = await chief.ended(tag);
    return { row, reads, usage: await usageOf(served, user, (r) => r.worker !== "shift-coordinator") };
  };

  try {
    // ── Development, on Claude Code: legs a, b, d and g. ──
    runs.b = [{ answer: "Answered b.", model: "claude-sonnet-4-5", pause: true, steps: [step(100, 20), step(100, 20), step(100, 20)], modelUsage: whole(1000, 200) }];
    runs["b-prod"] = [{ ...(runs.b[0] as object), pause: false }];
    runs.d = [
      // Attempt one spends, then answers nothing, so its check fails.
      { answer: "", steps: [step(150, 50), step(80, 20)], modelUsage: whole(230, 70) },
      // Attempt two passes.
      { answer: "Answered d again.", steps: [step(1000, 200)], modelUsage: whole(1000, 200) },
    ];
    runs.g1 = [{ answer: "Answered g1.", pause: true, steps: [step(100, 20), step(100, 20), step(100, 20)], modelUsage: whole(1000, 200) }];
    runs.g2 = [{ answer: "Answered g2.", pause: true, steps: [step(100, 20), step(100, 20), step(100, 20)], modelUsage: whole(400, 80) }];
    writeSetup();
    const dev = await start("dev", {});
    let devA: { row: TaskRow; usage: { input: number; output: number } } | undefined;
    let devB: Awaited<ReturnType<typeof legB>> | undefined;
    try {
      if (!dev.stood.includes("traces=on")) failures.push(`setup — the development Lab stood "${dev.stood}"`);

      // a: a model worker's task.
      devA = await legA(dev.served, USERS.a, "a");
      const a = devA.row.spend;
      if (a?.model !== "openai/gpt-6-luna" || a.harness !== null || a.inputTokens !== 8 || a.outputTokens !== 8 || a.live !== false) {
        failures.push(`a:model-and-8 — the researcher's task reads ${show(a)} (${devA.row.status})`);
      }
      notes.push(`a: ${devA.row.status} ${show(a)}`);
      equalsUsage("a", a, devA.usage);

      // b: a coder task on Claude Code, read mid-run.
      devB = await legB(dev.served, USERS.b, "b", true);
      const [atInit, afterOne, afterTwo, afterThree] = devB.reads;
      if (atInit?.harness !== "claude-code" || atInit.model !== "claude-sonnet-4-5") failures.push(`b:model — before any message the row reads ${show(atInit)}`);
      if (atInit?.inputTokens !== null || atInit.outputTokens !== null) failures.push(`b:null-before — before any message the row reads ${show(atInit)}`);
      if (afterOne?.inputTokens !== 100 || afterOne.outputTokens !== 20 || afterOne.live !== true) failures.push(`b:rising — after the first message the row reads ${show(afterOne)}`);
      if (afterTwo?.inputTokens !== 200 || afterTwo.outputTokens !== 40) failures.push(`b:rising — after the second message the row reads ${show(afterTwo)}`);
      const end = devB.row.spend;
      if (end?.inputTokens !== 1000 || end.outputTokens !== 200 || end.live !== false || end.model !== "claude-sonnet-4-5") {
        failures.push(`b:exact — at the end the row reads ${show(end)} (${devB.row.status})`);
      }
      notes.push(`b: reads ${devB.reads.map(show).join(" → ")}; end ${devB.row.status} ${show(end)}; ${show(afterThree)} before the result`);
      equalsUsage("b", end, devB.usage);

      // d: attempt one spends and fails its check; attempt two passes.
      const chiefD = await conversation(dev.served, USERS.d, "coordinator", "shift-coordinator");
      await chiefD.say("Please take this on. [[usage:d]]");
      const dEnd = await chiefD.ended("d", 240_000);
      if (dEnd.status !== "completed" || dEnd.attempts !== 2 || ranTimes("d") !== 2) failures.push(`d:setup — the task ended ${dEnd.status} after ${dEnd.attempts} attempt(s), ${ranTimes("d")} run(s)`);
      if (dEnd.spend?.inputTokens !== 1230 || dEnd.spend.outputTokens !== 270) failures.push(`d:1500 — after two attempts the row reads ${show(dEnd.spend)}`);
      notes.push(`d: ${dEnd.status} after ${dEnd.attempts} attempts and ${ranTimes("d")} runs; ${show(dEnd.spend)}`);
      equalsUsage("d", dEnd.spend, await usageOf(dev.served, USERS.d, (r) => r.worker !== "shift-coordinator"));

      // g: two tasks for one coder at once; the second is cancelled mid-run.
      const chiefG = await conversation(dev.served, USERS.g, "coordinator", "shift-coordinator");
      await chiefG.say("Please take these on. [[usage:g1]] [[usage:g2]]");
      await paused("g1-1", 0);
      await paused("g2-1", 0);
      release("g1-1", 0);
      release("g2-1", 0);
      await paused("g1-1", 1);
      await paused("g2-1", 1);
      await sleep(PAST_A_TICK_MS);
      const g2Row = await chiefG.rowOf("g2");
      const cancelled = await chiefG.act("updateTask_tasks", { id: g2Row.id, status: "cancelled" });
      if (cancelled.output?.ok !== true) failures.push(`g:setup — the cancel answered ${JSON.stringify(cancelled.output ?? cancelled.error)}`);
      // A row that never settles, or stays live, is one that doesn't hold only its own.
      const settledOwn = async (tag: string) => {
        try {
          return await chiefG.ended(tag, 60_000);
        } catch (error) {
          failures.push(`g:own-only — ${(error as Error).message}`);
          return chiefG.rowOf(tag);
        }
      };
      const g2 = await settledOwn("g2");
      for (let n = 1; n <= 3; n += 1) release("g1-1", n);
      const g1 = await settledOwn("g1");
      if (g1.spend?.inputTokens !== 1000 || g1.spend.outputTokens !== 200 || g1.spend.live !== false) failures.push(`g:own-only — the first task reads ${show(g1.spend)} (${g1.status})`);
      if (g2.status !== "cancelled" || g2.spend?.inputTokens !== 100 || g2.spend.outputTokens !== 20 || g2.spend.live !== false) {
        failures.push(`g:own-only — the cancelled task reads ${show(g2.spend)} (${g2.status})`);
      }
      notes.push(`g: ${g1.status} ${show(g1.spend)}; ${g2.status} ${show(g2.spend)}`);
    } finally {
      await stop("dev", dev.served);
    }

    // ── Production: legs a and b give the same numbers. ──
    const prod = await start("production", { production: true });
    try {
      if (!prod.stood.includes("NODE_ENV=production") || !prod.stood.includes("traces=off")) failures.push(`e:setup — the production Lab stood "${prod.stood}"`);
      const pa = await legA(prod.served, USERS.a, "a-prod");
      const pb = await legB(prod.served, USERS.b, "b-prod", false);
      for (const [leg, there, here] of [["a", pa.row.spend, devA?.row.spend], ["b", pb.row.spend, devB?.row.spend]] as const) {
        if (show(there) !== show(here)) failures.push(`e:same-numbers — leg ${leg} reads ${show(there)} in production, ${show(here)} in development`);
        notes.push(`e: ${leg} in production ${show(there)}`);
      }
    } finally {
      await stop("production", prod.served);
    }

    // ── Codex and Cursor: paused before the turn ends. ──
    codex.c = { answer: "Answered c.", input: 700, output: 300, pause: true };
    cursor.c = { answer: "Answered c.", input: 500, output: 100, pause: true };
    writeSetup();
    for (const [vendor, user, model, want] of [
      ["codex", USERS.codex, "gpt-5", [700, 300]],
      ["cursor", USERS.cursor, "composer-2", [500, 100]],
    ] as const) {
      const lab = await start(vendor, { harness: vendor });
      try {
        const chief = await conversation(lab.served, user, "coordinator", "shift-coordinator");
        await chief.say("Please take this on. [[usage:c]]");
        await paused(`${vendor}-c`, 0);
        await sleep(PAST_A_TICK_MS);
        const mid = (await chief.rowOf("c")).spend;
        if (mid?.harness !== vendor || mid.model !== model) failures.push(`c:model — ${vendor} mid-turn reads ${show(mid)}`);
        if (mid?.inputTokens !== null || mid.outputTokens !== null || mid.unreported !== true) failures.push(`c:null — ${vendor} mid-turn reads ${show(mid)}`);
        release(`${vendor}-c`, 0);
        const end = await chief.ended("c");
        if (end.spend?.inputTokens !== want[0] || end.spend.outputTokens !== want[1] || end.spend.unreported !== false) failures.push(`c:after — ${vendor} at the end reads ${show(end.spend)} (${end.status})`);
        notes.push(`c: ${vendor} mid-turn ${show(mid)}; end ${end.status} ${show(end.spend)}`);
        equalsUsage(`c-${vendor}`, end.spend, await usageOf(lab.served, user, (r) => r.worker !== "shift-coordinator"));
      } finally {
        await stop(vendor, lab.served);
      }
    }
  } finally {
    // Release anything still paused, so no scripted run outlives the check waiting.
    for (const line of existsSync(runLog) ? logLines() : []) {
      const m = /^PAUSED (\S+) (\d+)$/.exec(line);
      if (m !== null) release(m[1]!, Number(m[2]));
    }
  }

  assertPatched(patches, REPO_ROOT, mark);
  for (const note of notes) say(note);

  if (control !== undefined) {
    const red = control.assertions.filter((name) => failures.some((f) => f.startsWith(`${name} `)));
    const missed = control.assertions.filter((name) => !red.includes(name));
    failures.unshift(
      missed.length === 0
        ? `control ${control.name}: failed on ${red.join(", ")}, as it must`
        : `control ${control.name}: did NOT fail on ${missed.join(", ")}, so the check can't see what the control removes`,
    );
  }
  return {
    failures,
    evidence: `legs a to g PASS in ${Math.round((Date.now() - started) / 1000)} s`,
  };
});

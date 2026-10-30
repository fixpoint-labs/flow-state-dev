/**
 * Goal check — shift-manager › a coding run's question is answered in the Inbox.
 *
 * A coder task filed from a conversation with the Shift Coordinator, worked by
 * the DevTeam's coder (the harness manager) on a durable SQLite host with
 * trace observability off. Its run asks; the task holds on the question; the
 * Inbox (Shift Manager's own snapshot) lists it; the answer, sent as the
 * Inbox sends it, continues the same coding session on the same attempt.
 *
 * Legs (`GOAL_LEGS=a,b,b2,r1,r2,r3,sweep`; unset runs all):
 *
 *   a      real model — the run asks: one `question` item with the run's own
 *          text; `getTask` shows the open question, attempt 1, no lease; the
 *          checkout's lock is free; the reconciler is green
 *   b      real model — answered in the Inbox: attempts stays 1, the next run
 *          resumes the session the first confirmed, and a fact only the first
 *          run read lands in the checkout; no run is handed one prompt twice;
 *          the task completes and its item closes
 *   b2     stub — a second question in the same try passes the same way
 *   r1     stub — a line typed in the run's session while it holds answers
 *          the question, and the next run resumes the confirmed session
 *   r2     stub — a line typed while a run works is taken by a run of the same
 *          request and attempt, which resumes the session: no new attempt
 *   r3     stub — cancelled while held: no further run, and the branch's
 *          commit and the kept files stay
 *   sweep  the removed names have no references (`GOAL_SWEEP_REF` reads a git
 *          ref instead of the working tree, e.g. `origin/main`)
 *
 * Controls (`GOAL_CONTROL`): `new-attempt` (the answer's turn is claimed as a
 * new attempt) must FAIL `b:same-attempt` (and `b2`, `r1`); `fresh-session`
 * (the manager's resume feed answers no session) must FAIL `b:same-session`
 * (and `b2`, `r1`). Each is a scratch patch applied as the code loads, printed
 * by the run, and refused when it never reached the code.
 *
 * Run: pnpm tsx goals/shift-manager/a-coding-runs-question-is-answered-in-the-inbox/run.mts
 */
// Traces off before anything reads the flag: a suspension added later can't
// pass on a traces-on replay.
process.env.FSDEV_TRACE_OBSERVABILITY = "0";

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { handler, harnessRunInputSchema, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { probeClaudeAccount } from "@flow-state-dev/claude-code/sdk";
import { createInboxClient, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { reconcileInbox, rowTruthOf, suspensionTruthOf } from "@flow-state-dev/orchestration/inbox/check";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, silentLogger, stripIntentOverrides, type ModulePatch } from "../../lib/index.mts";
import { claudeCodeEnv, claudeCodeHarness, selectHarness } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { harnessStub, type HarnessStubOptions, type StubRun } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { commitAll, createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { UPDATE_TASK_ACTION, createLabReader } from "../../../packages/shift-manager/src/lib/reads.ts";

stripIntentOverrides();

interface Fixture {
  noteFile: string;
  factFile: string;
  goal: string;
  answer: string;
  stub: { goal: string; first: string; second: string; answers: [string, string]; line: string; midRunLine: string };
}
const fixture = loadFixture<Fixture>(import.meta.url);

const CODER = "eng.coder";
const SHIFT_COORDINATOR = "shift-coordinator";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const ALL_LEGS = ["a", "b", "b2", "r1", "r2", "r3", "sweep"] as const;
const LEGS = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((leg) => leg.trim()).filter(Boolean));
const SCRATCH = goalTmpDir("coding-question");

// ---- controls: scratch patches, applied in a child that loads them ----------------

/**
 * Each control's patches, and the assertions it must fail: leg b's, and the
 * same claim on the stub legs, so the control can be seen to bite where no
 * model can run (b2, r1 grade attempts and sessions as b does).
 */
const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[] }> = {
  "new-attempt": {
    must: ["b:same-attempt", "b2:same-attempt", "r1:same-attempt"],
    // Both ways an owed turn starts, the board's claim and the admission that takes it, count it a new attempt.
    patches: [
      { module: "packages/orchestration/src/tasks/collection/internal.ts", from: String.raw`const turnOnly = !recovering && owesTurn\(task as Task\);`, to: "const turnOnly = false;" },
      {
        module: "packages/orchestration/src/tasks/collection/internal.ts",
        from: String.raw`\.\.\.\(takesTurn \? \{ turn: \(task\.turn \?\? 0\) \+ 1, turnOwed: undefined \} : \{\}\),`,
        to: "...(takesTurn ? { turn: (task.turn ?? 0) + 1, turnOwed: undefined, attempts: task.attempts + 1 } : {}),",
      },
    ],
  },
  "fresh-session": {
    must: ["b:same-session", "b2:same-session", "r1:same-session"],
    patches: [{ module: "packages/harness-manager/src/manager.ts", from: String.raw`resume: \(ctx\) => harnessCtxState\(ctx\)\?\.previousSessionId \?\? null,`, to: "resume: (ctx) => null," }],
  },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const { patches, must } = CONTROLS[CONTROL]!;
  console.error(describePatches(patches, REPO_ROOT));
  const mark = join(SCRATCH, `patched-${RUN_STAMP}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, ...modulePatchEnv(patches, REPO_ROOT, mark) },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout ?? "");
  process.stderr.write(child.stderr ?? "");
  assertPatched(patches, REPO_ROOT, mark);
  const out = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const failedOn = must.filter((assertion) => /^FAIL/m.test(out) && out.includes(`${assertion} —`));
  console.log(
    failedOn.length > 0
      ? `control ${CONTROL}: failed on ${failedOn.join(", ")}, as it must`
      : `control ${CONTROL}: did NOT fail on any of ${must.join(", ")}, so the check can't see what the control removes`,
  );
  process.exit(failedOn.length > 0 ? 0 : 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown) => JSON.stringify(value);

// ---- the host -----------------------------------------------------------------------

/** What the harness slot was handed and confirmed, run by run (1-based). */
interface Seen {
  prompts: string[];
  resumes: (string | null)[];
  cwds: string[];
  /** The session each run confirmed, by its run's number. */
  confirmed: Map<number, string>;
}

/**
 * The slot, recorded: every prompt, the session each run was asked to resume,
 * and the one it confirmed. `before`/`after` run around each run, in its
 * checkout, as the check's own instrumentation (they never touch the board).
 */
function recorded(
  slot: (feeds: any) => HarnessBlock,
  seen: Seen,
  hooks: { before?: (run: number, cwd: string) => void | Promise<void>; after?: (run: number, cwd: string) => void | Promise<void> } = {},
) {
  return (feeds: any): HarnessBlock => {
    const inner = slot({
      ...feeds,
      resume: async (ctx: unknown) => {
        const resume = await feeds.resume(ctx);
        seen.resumes.push(resume);
        return resume;
      },
      onSession: async (sessionId: string, ctx: unknown) => {
        seen.confirmed.set(seen.prompts.length, sessionId);
        return feeds.onSession(sessionId, ctx);
      },
    });
    const before = handler({
      name: "goal-before-run",
      inputSchema: harnessRunInputSchema.passthrough(),
      outputSchema: harnessRunInputSchema.passthrough(),
      execute: async (input, ctx) => {
        const cwd = await feeds.cwd(ctx);
        seen.prompts.push(input.prompt);
        seen.cwds.push(cwd);
        await hooks.before?.(seen.prompts.length, cwd);
        return input;
      },
    });
    const after = handler({
      name: "goal-after-run",
      inputSchema: z.unknown(),
      outputSchema: z.unknown(),
      execute: async (handle) => {
        await hooks.after?.(seen.prompts.length, seen.cwds.at(-1)!);
        return handle;
      },
    });
    return sequencer({ name: "goal-recorded-harness", inputSchema: harnessRunInputSchema.passthrough() })
      .step(before)
      .step(inner as never)
      .step(after) as unknown as HarnessBlock;
  };
}

/** A model for the Shift Coordinator: its first turn files one coder task with `goal`; every other step answers "Noted." */
function filesOneTask(goal: string): ModelResolver {
  let filed = false;
  const judgment: GeneratorModel = {
    modelId: "goal/judgment",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      if (filed) return { text: "Noted.", finishReason: "stop" };
      filed = true;
      return { toolCalls: [{ toolCallId: "file", toolName: "createTask", args: { goal, assignee: CODER, input: { project: STOREFRONT } } }], finishReason: "tool-calls" };
    },
  } as unknown as GeneratorModel;
  const helper: GeneratorModel = {
    modelId: "goal/helper",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      return { text: "Noted.", finishReason: "stop" };
    },
  } as unknown as GeneratorModel;
  return Object.assign((_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : helper), {
    resolveId: (id: string) => id,
  }) as unknown as ModelResolver;
}

interface Host {
  lab: Lab;
  conversation: string;
  taskId: string;
  inbox(): Promise<InboxItem<unknown>[]>;
  itemOf(): Promise<InboxItem<unknown> | undefined>;
  task(): Promise<Record<string, any> | undefined>;
  act(action: string, input: unknown, options?: { session?: string; flow?: string }): Promise<{ output?: any; error?: unknown }>;
  answerInInbox(text: string): Promise<string>;
  reconciled(): Promise<string | undefined>;
  until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T>;
  close(): Promise<void>;
}

/** Open the DevTeam Lab on a durable SQLite store, serve it, file one coder task from a conversation, and give the legs their reads. */
async function open(label: string, goal: string, slot: (feeds: any) => HarnessBlock, runTimeoutMs: number, seed: Record<string, string> = {}): Promise<Host> {
  const remote = createBareRemote(`coding-question-${label}`, { seed: { "README.md": "# Storefront\n\n## Checkout\n\n## Catalog\n", ...seed } });
  const root = join(SCRATCH, `${label}-${RUN_STAMP}`);
  mkdirSync(join(root, "runs"), { recursive: true });
  const lab = await openLab({
    stores: sqliteStores({ filename: join(root, "lab.sqlite") }),
    harness: slot as never,
    runTimeoutMs,
    workspace: { root: join(root, "runs"), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    devtool: true,
    withoutJudge: true,
    projects: [{ id: "storefront", title: "Storefront", repository: remote.url }],
    modelResolver: filesOneTask(goal),
    logger: silentLogger,
    log: () => undefined,
  } as never);
  const handle = await serve(lab.state, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  const devtool = lab.state.meta.devtool!;
  const client = connect({ baseUrl: `http://127.0.0.1:${handle.port}`, userId: devtool.userId ?? LAB_USER_ID, bearerToken: devtool.bearerToken! });
  const runtime = await lab.state.getRuntime();

  const act: Host["act"] = async (action, input, options = {}) =>
    (await runAction({
      orgId: LAB_ORG_ID,
      flow: runtime.registry.get(options.flow ?? "coordinator") as FlowInstance,
      actionName: action,
      input,
      userId: LAB_USER_ID,
      sessionId: options.session ?? conversation,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { output?: any; error?: unknown };

  const until: Host["until"] = async (read, done, ms) => {
    let last = await read();
    for (const deadline = Date.now() + ms; !done(last) && Date.now() < deadline; last = await read()) await sleep(250);
    return last;
  };

  // A conversation with the Shift Coordinator, opened as Shift Manager opens one, and the coder's task filed from it.
  const conversation = `s-goal-shift-coordinator-${RUN_STAMP}-${label}`;
  const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId: conversation, state: { workerId: SHIFT_COORDINATOR } } });
  if (created.status !== 201) throw new Error(`setup: opening the conversation answered ${created.status}`);
  const filed = await act("respond", { message: "Please have the coder look into this." });
  if (filed.error !== undefined) throw new Error(`setup: the conversation's turn failed: ${show(filed.error)}`);
  const listed = await until(async () => ((await act(LIST_TASKS_ACTION, {})).output?.tasks ?? []) as Array<Record<string, any>>, (tasks) => tasks.length > 0, 10_000);
  const taskId = listed[0]?.id as string | undefined;
  if (taskId === undefined) throw new Error("setup: the conversation filed no task for the coder");

  const inbox = async (): Promise<InboxItem<unknown>[]> => {
    const snapshot = await createLabReader(client).read();
    if (!("inbox" in snapshot) || snapshot.inbox === undefined) throw new Error(`Shift Manager's read came back ${show(snapshot)}`);
    if (!snapshot.inbox.ok) throw new Error(`Shift Manager's Inbox didn't load: ${snapshot.inbox.failure.message}`);
    return snapshot.inbox.value as InboxItem<unknown>[];
  };
  const itemOf = async () => (await inbox()).find((item) => item.task?.taskId === taskId);
  const task = async () => {
    const read = await act("getTask_tasks", { id: taskId });
    return read.output?.ok === true ? (read.output.task as Record<string, any>) : undefined;
  };
  const closed: string[] = [];
  const answerInInbox = async (text: string): Promise<string> => {
    const item = await itemOf();
    if (item === undefined) return "no item";
    try {
      await createInboxClient(client).answer(item, { text });
      closed.push(item.holds[0]!.id);
      return "ok";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const reconciled = async (): Promise<string | undefined> => {
    const rows = ((await act(LIST_TASKS_ACTION, {})).output?.tasks ?? []) as Array<Record<string, any>>;
    const board = `${conversation}.tasks`;
    const sessions = new Set<string>(rows.flatMap((row) => (row.run?.sessionId === undefined ? [] : [row.run.sessionId as string])));
    const suspensions = [];
    for (const sessionId of sessions) {
      suspensions.push(...suspensionTruthOf(sessionId, await client.sessions.requests(sessionId, { status: "suspended", includeItems: true })));
    }
    const truth = { rows: rowTruthOf(rows.map((row) => ({ board, id: row.id, status: row.status, holds: row.holds ?? [], steers: [] }))), suspensions, closed };
    const result = reconcileInbox(await inbox(), truth);
    return result.green ? undefined : show({ ...result, green: undefined });
  };
  return {
    lab,
    conversation,
    taskId,
    inbox,
    itemOf,
    task,
    act,
    answerInInbox,
    reconciled,
    until,
    close: async () => {
      await handle.close?.();
      await lab.dispose();
    },
  };
}

const isHeld = (task: Record<string, any> | undefined) =>
  task?.status === "in_progress" && (task.holds ?? []).some((hold: any) => hold.source?.kind === "row");
const isSettled = (task: Record<string, any> | undefined) => ["completed", "errored", "cancelled", "pending"].includes(task?.status);
const lockFree = (cwd: string | undefined) => cwd !== undefined && !existsSync(`${cwd}.lock`);

/** Every file under `dir` (not `.git`) holding `needle`. */
function filesHolding(dir: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && readFileSync(full, "utf8").includes(needle)) hits.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return hits;
}

/** A stub run that writes `question` to the marker its prompt names. */
function ask(run: StubRun, question: string): void {
  const marker = /\S*\.fsdev\/ask\/\d+-\d+\.md/.exec(run.prompt)?.[0];
  if (marker === undefined) throw new Error("the prompt names no ask marker");
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, question);
}

/** A stub coder: run `n` (1-based) does `script[n - 1]`. */
function stub(script: Array<(run: StubRun, n: number) => void | Promise<void>>, extra: HarnessStubOptions = {}) {
  let n = 0;
  return harnessStub({
    finalMessage: "I looked at the repository.",
    ...extra,
    duringRun: async (run) => {
      n += 1;
      await script[n - 1]?.(run, n);
    },
  });
}

// ---- the legs -----------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const fail = (tag: string, what: string) => failures.push(`${tag} — ${what}`);

  // ---- a, b: a real coding run --------------------------------------------------------
  if (LEGS.has("a") || LEGS.has("b")) {
    const probe = await probeClaudeAccount({ env: claudeCodeEnv() } as never);
    if (probe.status !== "account") {
      console.error(`a, b: no Claude Code account to run them with (${show(probe)})`);
      tell.over("a · a real Claude Code run (no account: blocked on a real-model run)", []);
      tell.over("b · a real Claude Code run (no account: blocked on a real-model run)", []);
    } else {
      const fact = `FSD-${RUN_STAMP.replace(/_/g, "")}-${Math.random().toString(16).slice(2, 10)}`;
      const seen: Seen = { prompts: [], resumes: [], cwds: [], confirmed: new Map() };
      const real = selectHarness("claude-code");
      const host = await open(
        "real",
        fixture.goal,
        recorded(claudeCodeHarness as never, seen, {
          // The fact, on disk for the first run only: the answer's run can know it only from its session.
          before: (n, cwd) => (n === 1 ? writeFileSync(join(cwd, fixture.noteFile), `${fact}\n`) : undefined),
          after: (n, cwd) => (n === 1 && existsSync(join(cwd, fixture.noteFile)) ? unlinkSync(join(cwd, fixture.noteFile)) : undefined),
        }),
        real.runTimeoutMs,
      );
      try {
        const held = await host.until(host.task, (t) => isHeld(t) || isSettled(t), real.runTimeoutMs + 60_000);
        // ---- a
        const item = await host.itemOf();
        const asked = tell.over("a · the item's holds", [...(item?.holds ?? [])]);
        const marker = seen.cwds[0] === undefined ? undefined : readdirSync(join(seen.cwds[0], ".fsdev", "ask")).map((f) => readFileSync(join(seen.cwds[0]!, ".fsdev", "ask", f), "utf8").trim())[0];
        if (!isHeld(held)) fail("a:held", `the task is ${held?.status} with ${show(held?.holds?.length ?? 0)} hold(s), not held on the run's question`);
        if ((await host.inbox()).filter((i) => i.task?.taskId === host.taskId).length !== 1) fail("a:one-item", "the Inbox doesn't list exactly one item for the task");
        if (asked.length !== 1 || asked[0]!.ask.kind !== "question" || marker === undefined || !marker.startsWith(asked[0]!.ask.prompt.replace(/…$/, ""))) {
          fail("a:the-runs-question", `the item's holds are ${show(asked.map((h) => [h.ask.kind, h.ask.prompt]))}; the run asked ${show(marker)}`);
        }
        if (held?.attempts !== 1 || held?.leaseUntil != null) fail("a:attempt-1-no-lease", `getTask shows attempts ${held?.attempts}, lease ${show(held?.leaseUntil)}`);
        if (!lockFree(seen.cwds[0])) fail("a:checkout-free", `the checkout's lock ${seen.cwds[0]}.lock is still there`);
        const driftA = await host.reconciled();
        if (driftA !== undefined) fail("a:reconciler", driftA);
        if (!failures.some((f) => f.startsWith("a:"))) evidence.push(`a: one question item "${asked[0]!.ask.prompt.slice(0, 80)}", attempt 1, no lease, the checkout free, the reconciler green`);

        // ---- b
        if (LEGS.has("b") && isHeld(held)) {
          const leaked = filesHolding(seen.cwds[0]!, fact);
          if (leaked.length > 0) fail("b:anti-game", `the first run left the fact on disk (${leaked.join(", ")})`);
          if (fixture.answer.includes(fact)) fail("b:anti-game", "the answer carries the fact");
          const sent = await host.answerInInbox(fixture.answer);
          if (sent !== "ok") fail("b:answered", `the Inbox's answer was refused: ${sent}`);
          const done = await host.until(host.task, (t) => isSettled(t), real.runTimeoutMs + 60_000);
          if (done?.attempts !== 1) fail("b:same-attempt", `the task is on attempt ${done?.attempts}; an answer spends no try`);
          const first = seen.confirmed.get(1);
          if (first === undefined || seen.resumes[1] !== first) fail("b:same-session", `the answer's run resumed ${show(seen.resumes[1])}; the first run confirmed ${show(first)}`);
          const proof = join(seen.cwds[0]!, fixture.factFile);
          const written = existsSync(proof) ? readFileSync(proof, "utf8") : null;
          if (written === null || !written.includes(fact)) fail("b:the-fact", `${proof} holds ${show(written)}, not the fact only the first run read`);
          if ((seen.prompts[1] ?? "").includes(fact)) fail("b:anti-game", "the answer's run's prompt carries the fact");
          if (new Set(seen.prompts).size !== seen.prompts.length) fail("b:no-prompt-twice", "a run was handed a prompt an earlier run was handed");
          if (done?.status !== "completed") fail("b:completed", `the task ended ${done?.status}: ${show(done?.error ?? done?.feedback ?? null)}`);
          if ((await host.itemOf()) !== undefined) fail("b:item-closed", "the task's Inbox item is still listed");
          const driftB = await host.reconciled();
          if (driftB !== undefined) fail("b:reconciler", driftB);
          if (!failures.some((f) => f.startsWith("b:"))) evidence.push(`b: completed on attempt 1, run 2 resumed ${first}, the fact in ${fixture.factFile}, ${seen.prompts.length} distinct prompts`);
        }
      } finally {
        await host.close();
      }
    }
  }

  // ---- b2: a second question in the same try (stub) -----------------------------------
  if (LEGS.has("b2")) {
    const seen: Seen = { prompts: [], resumes: [], cwds: [], confirmed: new Map() };
    const coder = stub([(run) => ask(run, fixture.stub.first), (run) => ask(run, fixture.stub.second)]);
    const host = await open("b2", fixture.stub.goal, recorded(coder.slot as never, seen), 30_000);
    try {
      for (const [i, question] of [fixture.stub.first, fixture.stub.second].entries()) {
        const held = await host.until(host.task, (t) => isHeld(t) || isSettled(t), 30_000);
        const item = await host.itemOf();
        if (!isHeld(held) || item?.holds.length !== 1 || item.holds[0]!.ask.prompt !== question) {
          fail("b2:held", `question ${i + 1}: the task is ${held?.status}, its item ${show(item?.holds.map((h) => h.ask.prompt))}`);
          break;
        }
        const sent = await host.answerInInbox(fixture.stub.answers[i]!);
        if (sent !== "ok") fail("b2:answered", `answer ${i + 1} was refused: ${sent}`);
        await host.until(host.task, (t) => !isHeld(t), 30_000);
      }
      const done = await host.until(host.task, (t) => isSettled(t), 30_000);
      tell.over("b2 · the runs", seen.prompts);
      if (done?.status !== "completed" || done.attempts !== 1) fail("b2:same-attempt", `the task ended ${done?.status} on attempt ${done?.attempts}`);
      for (const n of [2, 3]) {
        if (seen.resumes[n - 1] !== seen.confirmed.get(n - 1)) fail("b2:same-session", `run ${n} resumed ${show(seen.resumes[n - 1])}, not ${show(seen.confirmed.get(n - 1))}`);
      }
      const last = seen.prompts[2] ?? "";
      if (!(last.indexOf(fixture.stub.answers[0]) >= 0 && last.indexOf(fixture.stub.answers[0]) < last.indexOf(fixture.stub.answers[1]))) {
        fail("b2:answers", "the third run's prompt doesn't carry both answers, oldest first");
      }
      if (new Set(seen.prompts).size !== seen.prompts.length) fail("b2:no-prompt-twice", "a run was handed a prompt an earlier run was handed");
      const drift = await host.reconciled();
      if (drift !== undefined) fail("b2:reconciler", drift);
      if (!failures.some((f) => f.startsWith("b2:"))) evidence.push(`b2: two questions answered in the Inbox, three runs, attempt 1, each resuming the last`);
    } finally {
      await host.close();
    }
  }

  // ---- r1: a line typed in the run's session answers its question (stub) ---------------
  if (LEGS.has("r1")) {
    const seen: Seen = { prompts: [], resumes: [], cwds: [], confirmed: new Map() };
    const coder = stub([(run) => ask(run, fixture.stub.first)]);
    const host = await open("r1", fixture.stub.goal, recorded(coder.slot as never, seen), 30_000);
    try {
      const held = await host.until(host.task, (t) => isHeld(t) || isSettled(t), 30_000);
      const session = held?.run?.sessionId as string | undefined;
      if (!isHeld(held) || session === undefined) fail("r1:held", `the task is ${held?.status}, run ${show(held?.run ?? null)}`);
      else {
        const line = await host.act("respond", { message: fixture.stub.line }, { session, flow: "coder" });
        if (line.error !== undefined) fail("r1:line", `the line was refused: ${show(line.error)}`);
        const done = await host.until(host.task, (t) => isSettled(t), 30_000);
        tell.over("r1 · the runs", seen.prompts);
        if (done?.status !== "completed" || done.attempts !== 1) fail("r1:same-attempt", `the task ended ${done?.status} on attempt ${done?.attempts}`);
        if (seen.prompts.length !== 2) fail("r1:one-run-after", `${seen.prompts.length} runs; the line owes exactly one more`);
        if (seen.resumes[1] !== seen.confirmed.get(1)) fail("r1:same-session", `the line's run resumed ${show(seen.resumes[1])}, not ${show(seen.confirmed.get(1))}`);
        if (!(seen.prompts[1] ?? "").includes(fixture.stub.line)) fail("r1:the-line", "the next run's prompt doesn't carry the line");
        if ((await host.itemOf()) !== undefined) fail("r1:item-closed", "the task's Inbox item is still listed");
        if (!failures.some((f) => f.startsWith("r1:"))) evidence.push("r1: a line in the run's session answered the question; one more run, resuming, on attempt 1");
      }
    } finally {
      await host.close();
    }
  }

  // ---- r2: a line while the run works (stub) ------------------------------------------
  if (LEGS.has("r2")) {
    const seen: Seen = { prompts: [], resumes: [], cwds: [], confirmed: new Map() };
    let host: Host | undefined;
    const coder = stub([
      async () => {
        // The line is typed while this run works; the run then ends on its own (no stop on abort here).
        const row = await host!.task();
        const session = row?.run?.sessionId as string | undefined;
        if (session !== undefined) void host!.act("respond", { message: fixture.stub.midRunLine }, { session, flow: "coder" });
        await host!.until(host!.task, (t) => (t?.steers ?? []).some((s: any) => s.message === fixture.stub.midRunLine), 5_000);
      },
    ]);
    host = await open("r2", fixture.stub.goal, recorded(coder.slot as never, seen), 30_000);
    try {
      const done = await host.until(host.task, (t) => isSettled(t), 30_000);
      tell.over("r2 · the runs", seen.prompts);
      if (done?.status !== "completed" || done.attempts !== 1) fail("r2:same-attempt", `the task ended ${done?.status} on attempt ${done?.attempts}`);
      if (seen.prompts.length !== 2 || !(seen.prompts[1] ?? "").includes(fixture.stub.midRunLine)) {
        fail("r2:next-step", `${seen.prompts.length} runs; the second should carry the line`);
      }
      if (seen.resumes[1] !== seen.confirmed.get(1)) fail("r2:same-session", `the line's run resumed ${show(seen.resumes[1])}, not ${show(seen.confirmed.get(1))}`);
      if (!failures.some((f) => f.startsWith("r2:"))) evidence.push("r2: a line while the run worked was taken by one more run, resuming, on attempt 1");
    } finally {
      await host.close();
    }
  }

  // ---- r3: cancelled while held, the work stays (stub) ---------------------------------
  if (LEGS.has("r3")) {
    const seen: Seen = { prompts: [], resumes: [], cwds: [], confirmed: new Map() };
    const kept = `kept ${RUN_STAMP}\n`;
    const coder = stub([
      (run) => {
        writeFileSync(join(run.cwd, "WORK.md"), "work\n");
        commitAll(run.cwd, "the work before the question");
        const project = join(dirname(run.cwd), "project");
        if (existsSync(project)) writeFileSync(join(project, "notes.md"), kept);
        ask(run, fixture.stub.first);
      },
    ]);
    const host = await open("r3", fixture.stub.goal, recorded(coder.slot as never, seen), 30_000);
    try {
      const held = await host.until(host.task, (t) => isHeld(t) || isSettled(t), 30_000);
      if (!isHeld(held)) fail("r3:held", `the task is ${held?.status}`);
      const cancelled = await host.act(UPDATE_TASK_ACTION, { id: host.taskId, status: "cancelled" });
      if (cancelled.output?.ok !== true) fail("r3:cancelled", `the cancel was refused: ${show(cancelled.output ?? cancelled.error)}`);
      const done = await host.until(host.task, (t) => t?.status === "cancelled", 10_000);
      await host.act(LIST_TASKS_ACTION, {});
      await sleep(1_000);
      if (done?.status !== "cancelled") fail("r3:cancelled", `the task is ${done?.status}`);
      if (seen.prompts.length !== 1) fail("r3:no-further-run", `${seen.prompts.length} runs after the cancel`);
      const cwd = seen.cwds[0];
      const log = cwd !== undefined && existsSync(cwd) ? execFileSync("git", ["log", "--format=%s", "-1"], { cwd, encoding: "utf8" }).trim() : "";
      if (log !== "the work before the question") fail("r3:branch-commit", `the checkout's last commit is ${show(log)}`);
      const stored = Object.entries(await host.lab.stored("org")).filter(([key]) => key.includes("project-files/") && key.endsWith("notes.md"));
      if (cwd !== undefined && existsSync(join(dirname(cwd), "project")) && stored.length === 0) fail("r3:kept-files", "the run's kept file is not saved");
      if ((await host.itemOf()) !== undefined) fail("r3:item-closed", "the cancelled task's Inbox item is still listed");
      if (!failures.some((f) => f.startsWith("r3:"))) evidence.push(`r3: cancelled while held; no further run, the commit on its branch, ${stored.length} kept file(s) saved`);
    } finally {
      await host.close();
    }
  }

  // ---- sweep ----------------------------------------------------------------------------
  if (LEGS.has("sweep")) {
    const ref = process.env.GOAL_SWEEP_REF;
    const SOURCE = [":(glob)packages/*/src/**", "packages/shift-manager/teams", ":(glob)labs/*/src/**"];
    // Code references only: a comment that names a removed surface is history, as the epic's ratchet reads it.
    const grep = (pattern: string, paths: string[]): string[] => {
      const out = spawnSync("git", ["grep", "-n", "-E", pattern, ...(ref !== undefined ? [ref] : []), "--", ...paths], { cwd: REPO_ROOT, encoding: "utf8" });
      return (out.stdout ?? "").split("\n").filter((line) => {
        if (line.trim() === "") return false;
        const content = line.split(":").slice(ref === undefined ? 2 : 3).join(":");
        return !/^\s*(\/\/|\*|\/\*)/.test(content);
      });
    };
    // The review step's one call and its result's type are allowed; a second call is not.
    const suspendForUserPastReview = (hits: string[]): string[] => {
      const calls = hits.filter((line) => /await ctx\.suspendForUser\(/.test(line));
      const rest = hits.filter((line) => !/await ctx\.suspendForUser\(|BlockContext\["suspendForUser"\]/.test(line));
      return calls.length > 1 ? hits : rest;
    };
    const ours = ["packages/harness-manager/src", "labs/conductor/src", "packages/shift-manager/teams", "packages/shift-manager/src"];
    const rows: Array<[string, string[]]> = [
      ["answerQuestion", grep(String.raw`\banswerQuestion\b`, ours)],
      ["inboxCollection", grep(String.raw`\binboxCollection\b`, ours)],
      ["parkOnBoardQuestion", grep(String.raw`\bparkOnBoardQuestion\b`, SOURCE)],
      // `announce` is refused by name, so the refusal itself is the one place it may stand.
      ["announce", grep(String.raw`\bannounce\b`, ["packages/harness-manager/src", "labs/conductor/src"]).filter((line) => !/`announce` was removed|"announce" in/.test(line))],
      ["harness-manager's holdTaskForUser", grep(String.raw`\bholdTaskForUser\b`, ["packages/harness-manager/src"])],
      ["harness-manager's inbox module", [...grep(String.raw`from "\./inbox"`, ["packages/harness-manager/src"]), ...grep(String.raw`harness-manager/src/inbox`, [...SOURCE, "goals", ":(exclude)goals/shift-manager/a-coding-runs-question-is-answered-in-the-inbox/**"])]],
      ["awaitReview in harness-manager", grep(String.raw`\bawaitReview\b`, ["packages/harness-manager/src"])],
      ["HarnessRunParked", grep(String.raw`\bHarnessRunParked\b`, SOURCE)],
      // The manager suspends for one reason, a review of a run's changes (FIX-2163): its one call is allowed.
      ["suspendForUser in harness-manager, past the review's one call", suspendForUserPastReview(grep(String.raw`\bsuspendForUser\b`, ["packages/harness-manager/src"]))],
    ];
    tell.over("sweep · the names swept", rows, { emptyIs: "never empty: the list above" });
    for (const [name, hits] of rows) if (hits.length > 0) fail("sweep", `${name}: ${hits.slice(0, 3).join(" | ")}${hits.length > 3 ? ` (+${hits.length - 3})` : ""}`);
    if (!failures.some((f) => f.startsWith("sweep"))) evidence.push(`sweep: ${rows.length} names, no references${ref === undefined ? "" : ` at ${ref}`}`);
  }

  rmSync(SCRATCH, { recursive: true, force: true });
  return { failures, evidence: evidence.join("; ") };
});

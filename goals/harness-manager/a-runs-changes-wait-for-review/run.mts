/**
 * Goal check — harness-manager › a run's changes wait for review.
 *
 * The DevTeam Lab's coder (the harness manager) with `reviewChanges` on, on a
 * durable SQLite host with trace observability off, its harness the DevTeam
 * stub and its judge Jev, scripted. A run that commits waits for a person's
 * review; the review is answered as the Inbox answers it.
 *
 * Legs (`GOAL_LEGS=a,b,c,cprime,d,e,f,g,h,i`; unset runs all):
 *
 *   a       a run commits: the task waits on a review naming the commits and
 *           the judge's verdict; attempt 1; the checkout free; one run
 *   b       accepted in the Inbox: completed, `review: "accepted"`, one run
 *   c       changes requested in the Inbox after a host restart: one more run
 *           on attempt 1 resuming the confirmed session with the words; it
 *           commits and waits again; accepted, two runs
 *   cprime  changes requested on a run whose harness confirmed no session:
 *           try 1 fails, try 2's brief has the words
 *   d       a run with no commits completes with no review
 *   e       a failed run fails its try with no review
 *   f       the host's deadline: completes `review: "deadline"`, no run; unset,
 *           it still waits past the sweeper's interval
 *   g       cancelled while it waits: no run, the commit and the kept file stay
 *   h       the option off: completes on the verdict, as before
 *   i       the judge asks: a question, no review
 *
 * Controls (`GOAL_CONTROL`): `no-review` (the manager ignores the option) must
 * FAIL `a:waits`; `fail-on-revise` (a revision fails the try) must FAIL
 * `c:attempt-1`. Each is a scratch patch applied as the code loads, printed by
 * the run, and refused when it never reached the code.
 *
 * Run: pnpm tsx goals/harness-manager/a-runs-changes-wait-for-review/run.mts
 */
// Traces off before anything reads the flag: a resume must run no completed step again without them.
process.env.FSDEV_TRACE_OBSERVABILITY = "0";

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { handler, harnessRunInputSchema, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createInboxClient, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, silentLogger, stripIntentOverrides, type ModulePatch } from "../../lib/index.mts";
import { harnessStub, type StubRun } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { commitAll, createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { UPDATE_TASK_ACTION, createLabReader } from "../../../packages/shift-manager/src/lib/reads.ts";

stripIntentOverrides();

interface Fixture {
  goal: string;
  file: string;
  subjects: [string, string];
  words: string;
  judge: { confidence: number };
}
const fixture = loadFixture<Fixture>(import.meta.url);

const CODER = "eng.coder";
const COS = "chief-of-staff";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const ALL_LEGS = ["a", "b", "c", "cprime", "d", "e", "f", "g", "h", "i"] as const;
const LEGS = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((leg) => leg.trim()).filter(Boolean));
const SCRATCH = goalTmpDir("runs-changes-review");
const MANAGER = "packages/harness-manager/src/manager.ts";

// ---- controls: scratch patches, applied in a child that loads them ----------------

const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[]; legs: string }> = {
  "no-review": {
    must: ["a:waits"],
    legs: "a",
    patches: [{ module: MANAGER, from: String.raw`if \(!reviewChanges \|\| decision\?\.settle !== "complete"\) return input;`, to: "if (true) return input;" }],
  },
  "fail-on-revise": {
    must: ["c:attempt-1"],
    legs: "c",
    patches: [{ module: MANAGER, from: String.raw`if \(\(await readConfirmedSession\(ctx, state\.topic!, state\.attempt!\)\) === null\) \{`, to: "if (true) {" }],
  },
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
if (CONTROL !== "" && process.env.GOAL_MODULE_PATCH === undefined) {
  const { patches, must, legs } = CONTROLS[CONTROL]!;
  console.error(describePatches(patches, REPO_ROOT));
  const mark = join(SCRATCH, `patched-${RUN_STAMP}`);
  const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, GOAL_LEGS: process.env.GOAL_LEGS ?? legs, ...modulePatchEnv(patches, REPO_ROOT, mark) },
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
 * and the one it confirmed. A run in `unconfirmed` confirms no session to the
 * manager, as a harness that never reported one.
 */
function recorded(slot: (feeds: any) => HarnessBlock, seen: Seen, unconfirmed: Set<number> = new Set()) {
  return (feeds: any): HarnessBlock => {
    const inner = slot({
      ...feeds,
      resume: async (ctx: unknown) => {
        const resume = await feeds.resume(ctx);
        seen.resumes.push(resume);
        return resume;
      },
      onSession: async (sessionId: string, ctx: unknown) => {
        if (unconfirmed.has(seen.prompts.length)) return;
        seen.confirmed.set(seen.prompts.length, sessionId);
        return feeds.onSession(sessionId, ctx);
      },
    });
    const before = handler({
      name: "goal-before-run",
      inputSchema: harnessRunInputSchema.passthrough(),
      outputSchema: harnessRunInputSchema.passthrough(),
      execute: async (input, ctx) => {
        seen.prompts.push(input.prompt);
        seen.cwds.push(await feeds.cwd(ctx));
        return input;
      },
    });
    return sequencer({ name: "goal-recorded-harness", inputSchema: harnessRunInputSchema.passthrough() })
      .step(before)
      .step(inner as never) as unknown as HarnessBlock;
  };
}

type Verdict = { choice: "done" | "not-done" | "ask"; confidence: number };

/**
 * The chief of staff's model: its first turn files one coder task with `goal`;
 * every other step answers "Noted." Jev, the judge, answers `verdict`.
 */
function models(goal: string, verdict: Verdict): ModelResolver {
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
  const jev = {
    specificationVersion: "v4",
    provider: "goal",
    modelId: "goal/jev",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { questions: Record<string, unknown> }) {
      // Best fit's route: no pick, so the chief of staff's judgment takes the message.
      if (!("verdict" in call.questions)) throw new Error("no route in this check");
      return {
        answers: { verdict: { type: "choice", choice: verdict.choice }, why: { type: "choice", choice: "off-target" } },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: { typesafe: { confidence: { verdict: verdict.confidence } } },
      };
    },
  };
  return Object.assign((_id: string, block?: string) => (block?.startsWith("coordinator-judgment") ? judgment : helper), {
    resolveId: (id: string) => id,
    resolveEvaluationModel: () => jev,
  }) as unknown as ModelResolver;
}

interface Host {
  lab: Lab;
  taskId: string;
  inbox(): Promise<InboxItem<unknown>[]>;
  itemOf(): Promise<InboxItem<unknown> | undefined>;
  task(): Promise<Record<string, any> | undefined>;
  act(action: string, input: unknown): Promise<{ output?: any; error?: unknown }>;
  review(answer: { verdict: "accepted" } | { verdict: "revise"; words: string }): Promise<string>;
  until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T>;
  close(): Promise<void>;
}

interface Setup {
  label: string;
  slot: (feeds: any) => HarnessBlock;
  verdict?: Verdict;
  reviewChanges?: boolean;
  userDeadlineMs?: number;
}

/**
 * Open the DevTeam Lab on a durable SQLite store and serve it. The first open
 * files one coder task from a conversation; `reopen` opens the same store and
 * checkouts again, as a restarted host, and files nothing.
 */
async function open(setup: Setup, reopen?: { conversation: string; taskId: string }): Promise<Host & { conversation: string }> {
  const root = join(SCRATCH, `${setup.label}-${RUN_STAMP}`);
  const remoteLabel = `runs-changes-review-${setup.label}`;
  if (reopen === undefined) mkdirSync(join(root, "runs"), { recursive: true });
  const remote = reopen === undefined ? createBareRemote(remoteLabel, { seed: { "README.md": "# Storefront\n" } }) : remotes.get(setup.label)!;
  remotes.set(setup.label, remote);
  const lab = await openLab({
    stores: sqliteStores({ filename: join(root, "lab.sqlite") }),
    harness: setup.slot as never,
    runTimeoutMs: 30_000,
    workspace: { root: join(root, "runs"), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    devtool: true,
    reviewChanges: setup.reviewChanges ?? true,
    ...(setup.userDeadlineMs === undefined ? {} : { userDeadlineMs: setup.userDeadlineMs }),
    sweepIntervalMs: 200,
    projects: [{ id: "storefront", title: "Storefront", repository: remote.url }],
    modelResolver: models(fixture.goal, setup.verdict ?? { choice: "done", confidence: fixture.judge.confidence }),
    logger: silentLogger,
    log: () => undefined,
  } as never);
  const handle = await serve(lab.state, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  const devtool = lab.state.meta.devtool!;
  const client = connect({ baseUrl: `http://127.0.0.1:${handle.port}`, userId: devtool.userId ?? LAB_USER_ID, bearerToken: devtool.bearerToken! });
  const runtime = await lab.state.getRuntime();

  const conversation = reopen?.conversation ?? `s-goal-review-${RUN_STAMP}-${setup.label}`;
  const act: Host["act"] = async (action, input) =>
    (await runAction({
      orgId: LAB_ORG_ID,
      flow: runtime.registry.get("coordinator") as FlowInstance,
      actionName: action,
      input,
      userId: LAB_USER_ID,
      sessionId: conversation,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never)) as { output?: any; error?: unknown };
  const until: Host["until"] = async (read, done, ms) => {
    let last = await read();
    for (const deadline = Date.now() + ms; !done(last) && Date.now() < deadline; last = await read()) await sleep(250);
    return last;
  };

  let taskId = reopen?.taskId;
  if (taskId === undefined) {
    const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId: conversation, state: { workerId: COS } } });
    if (created.status !== 201) throw new Error(`setup: opening the conversation answered ${created.status}`);
    const filed = await act("respond", { message: "Please have the coder do this." });
    if (filed.error !== undefined) throw new Error(`setup: the conversation's turn failed: ${show(filed.error)}`);
    const listed = await until(async () => ((await act(LIST_TASKS_ACTION, {})).output?.tasks ?? []) as Array<Record<string, any>>, (tasks) => tasks.length > 0, 10_000);
    taskId = listed[0]?.id as string | undefined;
    if (taskId === undefined) throw new Error("setup: the conversation filed no task for the coder");
  }
  const id = taskId;

  const inbox = async (): Promise<InboxItem<unknown>[]> => {
    const snapshot = await createLabReader(client).read();
    if (!("inbox" in snapshot) || snapshot.inbox === undefined) throw new Error(`Shift Manager's read came back ${show(snapshot)}`);
    if (!snapshot.inbox.ok) throw new Error(`Shift Manager's Inbox didn't load: ${snapshot.inbox.failure.message}`);
    return snapshot.inbox.value as InboxItem<unknown>[];
  };
  const itemOf = async () => (await inbox()).find((item) => item.task?.taskId === id);
  const task = async () => {
    const read = await act("getTask_tasks", { id });
    return read.output?.ok === true ? (read.output.task as Record<string, any>) : undefined;
  };
  const review: Host["review"] = async (answer) => {
    const item = await itemOf();
    if (item === undefined) return "no item";
    try {
      await createInboxClient(client).answer(item, { value: answer } as never);
      return "ok";
    } catch (error) {
      return (error as Error).message;
    }
  };
  return {
    lab,
    conversation,
    taskId: id,
    inbox,
    itemOf,
    task,
    act,
    review,
    until,
    close: async () => {
      await handle.close?.();
      await lab.dispose();
    },
  };
}
const remotes = new Map<string, { url: string }>();

/** The task's open review: a hold of the run's own stop, asking for a review. */
const reviewOf = (task: Record<string, any> | undefined) =>
  task?.status === "in_progress" ? (task.holds ?? []).find((hold: any) => hold.source?.kind === "suspension" && hold.ask?.kind === "review") : undefined;
const questionOf = (task: Record<string, any> | undefined) =>
  task?.status === "in_progress" ? (task.holds ?? []).find((hold: any) => hold.source?.kind === "row" && hold.ask?.kind === "question") : undefined;
const isSettled = (task: Record<string, any> | undefined) => ["completed", "errored", "cancelled", "pending"].includes(task?.status);
const isWaiting = (task: Record<string, any> | undefined) => reviewOf(task) !== undefined || questionOf(task) !== undefined || isSettled(task);
const lockFree = (cwd: string | undefined) => cwd !== undefined && !existsSync(`${cwd}.lock`);
const lastSubject = (cwd: string | undefined) =>
  cwd !== undefined && existsSync(cwd) ? execFileSync("git", ["log", "--format=%s", "-1"], { cwd, encoding: "utf8" }).trim() : "";

/** A stub run that commits one line to the fixture's file with `subject`. */
function commits(subject: string) {
  return (run: StubRun) => {
    writeFileSync(join(run.cwd, fixture.file), `- ${subject}\n`, { flag: "a" });
    commitAll(run.cwd, subject);
  };
}

/** A stub coder: run `n` (1-based) does `script[n - 1]`; a run marked `fails` errors. */
function stub(script: Array<((run: StubRun) => void) | undefined>, fails: Set<number> = new Set()) {
  let n = 0;
  return harnessStub({
    finalMessage: "I made the change.",
    duringRun: async (run) => {
      n += 1;
      script[n - 1]?.(run);
    },
    statusOf: () => (fails.has(n) ? "errored" : "completed"),
  });
}

const fresh = (): Seen => ({ prompts: [], resumes: [], cwds: [], confirmed: new Map() });

// ---- the legs -----------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  const fail = (tag: string, what: string) => failures.push(`${tag} — ${what}`);

  // ---- a, b: a run commits, and is accepted ---------------------------------------
  if (LEGS.has("a") || LEGS.has("b")) {
    const seen = fresh();
    const host = await open({ label: "ab", slot: recorded(stub([commits(fixture.subjects[0])]).slot as never, seen) });
    try {
      const waiting = await host.until(host.task, isWaiting, 30_000);
      await sleep(500);
      const hold = reviewOf(waiting);
      const item = await host.itemOf();
      tell.over("a · the runs", seen.prompts);
      if (hold === undefined) fail("a:waits", `the task is ${waiting?.status} with holds ${show(waiting?.holds ?? [])}, output ${show(waiting?.output ?? null)}; not waiting on a review`);
      else {
        const prompt = String(hold.ask.prompt);
        const judged = `The judge: done (${fixture.judge.confidence.toFixed(2)})`;
        if (!prompt.includes("1 commit") || !prompt.includes(fixture.subjects[0]) || !prompt.includes(judged)) {
          fail("a:prompt", `the review's prompt ${show(prompt)} doesn't name the commit count, its subject and the judge's verdict and confidence`);
        }
        if (item?.holds.length !== 1 || item.holds[0]!.ask.kind !== "review") fail("a:inbox", `the Inbox's item for it holds ${show(item?.holds.map((h) => h.ask.kind) ?? null)}`);
      }
      if (waiting?.attempts !== 1 || waiting?.leaseUntil != null) fail("a:attempt-1-no-lease", `attempts ${waiting?.attempts}, lease ${show(waiting?.leaseUntil)}`);
      if (!lockFree(seen.cwds[0])) fail("a:checkout-free", `the checkout's lock ${seen.cwds[0]}.lock is still there`);
      if (seen.prompts.length !== 1) fail("a:one-run", `${seen.prompts.length} harness runs`);
      if (!failures.some((f) => f.startsWith("a:"))) evidence.push(`a: waiting on a review "${String(hold.ask.prompt).split("\n").slice(0, 2).join(" ")}…", attempt 1, the checkout free, one run`);

      if (LEGS.has("b") && hold !== undefined) {
        const sent = await host.review({ verdict: "accepted" });
        if (sent !== "ok") fail("b:answered", `the Inbox's accept was refused: ${sent}`);
        const done = await host.until(host.task, isSettled, 30_000);
        if (done?.status !== "completed" || done.output?.review !== "accepted") fail("b:accepted", `the task ended ${done?.status}, output ${show(done?.output ?? null)}`);
        if (seen.prompts.length !== 1) fail("b:no-run", `${seen.prompts.length} harness runs; an accept starts none`);
        if ((await host.itemOf()) !== undefined) fail("b:item-closed", "the task's Inbox item is still listed");
        if (!failures.some((f) => f.startsWith("b:"))) evidence.push(`b: accepted in the Inbox, completed with review "accepted", one run`);
      }
    } finally {
      await host.close();
    }
  }

  // ---- c: changes requested, after a restart --------------------------------------
  if (LEGS.has("c")) {
    const seen = fresh();
    const slot = recorded(stub([commits(fixture.subjects[0]), commits(fixture.subjects[1])]).slot as never, seen);
    const first = await open({ label: "c", slot });
    let host: Host = first;
    try {
      const waiting = await first.until(first.task, isWaiting, 30_000);
      if (reviewOf(waiting) === undefined) fail("c:waits", `the task is ${waiting?.status}, not waiting on a review`);
      else {
        // The host restarts between the stop and the revision.
        await first.close();
        host = await open({ label: "c", slot }, { conversation: first.conversation, taskId: first.taskId });
        const sent = await host.review({ verdict: "revise", words: fixture.words });
        if (sent !== "ok") fail("c:answered", `the Inbox's request for changes was refused: ${sent}`);
        const again = await host.until(host.task, (t) => (reviewOf(t) !== undefined && seen.prompts.length >= 2) || isSettled(t), 30_000);
        const hold = reviewOf(again);
        if (hold === undefined || !String(hold.ask.prompt).includes("2 commits") || !String(hold.ask.prompt).includes(fixture.subjects[1])) {
          fail("c:reviewed-again", `after the revision the task is ${again?.status}, holds ${show(again?.holds ?? [])}`);
        } else {
          const accepted = await host.review({ verdict: "accepted" });
          if (accepted !== "ok") fail("c:answered", `the second accept was refused: ${accepted}`);
        }
        const done = await host.until(host.task, isSettled, 30_000);
        tell.over("c · the runs", seen.prompts);
        if (done?.attempts !== 1) fail("c:attempt-1", `the task is on attempt ${done?.attempts}; a revision spends no try`);
        if (done?.status !== "completed" || done.output?.review !== "accepted") fail("c:completed", `the task ended ${done?.status}, output ${show(done?.output ?? null)}`);
        if (seen.prompts.length !== 2) fail("c:two-runs", `${seen.prompts.length} harness runs`);
        if (seen.resumes[1] !== seen.confirmed.get(1) || seen.resumes[1] == null) fail("c:same-session", `the revision's run resumed ${show(seen.resumes[1])}; the first confirmed ${show(seen.confirmed.get(1))}`);
        if (!(seen.prompts[1] ?? "").includes(fixture.words)) fail("c:the-words", "the revision's run's prompt doesn't carry the words");
        if (!failures.some((f) => f.startsWith("c:"))) evidence.push(`c: across a restart, the words reached run 2 on attempt 1, resuming ${seen.resumes[1]}; reviewed again on 2 commits; accepted`);
      }
    } finally {
      await host.close();
    }
  }

  // ---- c′: changes requested where no session was confirmed -----------------------
  if (LEGS.has("cprime")) {
    const seen = fresh();
    const host = await open({ label: "cprime", slot: recorded(stub([commits(fixture.subjects[0]), commits(fixture.subjects[1])]).slot as never, seen, new Set([1])) });
    try {
      const waiting = await host.until(host.task, isWaiting, 30_000);
      if (reviewOf(waiting) === undefined) fail("cprime:waits", `the task is ${waiting?.status}, not waiting on a review`);
      else {
        const sent = await host.review({ verdict: "revise", words: fixture.words });
        if (sent !== "ok") fail("cprime:answered", `the request for changes was refused: ${sent}`);
        const second = await host.until(host.task, (t) => (t?.attempts ?? 0) >= 2 && isWaiting(t), 30_000);
        tell.over("cprime · the runs", seen.prompts);
        if (second?.attempts !== 2) fail("cprime:try-failed", `the task is on attempt ${second?.attempts}; with no session to continue, the revision fails try 1`);
        if (!(seen.prompts[1] ?? "").includes(fixture.words)) fail("cprime:next-brief", "try 2's brief doesn't carry the words");
        if (!failures.some((f) => f.startsWith("cprime:"))) evidence.push("cprime: no session confirmed, try 1 failed, try 2's brief had the words");
      }
    } finally {
      await host.close();
    }
  }

  // ---- d: no commits ---------------------------------------------------------------
  if (LEGS.has("d")) {
    const seen = fresh();
    const host = await open({ label: "d", slot: recorded(stub([undefined]).slot as never, seen) });
    try {
      const done = await host.until(host.task, isWaiting, 30_000);
      tell.over("d · the runs", seen.prompts);
      if (done?.status !== "completed" || done.output?.review !== null || reviewOf(done) !== undefined) fail("d:no-review", `the task is ${done?.status}, output ${show(done?.output ?? null)}`);
      if (!failures.some((f) => f.startsWith("d:"))) evidence.push("d: no commits, completed with review null");
    } finally {
      await host.close();
    }
  }

  // ---- e: a failed run ----------------------------------------------------------------
  if (LEGS.has("e")) {
    const seen = fresh();
    const host = await open({ label: "e", slot: recorded(stub([commits(fixture.subjects[0])], new Set([1])).slot as never, seen) });
    try {
      const failed = await host.until(host.task, (t) => isSettled(t) || reviewOf(t) !== undefined || (t?.attempts ?? 0) >= 2, 30_000);
      tell.over("e · the runs", seen.prompts);
      if (reviewOf(failed) !== undefined) fail("e:no-review", "a failed run waits on a review");
      if (!(failed?.status === "pending" || failed?.status === "errored" || (failed?.attempts ?? 0) >= 2)) fail("e:try-failed", `the task is ${failed?.status} on attempt ${failed?.attempts}`);
      if (!failures.some((f) => f.startsWith("e:"))) evidence.push(`e: the failed run failed its try (${failed?.status}, attempt ${failed?.attempts}), no review`);
    } finally {
      await host.close();
    }
  }

  // ---- f: the host's deadline, and none ---------------------------------------------
  if (LEGS.has("f")) {
    const seen = fresh();
    const host = await open({ label: "f", userDeadlineMs: 1_500, slot: recorded(stub([commits(fixture.subjects[0])]).slot as never, seen) });
    try {
      const done = await host.until(host.task, isSettled, 30_000);
      tell.over("f · the runs", seen.prompts);
      if (done?.status !== "completed" || done.output?.review !== "deadline") fail("f:deadline", `the task is ${done?.status}, output ${show(done?.output ?? null)}`);
      if (seen.prompts.length !== 1) fail("f:no-run", `${seen.prompts.length} harness runs`);
    } finally {
      await host.close();
    }
    const unset = fresh();
    const open2 = await open({ label: "f-unset", slot: recorded(stub([commits(fixture.subjects[0])]).slot as never, unset) });
    try {
      await open2.until(open2.task, isWaiting, 30_000);
      await sleep(2_000);
      const still = await open2.task();
      if (reviewOf(still) === undefined || unset.prompts.length !== 1) fail("f:no-deadline", `with no deadline set, the task is ${still?.status} after ten sweeps, ${unset.prompts.length} runs`);
    } finally {
      await open2.close();
    }
    if (!failures.some((f) => f.startsWith("f:"))) evidence.push(`f: at the host's deadline, completed with review "deadline", no run; with none, still waiting after ten sweeps`);
  }

  // ---- g: cancelled while it waits --------------------------------------------------
  if (LEGS.has("g")) {
    const seen = fresh();
    const kept = `kept ${RUN_STAMP}\n`;
    const host = await open({
      label: "g",
      slot: recorded(
        stub([
          (run) => {
            commits(fixture.subjects[0])(run);
            const project = join(dirname(run.cwd), "project");
            if (existsSync(project)) writeFileSync(join(project, "notes.md"), kept);
          },
        ]).slot as never,
        seen,
      ),
    });
    try {
      const waiting = await host.until(host.task, isWaiting, 30_000);
      if (reviewOf(waiting) === undefined) fail("g:waits", `the task is ${waiting?.status}`);
      const cancelled = await host.act(UPDATE_TASK_ACTION, { id: host.taskId, status: "cancelled" });
      if (cancelled.output?.ok !== true) fail("g:cancelled", `the cancel was refused: ${show(cancelled.output ?? cancelled.error)}`);
      const done = await host.until(host.task, (t) => t?.status === "cancelled" && (t.holds ?? []).length === 0, 10_000);
      await sleep(1_000);
      tell.over("g · the runs", seen.prompts);
      if (done?.status !== "cancelled" || (done.holds ?? []).length !== 0) fail("g:closed", `the task is ${done?.status} with holds ${show(done?.holds ?? [])}`);
      if (seen.prompts.length !== 1) fail("g:no-run", `${seen.prompts.length} runs after the cancel`);
      if (lastSubject(seen.cwds[0]) !== fixture.subjects[0]) fail("g:branch-commit", `the checkout's last commit is ${show(lastSubject(seen.cwds[0]))}`);
      const stored = Object.entries(await host.lab.stored("org")).filter(([key]) => key.includes("project-files/") && key.endsWith("notes.md"));
      if (seen.cwds[0] !== undefined && existsSync(join(dirname(seen.cwds[0]), "project")) && stored.length === 0) fail("g:kept-files", "the run's kept file is not saved");
      if ((await host.itemOf()) !== undefined) fail("g:item-closed", "the cancelled task's Inbox item is still listed");
      if (!failures.some((f) => f.startsWith("g:"))) evidence.push(`g: cancelled while it waited; the review closed, no run, the commit on its branch, ${stored.length} kept file(s) saved`);
    } finally {
      await host.close();
    }
  }

  // ---- h: the option off ------------------------------------------------------------
  if (LEGS.has("h")) {
    const seen = fresh();
    const host = await open({ label: "h", reviewChanges: false, slot: recorded(stub([commits(fixture.subjects[0])]).slot as never, seen) });
    try {
      const done = await host.until(host.task, isWaiting, 30_000);
      tell.over("h · the runs", seen.prompts);
      if (done?.status !== "completed" || done.output?.review !== null) fail("h:as-before", `the task is ${done?.status}, output ${show(done?.output ?? null)}`);
      if (!failures.some((f) => f.startsWith("h:"))) evidence.push("h: without the option, completed on the verdict, review null");
    } finally {
      await host.close();
    }
  }

  // ---- i: the judge asks ------------------------------------------------------------
  if (LEGS.has("i")) {
    const seen = fresh();
    const host = await open({ label: "i", verdict: { choice: "ask", confidence: 0.9 }, slot: recorded(stub([commits(fixture.subjects[0])]).slot as never, seen) });
    try {
      const held = await host.until(host.task, isWaiting, 30_000);
      tell.over("i · the runs", seen.prompts);
      if (questionOf(held) === undefined || reviewOf(held) !== undefined) fail("i:question", `the task is ${held?.status} with holds ${show(held?.holds ?? [])}`);
      if (!failures.some((f) => f.startsWith("i:"))) evidence.push("i: the judge's ask held a question, no review");
    } finally {
      await host.close();
    }
  }

  rmSync(SCRATCH, { recursive: true, force: true });
  return { failures, evidence: evidence.join("; ") };
});

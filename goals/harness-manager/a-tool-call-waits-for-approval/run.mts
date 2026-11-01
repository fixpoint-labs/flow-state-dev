/**
 * Goal check — harness-manager › a tool call waits for approval.
 *
 * The DevTeam Lab's coder (the harness manager) with `approveTools` on, on a
 * durable SQLite host with trace observability off, its harness the
 * package's stub making scripted tool calls through the approval feed. A call
 * the harness asks about stops the run and waits on the person as the task's
 * hold; the answer goes through the Inbox client, as Shift Manager's Inbox
 * sends it, and resumes the coding session that asked.
 *
 * Legs (`GOAL_LEGS=a,b,c,d`; unset runs all; b and c share a's host):
 *
 *   a  a run makes a shell call: the task waits on one approval naming the
 *      tool, the command and the folder; the Inbox lists it; the call did not run
 *   c  the host restarts, Allow in the Inbox: the next step resumes the
 *      session that asked, on attempt 1
 *   b  the command ran once, after the answer; an edit to a file waits and
 *      passes the same way (Allow for this run), and the task completes
 *   d  Deny in the Inbox with a note: the command never ran, the session was
 *      told with the note, and the run went on to complete
 *
 * Controls (`GOAL_CONTROL`): `no-approval` (the feed is never handed) must
 * FAIL `a:waits`; `grant-ignored` (a grant never matches) must FAIL
 * `b:ran-after`. Each is a scratch patch applied as the code loads, printed by
 * the run, and refused when it never reached the code.
 *
 * Run: pnpm tsx goals/harness-manager/a-tool-call-waits-for-approval/run.mts
 */
// Traces off before anything reads the flag: a resume must run no completed step again without them.
process.env.FSDEV_TRACE_OBSERVABILITY = "0";

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handler, harnessRunInputSchema, sequencer } from "@flow-state-dev/core";
import type { FlowInstance, GeneratorModel, HarnessBlock, ModelResolver } from "@flow-state-dev/core/types";
import { runAction } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { createInboxClient, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, loadFixture, modulePatchEnv, runGoal, silentLogger, stripIntentOverrides, type ModulePatch } from "../../lib/index.mts";
import { ALLOW_FOR_RUN, harnessStub, type HarnessStub, type HarnessToolApprovalHook, type StubRun } from "@flow-state-dev/harness-manager";
import { claudeCodeAgent, type ClaudeCodeAgentOptions } from "@flow-state-dev/claude-code/sdk";
import { claudeCodeEnv } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { createLabReader } from "../../../packages/shift-manager/src/lib/reads.ts";

stripIntentOverrides();

/**
 * The approval feed is claude-code's `onToolApproval`, structurally: neither
 * package imports the other, and a slot that spreads `...feeds` into
 * `claudeCodeAgent` passes it on. Red at typecheck when either side drifts.
 */
const feedFits = (hook: HarnessToolApprovalHook): ClaudeCodeAgentOptions["onToolApproval"] => hook;
void feedFits;

interface Fixture {
  goal: string;
  marker: string;
  edit: string;
  note: string;
  /** Leg r's task, for real Claude Code: one shell command that writes `marker`. */
  real: { goal: string; marker: string };
}
const fixture = loadFixture<Fixture>(import.meta.url);

const CODER = "eng.coder";
const SHIFT_COORDINATOR = "shift-coordinator";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
// Leg r runs real Claude Code, so it runs only when named: `GOAL_LEGS=r`.
const ALL_LEGS = ["a", "b", "c", "d"] as const;
const LEGS = new Set((process.env.GOAL_LEGS ?? ALL_LEGS.join(",")).split(",").map((leg) => leg.trim()).filter(Boolean));
const SCRATCH = goalTmpDir("tool-call-approval");
const MANAGER = "packages/harness-manager/src/manager.ts";
const APPROVAL = "packages/harness-manager/src/tool-approval.ts";

// ---- controls: scratch patches, applied in a child that loads them ----------------

const CONTROLS: Record<string, { patches: ModulePatch[]; must: string[]; legs: string }> = {
  "no-approval": {
    must: ["a:waits"],
    legs: "a",
    patches: [{ module: MANAGER, from: String.raw`\.\.\.\(approveTools \? \{ onToolApproval: askAboutToolCall \} : \{\}\),`, to: "...({})," }],
  },
  "grant-ignored": {
    must: ["b:ran-after"],
    legs: "a,b,c",
    patches: [{ module: APPROVAL, from: String.raw`return grant\.toolName === call\.toolName && grant\.key === call\.key;`, to: "return false;" }],
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

/** What the harness slot was handed, run by run (0-based), and the session each confirmed. */
interface Seen {
  prompts: string[];
  resumes: (string | null)[];
  cwds: string[];
  confirmed: string[];
}

/**
 * The slot, recorded: every prompt, the session each run was asked to resume,
 * and the one it confirmed. The approval feed reaches the stub untouched.
 */
function recorded(slot: (feeds: any) => HarnessBlock, seen: Seen) {
  return (feeds: any): HarnessBlock => {
    const inner = slot({
      ...feeds,
      resume: async (ctx: unknown) => {
        const resume = await feeds.resume(ctx);
        seen.resumes.push(resume);
        return resume;
      },
      onSession: async (sessionId: string, ctx: unknown) => {
        seen.confirmed.push(sessionId);
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

/** The Shift Coordinator's model files one coder task with `goal`; Jev, the judge, answers done. */
function models(goal: string): ModelResolver {
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
      if (!("verdict" in call.questions)) throw new Error("no route in this check");
      return {
        answers: { verdict: { type: "choice", choice: "done" }, why: { type: "choice", choice: "off-target" } },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: { typesafe: { confidence: { verdict: 0.9 } } },
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
  conversation: string;
  itemOf(): Promise<InboxItem<unknown> | undefined>;
  task(): Promise<Record<string, any> | undefined>;
  answer(answer: { approved: boolean; data?: unknown }): Promise<string>;
  until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T>;
  close(): Promise<void>;
}

const remotes = new Map<string, { url: string }>();

/**
 * Open the DevTeam Lab on a durable SQLite store with `approveTools` on and
 * serve it. The first open files one coder task from a conversation; `reopen`
 * opens the same store and checkouts again, as a restarted host.
 */
async function open(label: string, slot: (feeds: any) => HarnessBlock, reopen?: { conversation: string; taskId: string }, goal: string = fixture.goal): Promise<Host> {
  const root = join(SCRATCH, `${label}-${RUN_STAMP}`);
  if (reopen === undefined) mkdirSync(join(root, "runs"), { recursive: true });
  const remote = reopen === undefined ? createBareRemote(`tool-call-approval-${label}`, { seed: { "README.md": "# Storefront\n" } }) : remotes.get(label)!;
  remotes.set(label, remote);
  const lab = await openLab({
    stores: sqliteStores({ filename: join(root, "lab.sqlite") }),
    harness: slot as never,
    runTimeoutMs: label === "r" ? 180_000 : 30_000,
    workspace: { root: join(root, "runs"), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    inventory: true,
    devtool: true,
    approveTools: true,
    // The recording wrapper is a sequencer, which hides the stub's own `stopsOnAbort`.
    stopsOnAbort: true,
    sweepIntervalMs: 200,
    projects: [{ id: "storefront", title: "Storefront", repository: remote.url }],
    modelResolver: models(goal),
    logger: silentLogger,
    log: () => undefined,
  } as never);
  const handle = await serve(lab.state, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  const devtool = lab.state.meta.devtool!;
  const client = connect({ baseUrl: `http://127.0.0.1:${handle.port}`, userId: devtool.userId ?? LAB_USER_ID, bearerToken: devtool.bearerToken! });
  const runtime = await lab.state.getRuntime();

  const conversation = reopen?.conversation ?? `s-goal-approval-${RUN_STAMP}-${label}`;
  const act = async (action: string, input: unknown) =>
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
    const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId: conversation, state: { workerId: SHIFT_COORDINATOR } } });
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
  const answer: Host["answer"] = async (given) => {
    const item = await itemOf();
    if (item === undefined) return "no item";
    try {
      await createInboxClient(client).answer(item, given);
      return "ok";
    } catch (error) {
      return (error as Error).message;
    }
  };
  return {
    lab,
    conversation,
    taskId: id,
    itemOf,
    task,
    answer,
    until,
    close: async () => {
      await handle.close?.();
      await lab.dispose();
    },
  };
}

/** The task's open approval: a hold of the run's own stop, asking for an approval. */
const approvalOf = (task: Record<string, any> | undefined) =>
  task?.status === "in_progress" ? (task.holds ?? []).find((hold: any) => hold.source?.kind === "suspension" && hold.ask?.kind === "approval") : undefined;
const isSettled = (task: Record<string, any> | undefined) => ["completed", "errored", "cancelled", "pending"].includes(task?.status);
const isWaiting = (task: Record<string, any> | undefined) => approvalOf(task) !== undefined || isSettled(task);
/** An approval other than `than`'s, or the task settled. */
const nextApproval = (than: Record<string, any> | undefined) => (task: Record<string, any> | undefined) =>
  (approvalOf(task) !== undefined && approvalOf(task).id !== than?.id) || isSettled(task);

/** The scripted coder: one shell command that writes the fixture's marker, then one edit to a file. */
function coder(): HarnessStub {
  return harnessStub({
    finalMessage: "Marked as tested.",
    toolCalls: [
      {
        toolName: "Bash",
        input: { command: `touch ${fixture.marker}` },
        run: (run: StubRun) => writeFileSync(join(run.cwd, fixture.marker), `${Date.now()}\n`, { flag: "a" }),
      },
      {
        toolName: "Edit",
        input: { file_path: fixture.edit, old_string: "", new_string: "tested\n" },
        run: (run: StubRun) => {
          mkdirSync(dirname(join(run.cwd, fixture.edit)), { recursive: true });
          writeFileSync(join(run.cwd, fixture.edit), "tested\n");
        },
      },
    ],
  });
}

/** How many times the marker was written: the command's own record, in its folder. */
const markerWrites = (cwd: string | undefined) =>
  cwd !== undefined && existsSync(join(cwd, fixture.marker)) ? readFileSync(join(cwd, fixture.marker), "utf8").trim().split("\n").filter(Boolean) : [];

const fresh = (): Seen => ({ prompts: [], resumes: [], cwds: [], confirmed: [] });

// ---- the legs -----------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (tag: string, what: string) => failures.push(`${tag} — ${what}`);

  // ---- a, c, b: it waits; restart; Allow; the command ran after it ----------------
  if (LEGS.has("a") || LEGS.has("b") || LEGS.has("c")) {
    const seen = fresh();
    const stub = coder();
    const slot = recorded(stub.slot as never, seen);
    const first = await open("acb", slot);
    let host: Host = first;
    try {
      const waiting = await first.until(first.task, isWaiting, 30_000);
      await sleep(500);
      const hold = approvalOf(waiting);
      const item = await first.itemOf();
      const cwd = seen.cwds[0];
      if (hold === undefined) fail("a:waits", `the task is ${waiting?.status} with holds ${show(waiting?.holds ?? [])}; not waiting on an approval`);
      else {
        const prompt = String(hold.ask.prompt);
        if (!prompt.includes("Bash") || !prompt.includes(`touch ${fixture.marker}`) || cwd === undefined || !prompt.includes(cwd)) {
          fail("a:prompt", `the approval's prompt ${show(prompt)} doesn't name the tool, the command and the folder ${cwd}`);
        }
        if (item?.holds.length !== 1 || item.holds[0]!.ask.kind !== "approval") fail("a:inbox", `the Inbox's item for it has holds ${show(item?.holds.map((h) => h.ask.kind) ?? null)}`);
      }
      if (markerWrites(cwd).length !== 0) fail("a:not-ran", "the command ran before anyone answered");
      if (waiting?.attempts !== 1) fail("a:attempt-1", `attempt ${waiting?.attempts}`);
      if (seen.prompts.length !== 1) fail("a:one-run", `${seen.prompts.length} harness runs`);
      if (!failures.some((f) => f.startsWith("a:"))) evidence.push(`a: waiting on "${String(hold.ask.title)}" naming Bash, \`touch ${fixture.marker}\` and the folder; one Inbox item; the command unrun; one run`);

      if ((LEGS.has("b") || LEGS.has("c")) && hold !== undefined) {
        // The host restarts between the stop and the answer.
        await first.close();
        host = await open("acb", slot, { conversation: first.conversation, taskId: first.taskId });
        const answeredAt = Date.now();
        const sent = await host.answer({ approved: true });
        if (sent !== "ok") fail("c:answered", `the Inbox's Allow was refused: ${sent}`);
        const edit = await host.until(host.task, nextApproval(hold), 30_000);
        const editHold = approvalOf(edit);
        if (seen.prompts.length < 2 || seen.resumes[1] == null || seen.resumes[1] !== seen.confirmed[0]) {
          fail("c:same-session", `the step after the answer resumed ${show(seen.resumes[1] ?? null)}; the run that asked confirmed ${show(seen.confirmed[0] ?? null)}`);
        }
        if (edit?.attempts !== 1) fail("c:attempt-1", `the task is on attempt ${edit?.attempts}; an answer spends no try`);
        if (!failures.some((f) => f.startsWith("c:"))) evidence.push(`c: across a restart, Allow in the Inbox resumed ${seen.resumes[1]} on attempt 1`);

        const writes = markerWrites(seen.cwds[1] ?? cwd);
        const bashAllowed = stub.toolCalls.filter((call) => call.toolName === "Bash" && call.decision === "allow");
        if (writes.length !== 1 || Number(writes[0]) < answeredAt || bashAllowed.length !== 1) {
          fail("b:ran-after", `the command wrote its marker ${writes.length} time(s) (${show(writes)}), answered at ${answeredAt}; the harness allowed it ${bashAllowed.length} time(s)`);
        }
        if (editHold === undefined || !String(editHold.ask.prompt).includes(fixture.edit)) {
          fail("b:edit-waits", `after the command, the task is ${edit?.status} with holds ${show(edit?.holds ?? [])}; the edit doesn't wait on an approval naming ${fixture.edit}`);
        } else {
          const forRun = await host.answer({ approved: true, data: ALLOW_FOR_RUN.data });
          if (forRun !== "ok") fail("b:answered", `the Inbox's Allow for this run was refused: ${forRun}`);
          const done = await host.until(host.task, isSettled, 30_000);
          // One try: the run that asked, the step each answer resumed, nothing more.
          if (done?.status !== "completed" || done.attempts !== 1) fail("b:completed", `the task ended ${done?.status} on attempt ${done?.attempts}`);
          if (seen.prompts.length !== 3) fail("b:three-runs", `${seen.prompts.length} harness runs; the run that asked and one per answer is three`);
          const edited = seen.cwds.at(-1);
          if (edited === undefined || !existsSync(join(edited, fixture.edit))) fail("b:edit-ran", `the edit's file ${fixture.edit} isn't in the run's folder`);
          if (!failures.some((f) => f.startsWith("b:"))) {
            evidence.push(`b: the command ran once, after the answer; the edit to ${fixture.edit} waited and passed on Allow for this run; completed in ${seen.prompts.length} runs`);
          }
        }
      }
    } finally {
      await host.close();
    }
  }

  // ---- d: Deny, with a note ---------------------------------------------------------
  if (LEGS.has("d")) {
    const seen = fresh();
    const stub = coder();
    const host = await open("d", recorded(stub.slot as never, seen));
    try {
      const waiting = await host.until(host.task, isWaiting, 30_000);
      const hold = approvalOf(waiting);
      if (hold === undefined) fail("d:waits", `the task is ${waiting?.status}, not waiting on an approval`);
      else {
        const sent = await host.answer({ approved: false, data: { note: fixture.note } });
        if (sent !== "ok") fail("d:answered", `the Inbox's Deny was refused: ${sent}`);
        // The run goes on to its edit, which waits in turn: allowed, the run completes.
        const next = await host.until(host.task, nextApproval(hold), 30_000);
        if (approvalOf(next) !== undefined) await host.answer({ approved: true });
        const done = await host.until(host.task, isSettled, 30_000);
        if (markerWrites(seen.cwds[0]).length !== 0 || stub.toolCalls.some((call) => call.toolName === "Bash" && call.decision === "allow")) {
          fail("d:never-ran", "the denied command ran");
        }
        if (!(seen.prompts[1] ?? "").includes(fixture.note)) fail("d:told", `the step after the Deny wasn't told the note: ${show(seen.prompts[1] ?? null)}`);
        if (done?.status !== "completed" || done.attempts !== 1) fail("d:went-on", `the task ended ${done?.status} on attempt ${done?.attempts}`);
        if (!failures.some((f) => f.startsWith("d:"))) evidence.push(`d: denied with a note, the command never ran, the session was told, and the run completed on attempt 1`);
      }
    } finally {
      await host.close();
    }
  }

  // ---- r: the same on real Claude Code, `default` mode, Bash not pre-allowed --------
  if (LEGS.has("r")) {
    const seen = fresh();
    const slot = recorded(
      ({ mcpTools: _mcp, ...feeds }: any) =>
        claudeCodeAgent({
          ...feeds,
          env: claudeCodeEnv(),
          detached: true,
          allowedTools: ["Read"],
          permissionMode: "default",
          systemPrompt: "You are a coding agent working in the directory you have been placed in. Do exactly what your task says, and nothing else.",
        } as never) as unknown as HarnessBlock,
      seen,
    );
    const first = await open("r", slot, undefined, fixture.real.goal);
    let host: Host = first;
    try {
      const waiting = await first.until(first.task, isWaiting, 180_000);
      const hold = approvalOf(waiting);
      const marker = () => seen.cwds[0] !== undefined && existsSync(join(seen.cwds[0], fixture.real.marker));
      if (hold === undefined) fail("r:waits", `the task is ${waiting?.status} with holds ${show(waiting?.holds ?? [])}; not waiting on an approval`);
      else if (!String(hold.ask.prompt).includes("Bash") || !String(hold.ask.prompt).includes(fixture.real.marker)) {
        fail("r:prompt", `the approval's prompt ${show(hold.ask.prompt)} doesn't name Bash and the command`);
      }
      if (marker()) fail("r:not-ran", "the marker is there before anyone answered");
      if (hold !== undefined) {
        await first.close();
        host = await open("r", slot, { conversation: first.conversation, taskId: first.taskId }, fixture.real.goal);
        const answeredAt = Date.now();
        const sent = await host.answer({ approved: true });
        if (sent !== "ok") fail("r:answered", `the Inbox's Allow was refused: ${sent}`);
        const after = await host.until(async () => ({ task: await host.task(), ran: marker() }), (v) => v.ran || isSettled(v.task) || nextApproval(hold)(v.task), 180_000);
        const latencyMs = Date.now() - answeredAt;
        if (seen.resumes[1] == null || seen.resumes[1] !== seen.confirmed[0]) {
          fail("r:same-session", `the step after the answer resumed ${show(seen.resumes[1] ?? null)}; the run that asked confirmed ${show(seen.confirmed[0] ?? null)}`);
        }
        if (!after.ran) fail("r:ran-after", `no marker after Allow; the task is ${after.task?.status} with holds ${show(after.task?.holds ?? [])}`);
        const done = await host.until(host.task, isSettled, 180_000);
        if (!failures.some((f) => f.startsWith("r:"))) {
          evidence.push(`r: real Claude Code waited on Bash \`touch ${fixture.real.marker}\` unrun; across a restart Allow resumed ${seen.resumes[1]} and the marker appeared ${latencyMs} ms after the answer; the task ended ${done?.status}`);
        }
      }
    } finally {
      await host.close();
    }
  }

  rmSync(SCRATCH, { recursive: true, force: true });
  return { failures, evidence: evidence.join("; ") };
});

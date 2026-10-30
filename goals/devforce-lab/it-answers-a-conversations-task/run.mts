/**
 * Goal check — a coordinator files a task for the DevTeam coder from a
 * conversation, the coder answers it from the right project's code, and the
 * conversation hears the answer once; a task that can't run is heard failing.
 *
 * The DevTeam lab, opened as its profile is served, driven over its HTTP door
 * as the lab's owner, as Shift Manager drives it: a conversation is opened on
 * the coordinator's flow, a turn is sent, and the conversation's lines are
 * read back. The coder's harness is the lab's scripted stub in every leg: it
 * reads one file in its working folder and puts it in its last message, so
 * only a run that worked in the project's code can say the marker. Each
 * marker is a random string committed to a project's repository, or written
 * to a project's files, after the lab opens. It never appears in a task, a
 * prompt or a brief.
 *
 * Legs:
 *
 *   a   the shift coordinator (the Shift Coordinator) files a task naming
 *       storefront; one completed line under eng.coder carries the marker, its
 *       run worked in a checkout of its own, and storefront's branches are as
 *       they were.
 *   b   a workstream's conversation in a second project files a task that
 *       names nothing: the run works in that project's repository. Then in
 *       sandbox, which has no repository, on the project's files.
 *   c   a task naming no project, one naming a project the person isn't a
 *       member of, a run that throws twice, and a run that answers without
 *       reading the code while the judge says not done: each one errored line
 *       saying why, no row left running.
 *   d   a real model as the coordinator and Jev as the judge: the ask a person
 *       types files a task naming storefront, and the line carries the marker.
 *   d2  the same ask, with a run that answers off the point: under Jev it
 *       ends errored with Jev's reason on the line.
 *
 * Legs a to c script the coordinator and the judge through the lab's model
 * resolver. Legs d and d2 run only when a key serves both models.
 *
 * Controls:
 *
 *   no-filing-project  the hand-over drops the project the conversation works
 *                      in. Must FAIL leg b on carrying the marker.
 *   no-judge           the coder runs with no judge. Must FAIL leg d2 on
 *                      ends errored.
 *
 * `GOAL_CONTROL=list` prints them. `GOAL_LEGS=a,b` runs only those legs.
 *
 * Run: pnpm tsx goals/devforce-lab/it-answers-a-conversations-task/run.mts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createModelResolver } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { DEFAULT_MODEL, gatewayModel, keysServing, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { harnessStub, type StubRun } from "@flow-state-dev/harness-manager";
import { LAB_USERS, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { JUDGE_MODEL } from "../../../packages/shift-manager/teams/devteam/judge.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["no-filing-project", "no-judge"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
const LEGS = new Set((process.env.GOAL_LEGS ?? "a,b,c,d,d2").split(",").map((leg) => leg.trim()));

interface Fixture {
  markerFile: string;
  secondProject: { id: string; title: string };
  workstream: { id: string; title: string };
  strangersProject: { id: string; title: string };
  ask: string;
  notFound: string;
  offPoint: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);

/** The worker a coordinator files the coder's tasks for, and the Shift Coordinator. */
const CODER = "eng.coder";
const SHIFT_COORDINATOR = "shift-coordinator";
/** A worker of the person's own on `agent`, hired to lead workstreams: it files the coder's tasks. */
const WORKSTREAM_LEAD = "workstream-lead";
/** The flows a conversation runs on: the Shift Coordinator's, and a workstream lead's. */
const COORDINATOR_FLOW = "coordinator";
const AGENT_FLOW = "agent";
const LIST_TASKS = "listTasks_tasks";
/** A filing turn's own time, outside its model's calls: over it, the turn stalled on the framework's side. */
const TURN_BUDGET_MS = 10_000;
const LINE_BUDGET_MS = 60_000;
const SETTLED = new Set(["completed", "errored", "cancelled"]);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown, n = 300): string => (JSON.stringify(value) ?? "undefined").slice(0, n);

// ---- the coder's harness: the lab's stub, told what each run does ----------

/** What the next run does: read the marker, write one, throw, or say a fixed line. */
type RunMode = { kind: "read" } | { kind: "plant"; body: string } | { kind: "throw"; message: string } | { kind: "say"; text: string };
let mode: RunMode = { kind: "read" };

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

const stub = harnessStub({
  duringRun: (run: StubRun) => {
    if (mode.kind === "throw") throw new Error(mode.message);
    if (mode.kind === "plant") write(join(run.cwd, fixture.markerFile), mode.body);
  },
  finalMessage: (run: StubRun) => {
    if (mode.kind === "say") return mode.text;
    if (mode.kind === "plant") return "Noted it in the project's files.";
    const at = join(run.cwd, fixture.markerFile);
    if (!existsSync(at)) return fixture.notFound;
    // What a look at a two-file repository finds, said as plainly as a person would.
    const files = readdirSync(run.cwd).filter((entry) => !entry.startsWith("."));
    return (
      `I read the code in this project. It holds ${files.length} file(s): ${files.join(", ")}. ` +
      `${fixture.markerFile} reads ${readFileSync(at, "utf8").trim()}. There is no other code yet, so there is nothing to fix.`
    );
  },
});

// ---- the scripted coordinator and judge, legs a to c ----------------------

type ToolCall = { toolName: string; args: Record<string, unknown> };
type Verdict = { choice: string; why?: string; confidence: number };
/** The next turn's tool calls, per conversation kind, and the judge's next verdicts; each consumed once. */
const script = { coordinator: [] as ToolCall[], agent: [] as ToolCall[], verdicts: [] as Verdict[] };

/** A turn's model: makes the scripted calls one step each, then says it filed. */
function scriptedTurn(queue: () => ToolCall[]): GeneratorModel {
  return {
    modelId: "goal/scripted",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      const call = queue().shift();
      if (call === undefined) return { text: "Filed it.", finishReason: "stop" };
      return { toolCalls: [{ toolCallId: `t-${globalThis.crypto.randomUUID()}`, ...call }], finishReason: "tool-calls" };
    },
  } as unknown as GeneratorModel;
}

function scriptedResolver(): ModelResolver {
  const coordinator = scriptedTurn(() => script.coordinator);
  const agent = scriptedTurn(() => script.agent);
  const judge = {
    specificationVersion: "v4",
    provider: "goal",
    modelId: "goal/judge",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { questions: Record<string, unknown> }) {
      // The Shift Coordinator's best-fit route: no pick, so its own judgment takes the post.
      if (!("verdict" in call.questions)) throw new Error("no route in this check");
      const next = script.verdicts.shift() ?? { choice: "done", confidence: 0.95 };
      return {
        answers: {
          verdict: { type: "choice", choice: next.choice },
          // Jev answers every question it is asked; why is read only for not done.
          why: { type: "choice", choice: next.why ?? "off-target" },
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        providerMetadata: { typesafe: { confidence: { verdict: next.confidence } } },
      };
    },
  };
  // Best fit's question goes unanswered (the judge above has no route either), so the post
  // reaches the Shift Coordinator's own turn, which makes the scripted call.
  const resolve = (_id: string, block?: string): GeneratorModel => {
    if (block === "coordinator-route-ask") throw new Error("no route model in this check");
    return block?.startsWith("agent") ? agent : coordinator;
  };
  return Object.assign(resolve, {
    resolveId: (id: string) => id,
    resolveEvaluationModel: () => judge,
  }) as unknown as ModelResolver;
}

/** What real Jev answered the judge's question, in order. */
const verdicts: Array<{ choice: unknown; confidence: unknown; state: unknown }> = [];

/** When a generator model was answering, legs d and d2: [start, end] in ms. Jev's evaluations are not in it. */
const modelSpans: Array<[number, number]> = [];

/** How long, between `from` and `to`, some generator model call was in flight. */
function modelTimeWithin(from: number, to: number): number {
  const clipped = modelSpans
    .map(([start, end]) => [Math.max(start, from), Math.min(end, to)] as const)
    .filter(([start, end]) => end > start)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let reached = from;
  for (const [start, end] of clipped) {
    if (end <= reached) continue;
    total += end - Math.max(start, reached);
    reached = end;
  }
  return total;
}

/** `model`, with each of its calls' time kept in `modelSpans`. */
function timed(model: GeneratorModel): GeneratorModel {
  const call = <R,>(run: () => Promise<R>) => async (): Promise<R> => {
    const start = Date.now();
    try {
      return await run();
    } finally {
      modelSpans.push([start, Date.now()]);
    }
  };
  // Only the waits on the model's next chunk: between pulls the framework handles each chunk, and that time is its own.
  const streamed = <C,>(run: () => AsyncIterable<C>) =>
    async function* (): AsyncIterable<C> {
      const chunks = run()[Symbol.asyncIterator]();
      try {
        while (true) {
          const start = Date.now();
          const next = await chunks.next().finally(() => modelSpans.push([start, Date.now()]));
          if (next.done) return;
          yield next.value;
        }
      } finally {
        await chunks.return?.();
      }
    };
  return {
    ...model,
    generate: (options) => call(() => model.generate(options))(),
    ...(model.generateStep === undefined ? {} : { generateStep: (options) => call(() => model.generateStep!(options))() }),
    ...(model.stream === undefined ? {} : { stream: (options) => streamed(() => model.stream!(options))() }),
    ...(model.streamStep === undefined ? {} : { streamStep: (options) => streamed(() => model.streamStep!(options))() }),
  };
}

/** A real model for every turn, and the gateway's Jev for every evaluation, legs d and d2. */
function liveResolver(): ModelResolver {
  // A container's FSDEV_DEFAULT_MODEL / FSDEV_INTENT_* would swap the model under the resolver.
  stripIntentOverrides();
  const base = createModelResolver();
  return Object.assign((_id: string, block?: string, options?: never) => timed(base(gatewayModel(DEFAULT_MODEL), block, options)), {
    resolveId: () => gatewayModel(DEFAULT_MODEL),
    resolveEvaluationModel: async (id: string, block?: string) => {
      const model = (await base.resolveEvaluationModel!(id, block)) as unknown as {
        doEvaluate(call: { questions: Record<string, unknown>; state?: unknown }): PromiseLike<{ answers: Record<string, any>; providerMetadata?: any }>;
      };
      // Each verdict Jev gave, kept so a failure can show it.
      return {
        ...model,
        doEvaluate: async (call: { questions: Record<string, unknown>; state?: unknown }) => {
          const result = await model.doEvaluate(call);
          if ("verdict" in call.questions) {
            verdicts.push({
              choice: result.answers.verdict?.choice,
              confidence: result.providerMetadata?.typesafe?.confidence?.verdict,
              state: call.state,
            });
          }
          return result;
        },
      };
    },
  }) as unknown as ModelResolver;
}

// ---- the control that drops the project at the hand-over ------------------

/**
 * `no-filing-project`: the stores, with the workstream and project a
 * conversation's hand-over writes onto a task session taken off before the
 * session is stored. Applied around the lab, never inside a package.
 */
function droppingFilingProject<T>(stores: T): T {
  const inner = stores as unknown as { resolve(...args: unknown[]): Promise<Record<string, any>> };
  return {
    ...inner,
    resolve: async (...args: unknown[]) => {
      const registry = await inner.resolve(...args);
      const session = registry.session;
      const set = session.set.bind(session);
      session.set = (id: string, value: { state?: Record<string, unknown> }, expected: unknown) => {
        if (value?.state?.filingSessionId !== undefined) {
          const { filingProjectId: _p, filingWorkstreamId: _w, ...state } = value.state;
          value = { ...value, state };
        }
        return set(id, value, expected);
      };
      return registry;
    },
  } as unknown as T;
}

// ---- reading and writing through the lab's door ----------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).trim();
}

/** Commit `body` at `path` to a bare repository's main branch, as someone pushing to it would. */
function commitToRemote(remotePath: string, path: string, body: string): void {
  const clone = mkdtempSync(join(tmpdir(), "conversation-task-push-"));
  git(clone, "clone", "--quiet", remotePath, ".");
  write(join(clone, path), body);
  git(clone, "add", "-A");
  git(clone, "-c", "user.name=goal", "-c", "user.email=goal@example.com", "commit", "--quiet", "-m", "add the marker");
  git(clone, "push", "--quiet", "origin", "HEAD:main");
}

function door(lab: Lab) {
  /** Run `action` on a session and wait for it to end: what it answered, and how long it took. */
  const act = async (flow: string, sessionId: string, action: string, input: unknown, as: keyof typeof LAB_USERS = "owner") => {
    const started = Date.now();
    const sent = await lab.door("POST", `${flow}/${encodeURIComponent(sessionId)}/actions/${action}`, {
      as,
      body: { userId: LAB_USERS[as].userId, input },
    });
    if (sent.status !== 202) return { error: `${sent.status} ${show(sent.body)}`, ms: Date.now() - started };
    const requestId = sent.body.request.id as string;
    for (let i = 0; i < 3000; i += 1) {
      const status = await lab.door("GET", `${flow}/requests/${requestId}/status`, { as });
      if (status.body?.status !== "in_progress") break;
      await sleep(10);
    }
    const ended = Date.now();
    const ms = ended - started;
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_result_output=true&limit=100`, { as });
    const found = (listed.body?.requests ?? []).find((r: { id: string }) => r.id === requestId);
    if (found?.result?.error !== undefined) return { error: show(found.result.error), ms, started, ended };
    return { output: found?.result?.output as any, ms, started, ended };
  };
  /** Open a session on `flow` as the owner, with `state`. */
  const open = async (flow: string, state: Record<string, unknown>, as: keyof typeof LAB_USERS = "owner") => {
    const sessionId = `s-${flow}-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", `${flow}/sessions`, { as, body: { userId: LAB_USERS[as].userId, sessionId, state } });
    if (created.status !== 201) throw new Error(`opening a ${flow} session answered ${created.status}: ${show(created.body)}`);
    return sessionId;
  };
  /** The conversation's lines: message items, oldest first, with who said them. */
  const lines = async (sessionId: string) => {
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_items=true&limit=200`);
    return ((listed.body?.requests ?? []) as Array<{ createdAt: number; items?: any[] }>)
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((request) => request.items ?? [])
      .filter((item) => item.type === "message")
      .map((item) => ({ agentName: item.agentName as string | undefined, text: textOf(item) }));
  };
  return { act, open, lines };
}

function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map((part: { text?: string }) => part.text ?? "").join("");
  return "";
}

/** Wait until nothing in the lab is running. */
async function quiet(lab: Lab): Promise<void> {
  const runtime = await lab.state.getRuntime();
  for (const deadline = Date.now() + LINE_BUDGET_MS; Date.now() < deadline; await sleep(50)) {
    const busy = (await runtime.stores.request.list({})).some((r: { status: string }) => ["pending", "queued", "in_progress"].includes(r.status));
    if (!busy) return;
  }
}

// ---- one filing, read back -------------------------------------------------

interface Filed {
  /** How long the filing turn took. */
  turnMs: number;
  /** How much of the turn a generator model was answering (legs d and d2; 0 when scripted). */
  modelMs: number;
  /** The task as the conversation lists it, once settled, or its last state. */
  task: Record<string, any> | undefined;
  /** The conversation's lines that name the task, with who said them. */
  named: Array<{ agentName: string | undefined; text: string }>;
  /** Every line of the conversation, for a failure to show. */
  all: Array<{ agentName: string | undefined; text: string }>;
  /** Every run the stub saw for it. */
  runs: StubRun[];
  /** The task's row as the board stores it. */
  row: Record<string, any> | undefined;
  /** The run record the manager kept for it, if any. */
  record: Record<string, any> | undefined;
  /** The filing turn's refusal, if it was refused. */
  error?: string;
}

/**
 * Send one turn to a conversation, wait for the task it files to settle, and
 * read back what the conversation heard.
 */
async function fileFrom(lab: Lab, flow: string, sessionId: string, message: string): Promise<Filed> {
  const http = door(lab);
  const runsBefore = stub.runs.length;
  const listTasks = async (): Promise<Array<Record<string, any>>> => (await http.act(flow, sessionId, LIST_TASKS, {})).output?.tasks ?? [];
  const filedBefore = new Set((await listTasks()).map((t) => t.id));
  const turn = await http.act(flow, sessionId, "respond", { message });
  let task: Record<string, any> | undefined;
  const turnEnded = Date.now();
  for (const deadline = turnEnded + LINE_BUDGET_MS; Date.now() < deadline; await sleep(200)) {
    task = (await listTasks()).find((t) => !filedBefore.has(t.id));
    if (task !== undefined && SETTLED.has(task.status)) break;
    // A filing the turn refused, or a turn that asked instead, files nothing.
    if (task === undefined && Date.now() - turnEnded > 5_000) break;
  }
  await quiet(lab);
  // The worker's line about the task, which is delivered after the task settles.
  let all = await http.lines(sessionId);
  const fromWorker = () => all.filter((line) => line.agentName === task?.assignee && line.text.includes(`(${task!.id})`));
  for (const deadline = turnEnded + LINE_BUDGET_MS; task !== undefined && SETTLED.has(task.status) && fromWorker().length === 0 && Date.now() < deadline; ) {
    await sleep(200);
    all = await http.lines(sessionId);
  }
  await quiet(lab);
  all = await http.lines(sessionId);
  const named = task === undefined ? [] : all.filter((line) => line.text.includes(`(${task!.id})`));
  const records = task === undefined ? {} : await lab.stored("user", "runs/");
  const record = Object.entries(records).find(([key]) => key.includes(`/${task!.id}/`))?.[1] as Record<string, any> | undefined;
  return {
    turnMs: turn.ms,
    modelMs: turn.started === undefined ? 0 : modelTimeWithin(turn.started, turn.ended),
    task,
    named,
    all,
    runs: stub.runs.slice(runsBefore),
    row: task === undefined ? undefined : await storedTask(lab, task.id),
    record,
    ...(turn.error === undefined ? {} : { error: turn.error }),
  };
}

/** A task's row as the conversation's board stores it, in the person's scope. */
async function storedTask(lab: Lab, taskId: string): Promise<Record<string, any> | undefined> {
  const rows = await lab.stored("user", "tasks/");
  return Object.entries(rows).find(([key]) => key.endsWith(`/${taskId}`))?.[1] as Record<string, any> | undefined;
}

/** The checks every leg that should be answered with the marker shares. */
function gradeAnswered(leg: string, filed: Filed, marker: string, note: (assertion: string, why: string) => void): void {
  if (filed.error !== undefined) note(`${leg}:turn-returns`, `the filing turn was refused: ${filed.error}`);
  else if (filed.turnMs - filed.modelMs > TURN_BUDGET_MS) {
    note(`${leg}:turn-returns`, `the filing turn took ${filed.turnMs} ms, ${filed.turnMs - filed.modelMs} ms of it outside the model's calls, over ${TURN_BUDGET_MS} ms`);
  }
  // A turn that waits on the task hears its ending as a tool result, not a line.
  if (filed.row?.wait != null) note(`${leg}:turn-did-not-wait`, `the coordinator dispatched the task with wait, so its turn waited for the run`);
  // One line from the worker the row names: a retry or a second delivery would make two.
  const fromWorker = filed.named.filter((line) => line.agentName === filed.task?.assignee);
  if (filed.task?.assignee !== CODER || fromWorker.length !== 1) {
    note(
      `${leg}:one-line-under-${CODER}`,
      `the task is ${show(filed.task && { status: filed.task.status, assignee: filed.task.assignee, attempts: filed.task.attempts })}; ` +
        `the conversation's lines naming it: ${show(filed.named, 600)}` +
        (filed.named.length === 0 ? `; its lines under any worker: ${show(filed.all.filter((l) => l.agentName !== undefined).slice(-3), 900)}` : ""),
    );
    return;
  }
  const line = fromWorker[0]!.text;
  if (!line.includes("completed by") || !line.includes(marker)) {
    note(`${leg}:carrying-the-marker`, `the line is ${show(line, 400)}, not a completed answer carrying the marker the project holds`);
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string): void => {
    failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  };
  const controlOptions = {
    ...(CONTROL === "no-judge" ? { withoutJudge: true } : {}),
  };
  const stores = () => (CONTROL === "no-filing-project" ? droppingFilingProject(inMemoryStores()) : inMemoryStores());
  const members = [LAB_USERS.member.userId];

  // ======================= legs a to c: scripted ==========================
  if (LEGS.has("a") || LEGS.has("b") || LEGS.has("c")) {
    const storefront = createBareRemote("conversation-task-storefront", { seed: { "README.md": "Storefront.\n" } });
    const second = createBareRemote(`conversation-task-${fixture.secondProject.id}`, { seed: { "README.md": `${fixture.secondProject.title}.\n` } });
    const root = mkdtempSync(join(tmpdir(), "conversation-task-places-"));
    const lab = await openLab({
      modelResolver: scriptedResolver(),
      stores: stores(),
      harness: stub.slot,
      runTimeoutMs: 30_000,
      workspace: { root, remotes: { allow: ["file"] } },
      coderWorkerId: CODER,
      logger: silentLogger,
      inventory: true,
      projects: [
        { id: "storefront", title: "Storefront", members, repository: storefront.url },
        { id: "platform", title: "Platform", members },
        { id: "sandbox", title: "Sandbox", members },
        { id: fixture.secondProject.id, title: fixture.secondProject.title, members, repository: second.url },
      ],
      ...controlOptions,
    });
    const http = door(lab);
    try {
      // The markers, committed to each repository after the lab opened.
      const markerA = `marker-a-${globalThis.crypto.randomUUID()}`;
      const markerB = `marker-b-${globalThis.crypto.randomUUID()}`;
      commitToRemote(storefront.path, fixture.markerFile, `${markerA}\n`);
      commitToRemote(second.path, fixture.markerFile, `${markerB}\n`);

      const shiftCoordinator = () => http.open(COORDINATOR_FLOW, { workerId: SHIFT_COORDINATOR });
      const fileForCoder = (goal: string, input?: Record<string, unknown>): ToolCall => ({
        toolName: "createTask",
        args: { goal, assignee: CODER, ...(input === undefined ? {} : { input }) },
      });

      // ---- (a) the shift coordinator, naming the project ------------------
      if (LEGS.has("a")) {
        const before = failures.length;
        const branchesBefore = git(storefront.path, "branch", "--list");
        mode = { kind: "read" };
        script.coordinator = [fileForCoder("Take a look at our repo and tell me what it holds.", { project: { visibility: "shared", id: "storefront" } })];
        const a = await fileFrom(lab, COORDINATOR_FLOW, await shiftCoordinator(), fixture.ask);
        gradeAnswered("a", a, markerA, note);
        const cwd = a.record?.workspacePath as string | undefined;
        if (failures.length === before) {
          if (cwd === undefined || cwd.startsWith(storefront.path) || !existsSync(join(cwd, ".git"))) {
            note("a:own-checkout", `the run record names ${show(cwd)} as the run's folder, not a checkout of its own`);
          }
          if (a.record?.remote !== storefront.url) note("a:own-checkout", `the run was cut from ${show(a.record?.remote)}, not storefront's repository`);
          if (git(storefront.path, "branch", "--list") !== branchesBefore) note("a:branches-unchanged", "storefront's repository has a branch it didn't have");
        }
        if (failures.length === before) {
          evidence.push(`a: one completed line under ${CODER} carrying storefront's marker, the turn returned in ${a.turnMs} ms, the run worked in ${cwd}`);
        }
      }

      // ---- (b) a workstream's conversation, naming nothing -----------------
      if (LEGS.has("b")) {
        const before = failures.length;
        const roster = await http.open("workforce-roster", {});
        // One lead of the person's own, on `agent`, whose delegate takes the coder's tasks. It leads
        // both workstreams below, one session each.
        const hired = await http.act("workforce-roster", roster, "hire", {
          id: WORKSTREAM_LEAD,
          flow: AGENT_FLOW,
          description: "Leads a workstream: files its work as tasks for the coder.",
          settings: { delegates: [CODER] },
        });
        if (hired.error !== undefined) throw new Error(`hiring ${WORKSTREAM_LEAD} was refused — ${hired.error}`);
        /** Open a workstream in `project`, led by the hired lead, over HTTP; its session. */
        const openWorkstream = async (project: string, id: string, title: string) => {
          const opened = await lab.projectAct!("openWorkstream", { project: { visibility: "shared", id: project }, id, title, lead: WORKSTREAM_LEAD });
          if (opened.error !== undefined) throw new Error(`openWorkstream ${project}/${id} was refused — ${opened.error}`);
          return (opened.output as { workstream: { sessionId: string } }).workstream.sessionId;
        };

        mode = { kind: "read" };
        const inSecond = await openWorkstream(fixture.secondProject.id, fixture.workstream.id, fixture.workstream.title);
        script.agent = [fileForCoder("Take a look at our repo and tell me what it holds.")];
        const b = await fileFrom(lab, AGENT_FLOW, inSecond, fixture.ask);
        gradeAnswered("b", b, markerB, note);
        if (failures.length === before && b.record?.remote !== second.url) {
          note("b:in-its-project", `the run was cut from ${show(b.record?.remote)}, not ${fixture.secondProject.id}'s repository`);
        }

        // Sandbox has no repository: a run there works on the project's files.
        const markerS = `marker-s-${globalThis.crypto.randomUUID()}`;
        const inSandbox = await openWorkstream("sandbox", fixture.workstream.id, fixture.workstream.title);
        mode = { kind: "plant", body: `${markerS}\n` };
        script.agent = [fileForCoder("Keep a note in the project's files.")];
        const planted = await fileFrom(lab, AGENT_FLOW, inSandbox, "keep a note for later");
        if (planted.task?.status !== "completed") note("b:sandbox-note-kept", `the note's task ended ${show(planted.task?.status)}`);
        mode = { kind: "read" };
        script.agent = [fileForCoder("Take a look at our files and tell me what they hold.")];
        const s = await fileFrom(lab, AGENT_FLOW, inSandbox, fixture.ask);
        gradeAnswered("b-sandbox", s, markerS, note);
        if (failures.length === before) {
          evidence.push(
            `b: from ${fixture.secondProject.id}'s workstream conversation, one completed line carrying its marker, cut from ${second.url}; ` +
              `from sandbox's, one carrying the marker a run left in its files, worked in ${s.record?.workspacePath}`,
          );
        }
      }

      // ---- (c) tasks that can't be done, heard failing ---------------------
      if (LEGS.has("c")) {
        const before = failures.length;
        const errored: Array<{ sessionId: string; taskId: string }> = [];
        /** One errored line naming the task, carrying `carries`, after `attempts` attempts. */
        const gradeErrored = (sub: string, filed: Filed, carries: string, attempts: number, ran: number) => {
          const failed = filed.named.filter((line) => line.agentName === CODER && line.text.includes("failed for good"));
          if (filed.task?.status !== "errored" || filed.task.attempts !== attempts) {
            note(`c:${sub}:errored`, `the task ended ${show(filed.task && { status: filed.task.status, attempts: filed.task.attempts })}, wanted errored after ${attempts}`);
          }
          if (failed.length !== 1 || !failed[0]!.text.includes(carries)) {
            note(`c:${sub}:one-line-saying-why`, `wanted one failed line carrying ${show(carries)}; the lines naming it: ${show(filed.named, 600)}`);
          }
          if (filed.runs.length !== ran) note(`c:${sub}:runs`, `the harness ran ${filed.runs.length} times, wanted ${ran}`);
        };

        // No project named.
        mode = { kind: "read" };
        let sessionId = await shiftCoordinator();
        script.coordinator = [fileForCoder("Take a look at our repo.")];
        const none = await fileFrom(lab, COORDINATOR_FLOW, sessionId, fixture.ask);
        gradeErrored("no-project", none, "input.project", 1, 0);
        if (none.task !== undefined) errored.push({ sessionId, taskId: none.task.id });

        // A project the person isn't a member of: a stranger's own.
        const strangers = await http.open("projects", {}, "outsider");
        const made = await http.act("projects", strangers, "createProject", { id: fixture.strangersProject.id, title: fixture.strangersProject.title }, "outsider");
        if (made.error !== undefined) throw new Error(`the stranger's createProject was refused — ${made.error}`);
        sessionId = await shiftCoordinator();
        script.coordinator = [fileForCoder("Take a look at their repo.", { project: { visibility: "shared", id: fixture.strangersProject.id } })];
        const stranger = await fileFrom(lab, COORDINATOR_FLOW, sessionId, fixture.ask);
        gradeErrored("not-a-member", stranger, "not a member", 1, 0);
        if (stranger.task !== undefined) errored.push({ sessionId, taskId: stranger.task.id });

        // A run that throws, twice.
        const boom = `boom-${globalThis.crypto.randomUUID()}`;
        mode = { kind: "throw", message: boom };
        sessionId = await shiftCoordinator();
        script.coordinator = [fileForCoder("Take a look at our repo.", { project: { visibility: "shared", id: "storefront" } })];
        const thrown = await fileFrom(lab, COORDINATOR_FLOW, sessionId, fixture.ask);
        gradeErrored("throws", thrown, boom, 2, 2);
        if (thrown.task !== undefined) errored.push({ sessionId, taskId: thrown.task.id });

        // A run that answers without reading the code, judged not done twice.
        mode = { kind: "say", text: fixture.notFound };
        script.verdicts = [
          { choice: "not-done", why: "unsupported", confidence: 0.9 },
          { choice: "not-done", why: "unsupported", confidence: 0.9 },
        ];
        sessionId = await shiftCoordinator();
        script.coordinator = [fileForCoder("Take a look at our repo and tell me what it holds.", { project: { visibility: "shared", id: "storefront" } })];
        const unread = await fileFrom(lab, COORDINATOR_FLOW, sessionId, fixture.ask);
        gradeErrored("judged-not-done", unread, "The judge read the answer against the goal", 2, 2);
        if (unread.task !== undefined) errored.push({ sessionId, taskId: unread.task.id });
        script.verdicts = [];

        // Five seconds on, every one still errored: none running, none cancelled.
        await sleep(5_000);
        for (const { sessionId: id, taskId } of errored) {
          const listed = await http.act(COORDINATOR_FLOW, id, LIST_TASKS, {});
          const row = (listed.output?.tasks ?? []).find((t: { id: string }) => t.id === taskId);
          if (row?.status !== "errored") note("c:stays-errored", `task ${taskId} reads ${show(row?.status)} five seconds on`);
        }
        if (failures.length === before) {
          evidence.push(
            `c: no project, a stranger's project, a run throwing ${boom} twice, and an answer the judge said missed: ` +
              `each one errored line saying why, every row still errored 5 s on`,
          );
        }
      }
    } finally {
      await lab.dispose();
    }
  }

  // ===================== legs d and d2: a real model ======================
  if (LEGS.has("d") || LEGS.has("d2")) {
    const blocked = [DEFAULT_MODEL, JUDGE_MODEL].filter((model) => !keysServing(model).some((key) => (process.env[key] ?? "") !== ""));
    if (blocked.length > 0) {
      note("d:blocked", `no key here serves ${blocked.join(", ")} (${keysServing(JUDGE_MODEL).join(" / ")}); legs d and d2 did not run`);
    } else {
      const storefront = createBareRemote("conversation-task-live", { seed: { "README.md": "Storefront.\n" } });
      const lab = await openLab({
        modelResolver: liveResolver(),
        stores: stores(),
        harness: stub.slot,
        runTimeoutMs: 30_000,
        workspace: { root: mkdtempSync(join(tmpdir(), "conversation-task-live-")), remotes: { allow: ["file"] } },
        coderWorkerId: CODER,
        logger: silentLogger,
        inventory: true,
        // The standard install's projects: storefront is the only one with a repository.
        projects: [
          { id: "storefront", title: "Storefront", members, repository: storefront.url },
          { id: "platform", title: "Platform", members },
          { id: "sandbox", title: "Sandbox", members },
        ],
        ...controlOptions,
      });
      const http = door(lab);
      try {
        const marker = `marker-d-${globalThis.crypto.randomUUID()}`;
        commitToRemote(storefront.path, fixture.markerFile, `${marker}\n`);

        /**
         * The ask, in a new conversation, once: the coordinator must file a
         * task naming storefront on this one turn. Never retried, under a
         * control too.
         */
        const fileLive = async (leg: string): Promise<Filed | undefined> => {
          const filed = await fileFrom(lab, COORDINATOR_FLOW, await http.open(COORDINATOR_FLOW, { workerId: SHIFT_COORDINATOR }), fixture.ask);
          const row = filed.task === undefined ? undefined : await storedTask(lab, filed.task.id);
          if (row?.assignee === CODER && row.input?.project?.visibility === "shared" && row.input.project.id === "storefront") return filed;
          note(
            `${leg}:names-storefront`,
            `the coordinator filed ${show(row && { assignee: row.assignee, input: row.input })}, not a task for ${CODER} naming storefront; ` +
              `it said ${show(filed.all.at(-1)?.text, 200)}`,
          );
          return undefined;
        };

        if (LEGS.has("d")) {
          const before = failures.length;
          mode = { kind: "read" };
          const d = await fileLive("d");
          if (d !== undefined) {
            gradeAnswered("d", d, marker, note);
            if (failures.length === before) {
              evidence.push(
                `d: "${fixture.ask}" filed a task for ${CODER} naming storefront on the first turn ` +
                  `(${d.turnMs} ms, ${d.turnMs - d.modelMs} ms of it outside the model's calls), ` +
                  `and one completed line carries its marker, judged by Jev (${show(verdicts.at(-1) && { choice: verdicts.at(-1)!.choice, confidence: verdicts.at(-1)!.confidence })})`,
              );
            }
          }
        }

        if (LEGS.has("d2")) {
          const before = failures.length;
          mode = { kind: "say", text: fixture.offPoint };
          const judgedBefore = verdicts.length;
          const d2 = await fileLive("d2");
          if (d2 !== undefined) {
            if (d2.row?.wait != null) note("d2:turn-did-not-wait", "the coordinator dispatched the task with wait, so its turn waited for the run");
            const failed = d2.named.filter((line) => line.agentName === CODER && line.text.includes("failed for good"));
            const jev = show(verdicts.slice(judgedBefore).map(({ choice, confidence }) => ({ choice, confidence })));
            if (d2.task?.status !== "errored" || failed.length !== 1) {
              note(
                "d2:ends-errored",
                `an answer off the point ended ${show(d2.task && { status: d2.task.status, attempts: d2.task.attempts })}; ` +
                  `the lines naming it: ${show(d2.named, 600)}; Jev answered ${jev}` +
                (d2.named.length === 0 ? `; its lines under any worker: ${show(d2.all.filter((l) => l.agentName !== undefined).slice(-3), 900)}` : ""),
              );
            } else if (!failed[0]!.text.includes("The judge read the answer against the goal")) {
              note("d2:jevs-reason", `the failed line is ${show(failed[0]!.text)}, without Jev's reason`);
            }
            if (failures.length === before) evidence.push(`d2: "${fixture.offPoint}" ended errored under Jev (${jev}): ${show(failed[0]?.text, 240)}`);
          }
        }
      } finally {
        await lab.dispose();
      }
    }
  }

  return { failures, evidence: evidence.join("; ") };
});

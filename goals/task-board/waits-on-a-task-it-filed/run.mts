/**
 * Goal check — a request waits on a task it filed, or on work it dispatched,
 * through one wait that returns when the task ends or the deadline passes,
 * whichever is first; the deadline cancels nothing, and waits nest up to five
 * deep (FIX-2082). See goal.md.
 *
 * **Model-free.** Real Workforce flows on a real `createFlowState` host over a
 * SQLite store, its durability sweeper and its wakes in-process, driven over
 * the host's HTTP router as a verified caller. Every turn is a generator whose
 * model is a deterministic script read from the turn's own message: it calls
 * the real task tools (`createTask`, `getTask` with `wait`) and the real
 * `dispatcher({ wait: true })`. Every grade reads the store (rows, requests,
 * their items) or what a tool answered, never the board's own say-so.
 *
 * Legs (each failure is tagged `<leg>:<assertion>`):
 *   a  a wait on a task filed earlier, in a later request; a second session and a
 *      second request of the filing session are refused
 *   b  five nested waits (four through task requests, one waited dispatch), a
 *      sixth refused with nothing dispatched; a chain of five below a task
 *      nobody waited on, then a late wait on it, refused; the 101st filing under
 *      a top task, a plan row, refused
 *   c  a deadline shorter than the work resumes with the task running on
 *      attempt 1; a second wait gets it completed; an ending after the deadline
 *      reaches the still-running request once, on its next read, and starts no
 *      onTaskSettled; a request that ends without waiting again hears it once,
 *      as onTaskSettled; killed mid-wait, the deadline still resumes it; the
 *      task whose request waits is cancelled, and that request ends with no
 *      further model call and no recorded return
 *   d  a step filed `session: "new"` is waited on through two deadlines, and the
 *      next step sees a value only it produced; filed as the plan's last step,
 *      the worker still answers once after it, told that value
 *   e  `dispatcher({ wait: true })` outputs the child's output
 *
 * Controls (a scratch patch to the code under test as it loads):
 *   GOAL_CONTROL=deadline-cancels  the deadline cancels the task again. Must
 *     FAIL leg c on "in_progress on attempt 1" and "a second wait gets it".
 *   GOAL_CONTROL=drain-moves-on    a drain takes its deadline as an ending.
 *     Must FAIL leg d.
 *
 * Run: pnpm tsx goals/task-board/waits-on-a-task-it-filed/run.mts   (GOAL_LEGS=a,c to run some)
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, dispatcher, generator } from "@flow-state-dev/core";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineSessionBoard,
  hireWorkforce,
  workerConfigSchema,
  workerTaskEntry,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalTmpDir,
  actingAs,
  modulePatchEnv,
  runGoal,
  silentLogger,
  untilIdle,
  type ModulePatch
} from "../../lib/index.mts";

const USER = "u_waits";
const ORG = "org_waits";
const CONTROL = process.env.GOAL_CONTROL ?? "";
const PHASE = process.env.GOAL_PHASE ?? "main";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("waits-on-a-task-it-filed");
const LEGS = new Set((process.env.GOAL_LEGS ?? "a,b,c,d,e").split(",").map((leg) => leg.trim()));
/** The kill leg's store, and what its second process left there. */
const KILL_DB = join(SCRATCH, "kill.sqlite");
const KILL_PLAN = join(SCRATCH, "kill-plan.json");
/** The kill leg's wait deadline, from the park. */
const KILL_DEADLINE_MS = 4_000;

const WAIT_ON_TASK = "packages/orchestration/src/tasks/helpers/wait-on-task.ts";
const PATCHES: Record<string, ModulePatch[]> = {
  // The deadline cancels the waited-on task, as it did before FIX-2082.
  "deadline-cancels": [
    {
      module: WAIT_ON_TASK,
      from: String.raw`    const lapsed = await collection\.lapseWait!\(taskId, planned\.gateId, requestId\);`,
      to: '    await collection.cancel(taskId, "The wait timed out."); const lapsed = await collection.lapseWait!(taskId, planned.gateId, requestId);'
    }
  ],
  // A drain that takes its deadline as an ending: it stops waiting on the row.
  "drain-moves-on": [
    {
      module: "packages/orchestration/src/task-board/blocks/dispatch-row.ts",
      from: String.raw`      waitAgain: true,`,
      to: "      waitAgain: false,"
    }
  ]
};

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
// A patched control runs this same file again with the patch applied as it loads.
if (PHASE === "main" && PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the scripted turns ----------------------------------------------------------

/**
 * A turn's script, read from its own message after `script:`. A tool op calls
 * that tool; `$N` in an argument is the task id tool result N named. `hold`
 * waits on a gate the check opens, `sleep` on the clock; both run before the
 * tool op after them. `answer` labels the turn's answer, which carries a token
 * only that answer made (`PRODUCED`), its tool results, and the message it read.
 */
type Op =
  | { tool: string; args: Record<string, unknown> }
  | { hold: string }
  | { sleep: number }
  | { answer: string }
  | { repeat: number; op: { tool: string; args: Record<string, unknown> } };

/** Gates a `hold` op waits on, opened by the check. */
const gates = new Map<string, { opened: Promise<void>; open: () => void }>();
function gate(name: string) {
  let entry = gates.get(name);
  if (entry === undefined) {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    entry = { opened, open };
    gates.set(name, entry);
  }
  return entry;
}
/** Each labelled answer's token: a value only that turn produced. */
const PRODUCED = new Map<string, string>();
/** How a plan's answering turn is told its steps ended (`plan.ts`). */
const ANSWERING = "The steps you filed for yourself have ended";
/** Every model call, by the label its script answers with: when it ran. */
const CALLS: Array<{ label: string; at: number; last: string }> = [];

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part as { text?: string }).text ?? "").join("");
  return "";
}

/** The JSON array after `script:` in `text`, read by its brackets. */
function scriptIn(text: string): Op[] | undefined {
  const at = text.indexOf("script:");
  if (at < 0) return undefined;
  const start = text.indexOf("[", at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth += 1;
    else if (c === "]" && --depth === 0) return JSON.parse(text.slice(start, i + 1)) as Op[];
  }
  return undefined;
}

/** A goal for a task or a step: its words, and the script its turn runs. */
const scripted = (words: string, ops: Op[]) => `${words} script:${JSON.stringify(ops)}`;

function scriptModel(): GeneratorModel {
  return {
    modelId: "goal-script",
    async generate() {
      throw new Error("the turns are driven step by step");
    },
    async generateStep(options: GeneratorModelCallOptions) {
      const messages = (options.messages ?? []) as Array<{ role: string; content: unknown }>;
      let at = -1;
      let ops: Op[] | undefined;
      for (let i = messages.length - 1; i >= 0 && ops === undefined; i -= 1) {
        if (messages[i]!.role !== "user") continue;
        const text = textOf(messages[i]!.content);
        // A notice quotes its task's goal, script and all: it is no script of this turn's.
        if (text.startsWith('Task "')) break;
        ops = scriptIn(text);
        if (ops !== undefined) at = i;
      }
      if (ops === undefined) return { text: "heard", finishReason: "stop" };
      const message = textOf(messages[at]!.content);
      const results: string[] = [];
      for (const m of messages.slice(at + 1)) {
        if (m.role !== "tool" || !Array.isArray(m.content)) continue;
        for (const part of m.content as Array<Record<string, unknown>>) if (part.type === "tool-result") results.push(JSON.stringify(part.output));
      }
      const plan: Op[] = ops.flatMap((op) => ("repeat" in op ? Array.from({ length: op.repeat }, (_, i) => withIndex(op.op, i)) : [op]));
      const label = (plan.find((op) => "answer" in op) as { answer: string } | undefined)?.answer ?? "turn";
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      CALLS.push({ label, at: Date.now(), last: textOf(lastUser?.content).slice(0, 80) });
      // The next tool op, after the hold or sleep ops before it.
      let tools = 0;
      for (const op of plan) {
        if ("tool" in op) {
          if (tools === results.length) return { toolCalls: [{ toolCallId: `c${tools}`, toolName: op.tool, args: resolve(op.args, results) }], finishReason: "tool-calls" };
          tools += 1;
          continue;
        }
        if (tools !== results.length) continue;
        if ("hold" in op) await gate(op.hold).opened;
        if ("sleep" in op) await sleep(op.sleep);
      }
      const token = `${label}-${randomUUID().slice(0, 8)}`;
      PRODUCED.set(label, token);
      return { text: `${token} results=${results.join(" | ")} read=${message.slice(0, 1500)}`, finishReason: "stop" };
    }
  };
}

function withIndex(op: { tool: string; args: Record<string, unknown> }, i: number) {
  return { tool: op.tool, args: JSON.parse(JSON.stringify(op.args).replaceAll("{i}", String(i + 1))) as Record<string, unknown> };
}

/** `$N` is the task id result N named. */
function resolve(args: Record<string, unknown>, results: string[]): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(args).replace(/"\$(\d+)"/g, (_, n: string) => JSON.stringify(/"taskId":"([^"]+)"/.exec(results[Number(n)] ?? "")?.[1] ?? "")),
  ) as Record<string, unknown>;
}

// ---- the host ------------------------------------------------------------------------

const worker = (id: string, declared: Record<string, unknown>): WorkerManifest => ({ id, declared, body: "", skills: [] });
/** A conversation's worker, and a chain of five doers, each the next one's filer. */
const WORKERS: WorkerManifest[] = [
  worker("lead", { flow: "desk", delegates: ["doer.a"] }),
  worker("doer.a", { flow: "doer", delegates: ["doer.b"] }),
  worker("doer.b", { flow: "doer", delegates: ["doer.c"] }),
  worker("doer.c", { flow: "doer", delegates: ["doer.d"] }),
  worker("doer.d", { flow: "doer", delegates: ["doer.e"] }),
  worker("doer.e", { flow: "doer" })
];

function buildHost(filename: string, waitDeadlines?: { defaultMs: number; minMs: number }) {
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: WORKERS, workerFlows: () => workerFlows as never });
  const doorInput = z.object({ message: z.string() });
  const model = scriptModel();

  // A dispatch that waits for what it started: the probe entry runs the
  // script it is handed, in a session of its own.
  const probeWait = (name: string) =>
    dispatcher({
      name,
      action: "probe",
      inputSchema: z.object({ message: z.string() }),
      session: {
        key: (input) => `probe:${input.message.length}:${input.message.slice(-24)}`,
        // A session of the same worker, as the flow's sessions are.
        state: (_input, ctx) => ({ workerId: (ctx.session.state as { workerId?: string }).workerId })
      },
      wait: true
    });

  const flowOf = (kind: string) => {
    const board = defineSessionBoard({ installation, flowKind: kind });
    const turn = generator({
      name: `${kind}-turn`,
      model,
      prompt: "Work the turn its script describes.",
      inputSchema: doorInput,
      uses: [board.tools],
      tools: [probeWait(`${kind}_probe_wait`)],
      maxIterations: 150,
      user: (input: { message: string }) => input.message
    });
    const planned = board.planned(turn);
    const probe = generator({
      name: `${kind}-probe`,
      model,
      prompt: "Work the turn its script describes.",
      inputSchema: doorInput,
      tools: [probeWait(`${kind}_probe_again`)],
      user: (input: { message: string }) => input.message
    });
    return defineFlow({
      kind,
      configSchema: workerConfigSchema(),
      session: { ...installation.session(board.sessionStateShape), serverOwned: [...board.serverOwned] },
      resources: { ...installation.resources, ...board.resources },
      actions: {
        respond: { inputSchema: doorInput.strict(), block: planned, userMessage: (i: { message: string }) => i.message },
        // Leg e: an action that is a waited dispatch.
        askProbe: { inputSchema: doorInput.strict(), block: probeWait(`${kind}-ask-probe`) },
        ...board.actions
      },
      internal: { actions: { ...board.entries(planned), probe: { block: probe } } },
      task: { actions: { work: workerTaskEntry({ name: `${kind}-task`, turn: planned }) } }
    } as never);
  };
  workerFlows = { desk: { flow: flowOf("desk"), roles: ["contributor", "manager"] }, doer: { flow: flowOf("doer"), roles: ["contributor", "manager"] } };

  const state = createFlowState({
    flows: Object.fromEntries(hireWorkforce(installation).map((copy) => [copy.id, copy])),
    stores: { default: { primary: sqliteStores({ filename }) } },
    durabilityRetention: { sweepIntervalMs: 250 },
    ...(waitDeadlines !== undefined ? { waitDeadlines } : {}),
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const connect = async () => {
    const router = await state.getRouter();
    const runtime = await state.getRuntime();
    const http = actingAs(router as never, USER);
    /** Every stored row of the user's conversation ledgers. */
    const rows = async (prefix = "tasks/"): Promise<Task[]> =>
      Object.values(await runtime.stores.resourceState.getByPrefix("user", `${USER}:~org:${ORG}`, prefix)).map((value) => value.state as Task);
    const steps = () => rows("plan/");
    const byGoal = async (words: string) => (await rows()).filter((row) => row.goal.startsWith(words));
    const byId = async (id: string) => (await rows()).find((row) => row.id === id);
    /** Send an action and wait until it stops running: `suspended` is stopped too. Its request id. */
    const send = async (flow: string, sessionId: string, action: string, input: unknown): Promise<string> => {
      const sent = await http.call("POST", [flow, sessionId, "actions", action], { userId: USER, input });
      if (sent.status !== 202) throw new Error(`${action} was refused (${sent.status}): ${sent.text}`);
      const requestId = JSON.parse(sent.text).request.id as string;
      await until(async () => (await status(requestId)) !== "in_progress", 30_000);
      return requestId;
    };
    const record = (requestId: string) => runtime.stores.request.get(requestId) as Promise<any>;
    const status = async (requestId: string) => (await runtime.stores.request.get(requestId))?.status as string | undefined;
    const requestsOf = async (sessionId: string) =>
      ((await runtime.stores.request.list({ sessionId })) as Array<{ id: string; actionName: string; status: string; createdAt: number; result?: any; finalizedAtMs?: number }>).sort(
        (a, b) => a.createdAt - b.createdAt
      );
    /** What a request answered: its recorded output. */
    const answerOf = async (requestId: string): Promise<string> => JSON.stringify((await runtime.stores.request.get(requestId))?.result?.output ?? "");
    /** Every tool result a request's model was handed, by tool. */
    const toolOutputs = async (requestId: string, tool: string): Promise<string[]> => {
      const items = ((await record(requestId))?.items ?? []) as Array<{ type: string; status?: string; toolCall?: { name?: string }; output?: unknown }>;
      // Each call's settled result, once: a parked call's record is not one.
      return items
        .filter((item) => item.type === "tool_output" && item.status === "completed" && (item.toolCall?.name ?? "").startsWith(tool))
        .map((item) => JSON.stringify(item.output));
    };
    const until = async (check: () => Promise<boolean>, ms: number) => {
      for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(50)) if (await check()) return true;
      return check();
    };
    const parked = async () => (await runtime.stores.suspensions.list({ status: "pending" } as never)) as Array<{ requestId: string; reason: string; data?: any }>;
    return { runtime, http, rows, steps, byGoal, byId, send, record, status, requestsOf, answerOf, toolOutputs, until, parked, idle: () => untilIdle(runtime.stores) };
  };
  return { state, connect };
}

const word = (name: string) => `${name} ${RUN_STAMP}`;

// ---- the kill leg's second process -----------------------------------------------

if (PHASE === "kill") {
  // The conversation files a task that won't end soon and waits on it with a
  // deadline; this process dies once the wait is parked.
  const host = buildHost(KILL_DB);
  const h = await host.connect();
  const conversation = await h.http.open("desk", { workerId: "lead" });
  const asking = await h.send("desk", conversation, "respond", {
    message: scripted("kill", [
      { tool: "createTask", args: { goal: scripted(word("kill-work"), [{ hold: "never" }, { answer: "kill-work" }]), assignee: "doer.a" } },
      { tool: "getTask", args: { id: "$0", wait: true, deadline: KILL_DEADLINE_MS } },
      { answer: "kill-asker" }
    ])
  });
  const parkedAt = Date.now();
  writeFileSync(KILL_PLAN, JSON.stringify({ conversation, asking, parkedAt, status: await h.status(asking) }), "utf8");
  process.kill(process.pid, "SIGKILL");
}

// ---- the legs --------------------------------------------------------------------

await runGoal(async (failures, tell) => {
  const notes: string[] = [];
  const leg = async (name: string, body: () => Promise<void>) => {
    if (!LEGS.has(name)) return;
    try {
      await body();
    } catch (error) {
      failures.push(`${name}:threw — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    }
  };
  const hosts: Array<ReturnType<typeof buildHost>> = [];
  const open = (filename: string, deadlines?: { defaultMs: number; minMs: number }) => {
    rmSync(filename, { force: true });
    const host = buildHost(filename, deadlines);
    hosts.push(host);
    return host;
  };
  try {
    const host = open(join(SCRATCH, "main.sqlite"));
    const h = await host.connect();

    // ---- a. a wait on a task filed earlier ------------------------------------------
    await leg("a", async () => {
      const conversation = await h.http.open("desk", { workerId: "lead" });
      const other = await h.http.open("desk", { workerId: "lead" });
      const goal = word("a-work");
      // The first request files and ends.
      const filing = await h.send("desk", conversation, "respond", {
        message: scripted("a-file", [
          { tool: "createTask", args: { goal: scripted(goal, [{ hold: "a1" }, { answer: "a-work" }]), assignee: "doer.a" } },
          { answer: "a-filer" }
        ])
      });
      const [row] = tell.over("a · the filed row", await h.byGoal(goal));
      if ((await h.status(filing)) !== "completed" || row === undefined) {
        failures.push(`a:files and ends — the filing request is ${await h.status(filing)}, ${row === undefined ? "no row" : row.status}`);
        return;
      }
      // A later request waits on it, and parks.
      const waiting = await h.send("desk", conversation, "respond", {
        message: scripted("a-wait", [{ tool: "getTask", args: { id: row.id, wait: true } }, { answer: "a-waiter" }])
      });
      const parkedFirst = await h.status(waiting);
      // A second session of the same user can't wait on it.
      const elsewhere = await h.send("desk", other, "respond", {
        message: scripted("a-other", [{ tool: "getTask", args: { id: row.id, wait: true } }, { answer: "a-other" }])
      });
      // A second request of the filing session can't take the wait while the first holds it.
      const second = await h.send("desk", conversation, "respond", {
        message: scripted("a-second", [{ tool: "getTask", args: { id: row.id, wait: true } }, { answer: "a-second" }])
      });
      const otherSaid = (await h.toolOutputs(elsewhere, "getTask")).join(" ");
      const secondSaid = (await h.toolOutputs(second, "getTask")).join(" ");
      if (parkedFirst !== "suspended") failures.push(`a:the wait parks — the waiting request is ${parkedFirst}`);
      if (!/"ok":false/.test(otherSaid) || (await h.byId(row.id))?.wait?.requestId === elsewhere) {
        failures.push(`a:a second session is refused — it answered ${otherSaid.slice(0, 300)}`);
      }
      if (!secondSaid.includes("wait_taken")) failures.push(`a:a second request of the filing session is refused — it answered ${secondSaid.slice(0, 300)}`);

      gate("a1").open();
      await h.until(async () => (await h.status(waiting)) === "completed", 20_000);
      await h.idle();
      const read = (await h.toolOutputs(waiting, "getTask")).join(" ");
      const ended = await h.byId(row.id);
      const heard = (await h.requestsOf(conversation)).filter((r) => r.actionName === "onTaskSettled");
      if ((await h.status(waiting)) !== "completed" || !read.includes('"status":"completed"') || !read.includes(PRODUCED.get("a-work") ?? "<none>")) {
        failures.push(`a:the wait gets the task completed with its output — request ${await h.status(waiting)}, read ${read.slice(0, 300)}`);
      }
      if (ended?.status !== "completed") failures.push(`a:the task completed — it is ${ended?.status}`);
      tell.over("a · onTaskSettled for a waited task", heard, { emptyIs: "the claim: the waiting request had the ending" });
      if (heard.length !== 0) failures.push(`a:the ending reached its waiter, not onTaskSettled — ${heard.length} onTaskSettled request(s)`);
      notes.push(`a: the later request read ${PRODUCED.get("a-work")}; another session: ${/"error":"([a-z_]+)/.exec(otherSaid)?.[1]}; the filing session's second request: wait_taken`);

      // A task that ends between its filing and its filer's wait, in one request
      // (a task's turn, which a notice waits behind): the wait returns it at
      // once, and that is the filer's one hearing of it.
      const quick = await h.http.open("desk", { workerId: "lead" });
      const pieceGoal = word("a-quick-piece");
      const topGoal = word("a-quick-top");
      await h.send("desk", quick, "respond", {
        message: scripted("a-quick-file", [
          {
            tool: "createTask",
            args: {
              goal: scripted(topGoal, [
                { tool: "createTask", args: { goal: scripted(pieceGoal, [{ answer: "a-quick-piece" }]), assignee: "doer.b" } },
                { hold: "a-quick" },
                { tool: "getTask", args: { id: "$0", wait: true } },
                { answer: "a-quick-waiter" }
              ]),
              assignee: "doer.a"
            }
          },
          { answer: "a-quick-filer" }
        ])
      });
      const endedFirst = await h.until(async () => (await h.byGoal(pieceGoal))[0]?.status === "completed", 20_000);
      gate("a-quick").open();
      await h.until(async () => (await h.byGoal(topGoal))[0]?.status === "completed", 20_000);
      await h.idle();
      // Past the notice's due time, so a resend by the filer's pass has had its chance too.
      await sleep(2_500);
      await h.idle();
      const [top] = await h.byGoal(topGoal);
      const [piece] = await h.byGoal(pieceGoal);
      const quickRead = top?.run?.requestId === undefined ? "" : (await h.toolOutputs(top.run.requestId, "getTask")).join(" ");
      const notices = top?.run?.sessionId === undefined ? [] : (await h.requestsOf(top.run.sessionId)).filter((r) => r.actionName === "onTaskSettled");
      // A notice request that finds its notice no longer owed delivers nothing (the entry's admit): count the ones it admitted.
      const delivered = tell.over(
        "a · onTaskSettled requests that delivered the piece's ending",
        notices.filter((r) => r.result?.output?.owed === true && r.result.output.notice?.taskId === piece?.id),
        { emptyIs: "the claim: the wait's answer was the delivery" }
      );
      if (!endedFirst || !quickRead.includes('"status":"completed"') || !quickRead.includes(PRODUCED.get("a-quick-piece") ?? "<none>")) {
        failures.push(`a:a task that ended before the wait is returned by it — ended first: ${endedFirst}; read ${quickRead.slice(0, 300)}`);
      }
      if (delivered.length !== 0) {
        failures.push(`a:an ending read by the filer's wait starts no notice turn — ${delivered.length} onTaskSettled delivered it too`);
      }
      if (top?.status !== "completed" || !JSON.stringify(top.output ?? "").includes(PRODUCED.get("a-quick-waiter") ?? "<none>")) {
        failures.push(`a:the waiting turn's answer is the task's result — task ${top?.status}, output ${JSON.stringify(top?.output ?? "").slice(0, 200)}`);
      }
      notes.push(`a: a piece that ended before its wait was read by it; ${notices.length} onTaskSettled request(s) in the task's session, ${delivered.length} delivering it`);
    });

    // ---- b. nested waits, and the depth ---------------------------------------------
    await leg("b", async () => {
      const conversation = await h.http.open("desk", { workerId: "lead" });
      // desk → a → b → c each wait on the task below; d's task request waits on a
      // dispatch, whose probe tries a sixth wait.
      const probe = scripted("b-probe", [{ tool: "doer_probe_again", args: { message: scripted("b-probe-6", [{ answer: "b-probe-6" }]) } }, { answer: "b-probe" }]);
      const d = scripted(word("b-d"), [{ tool: "doer_probe_wait", args: { message: probe } }, { answer: "b-d" }]);
      const link = (name: string, below: string, next: string) =>
        scripted(word(name), [
          { tool: "createTask", args: { goal: below, assignee: next } },
          { tool: "getTask", args: { id: "$0", wait: true } },
          { answer: name }
        ]);
      const c = link("b-c", d, "doer.d");
      const bb = link("b-b", c, "doer.c");
      const a = link("b-a", bb, "doer.b");
      const top = await h.send("desk", conversation, "respond", {
        message: scripted("b-desk", [
          { tool: "createTask", args: { goal: a, assignee: "doer.a" } },
          { tool: "getTask", args: { id: "$0", wait: true } },
          { answer: "b-desk" }
        ])
      });
      const done = await h.until(async () => (await h.status(top)) === "completed", 30_000);
      await h.idle();
      const answer = await h.answerOf(top);
      const probes = tell.over(
        "b · probe requests",
        (await h.runtime.stores.request.list({})).filter(
          (r: { actionName: string; input?: unknown }) => r.actionName === "probe" && JSON.stringify(r.input ?? "").includes("b-probe")
        )
      );
      const probeAnswer = probes.length === 0 ? "" : await h.answerOf((probes[0] as { id: string }).id);
      if (!done || !answer.includes(PRODUCED.get("b-probe") ?? "<none>")) {
        failures.push(`b:five nested waits each resume with the result below — the top request is ${await h.status(top)}, its answer ${answer.slice(0, 200)}`);
      }
      if (probes.length !== 1 || !probeAnswer.includes("wait_too_deep")) {
        failures.push(`b:a sixth wait is refused and dispatches nothing — ${probes.length} probe request(s); the probe read ${probeAnswer.slice(0, 300)}`);
      }

      // A chain of five built below a task nobody waits on, then a late wait on it.
      const late = await h.http.open("desk", { workerId: "lead" });
      const heldProbe = scripted("b-late-probe", [{ hold: "b-late" }, { answer: "b-late-probe" }]);
      const lateE = scripted(word("b-late-e"), [{ tool: "doer_probe_wait", args: { message: heldProbe } }, { answer: "b-late-e" }]);
      const lateD = link("b-late-d", lateE, "doer.e");
      const lateC = link("b-late-c", lateD, "doer.d");
      const lateB = link("b-late-b", lateC, "doer.c");
      const lateA = link("b-late-a", lateB, "doer.b");
      await h.send("desk", late, "respond", {
        message: scripted("b-late-file", [{ tool: "createTask", args: { goal: lateA, assignee: "doer.a" } }, { answer: "b-late-file" }])
      });
      const [lateRow] = await h.byGoal(word("b-late-a"));
      const builtBelow = await h.until(async () => (await h.parked()).filter((p) => p.reason === "wait").length >= 5, 20_000);
      const lateWait = await h.send("desk", late, "respond", {
        message: scripted("b-late-wait", [{ tool: "getTask", args: { id: lateRow?.id ?? "", wait: true } }, { answer: "b-late-wait" }])
      });
      const lateSaid = (await h.toolOutputs(lateWait, "getTask")).join(" ");
      if (!builtBelow || !lateSaid.includes("wait_too_deep") || (await h.byId(lateRow?.id ?? ""))?.wait != null) {
        failures.push(`b:a late wait on a chain of five is refused — five below: ${builtBelow}; it answered ${lateSaid.slice(0, 300)}`);
      }
      gate("b-late").open();
      await h.idle();

      // The 101st filing under a top task, a plan row, is refused.
      const plans = await h.http.open("desk", { workerId: "lead" });
      const steps = scripted(word("b-steps"), [
        { repeat: 101, op: { tool: "createTask", args: { goal: scripted(`b-step {i} ${RUN_STAMP}`, [{ answer: "b-step" }]), assignee: "doer.a" } } },
        { answer: "b-steps" }
      ]);
      await h.send("desk", plans, "respond", {
        message: scripted("b-plan-file", [{ tool: "createTask", args: { goal: steps, assignee: "doer.a" } }, { answer: "b-plan-file" }])
      });
      await h.until(async () => (await h.byGoal(word("b-steps")))[0]?.status === "completed", 60_000);
      await h.idle();
      const filedSteps = (await h.steps()).filter((row) => row.goal.startsWith("b-step ") && row.goal.includes(RUN_STAMP));
      const stepsTask = (await h.byGoal(word("b-steps")))[0];
      const filings = stepsTask?.run?.requestId === undefined ? [] : await h.toolOutputs(stepsTask.run.requestId, "createTask");
      const refusedFiling = filings.filter((said) => said.includes('"ok":false'));
      if (filedSteps.length !== 100 || filings.length !== 101 || refusedFiling.length !== 1 || !/cap|limit/i.test(refusedFiling[0] ?? "")) {
        failures.push(`b:the 101st filing under a top task, a plan row, is refused — ${filedSteps.length} steps filed of ${filings.length} filings; refused: ${(refusedFiling[0] ?? "none").slice(0, 300)}`);
      }
      notes.push(`b: the top request read ${PRODUCED.get("b-probe")}; the sixth answered wait_too_deep, 1 probe request; a late wait on five below: wait_too_deep; ${filedSteps.length} plan rows under one top task`);
    });

    // ---- c. the deadline ------------------------------------------------------------
    await leg("c", async () => {
      const conversation = await h.http.open("desk", { workerId: "lead" });
      // A deadline shorter than the work, then a second wait.
      const first = await h.send("desk", conversation, "respond", {
        message: scripted("c-deadline", [
          { tool: "createTask", args: { goal: scripted(word("c-work"), [{ sleep: 3_500 }, { answer: "c-work" }]), assignee: "doer.a" } },
          { tool: "getTask", args: { id: "$0", wait: true, deadline: 1_500 } },
          { tool: "getTask", args: { id: "$0", wait: true } },
          { answer: "c-deadline" }
        ])
      });
      await h.until(async () => (await h.status(first)) === "completed", 20_000);
      const reads = await h.toolOutputs(first, "getTask");
      const [work] = await h.byGoal(word("c-work"));
      if (!/"status":"in_progress"/.test(reads[0] ?? "") || !/"attempts":1/.test(reads[0] ?? "")) {
        failures.push(`c:at the deadline the task is in_progress on attempt 1 — the first read was ${(reads[0] ?? "").slice(0, 300)}`);
      }
      if (!/"status":"completed"/.test(reads[1] ?? "") || work?.status !== "completed" || work.attempts !== 1) {
        failures.push(`c:a second wait gets it completed — the second read was ${(reads[1] ?? "").slice(0, 300)}; the row ${work?.status} on attempt ${work?.attempts}`);
      }

      // An ending after the deadline, while the request still runs: its next read.
      const held = await h.send("desk", conversation, "respond", {
        message: scripted("c-held", [
          { tool: "createTask", args: { goal: scripted(word("c-held-work"), [{ sleep: 2_500 }, { answer: "c-held-work" }]), assignee: "doer.a" } },
          { tool: "getTask", args: { id: "$0", wait: true, deadline: 1_000 } },
          { sleep: 3_500 },
          { tool: "getTask", args: { id: "$0" } },
          { answer: "c-held" }
        ])
      });
      await h.until(async () => (await h.status(held)) === "completed", 20_000);
      await sleep(4_000);
      const [heldWork] = await h.byGoal(word("c-held-work"));
      const heldReads = await h.toolOutputs(held, "getTask");
      const heldHeard = await h.requestsOf(conversation);
      const heardFor = async (taskId: string | undefined) =>
        (
          await Promise.all(
            (await h.requestsOf(conversation))
              .filter((r) => r.actionName === "onTaskSettled")
              .map(async (r) => JSON.stringify((await h.record(r.id))?.input ?? ""))
          )
        ).filter((input) => taskId !== undefined && input.includes(taskId)).length;
      tell.over("c · the conversation's requests", heldHeard);
      if (!/"status":"completed"/.test(heldReads[1] ?? "") || (await heardFor(heldWork?.id)) !== 0) {
        failures.push(`c:an ending after the deadline reaches the running request once, on its next read — read ${(heldReads[1] ?? "").slice(0, 200)}; onTaskSettled heard it ${await heardFor(heldWork?.id)} time(s)`);
      }

      // A request that ends without waiting again: one onTaskSettled.
      const quiet = await h.send("desk", conversation, "respond", {
        message: scripted("c-quiet", [
          { tool: "createTask", args: { goal: scripted(word("c-quiet-work"), [{ sleep: 2_500 }, { answer: "c-quiet-work" }]), assignee: "doer.a" } },
          { tool: "getTask", args: { id: "$0", wait: true, deadline: 1_000 } },
          { answer: "c-quiet" }
        ])
      });
      await h.until(async () => (await h.status(quiet)) === "completed", 20_000);
      const [quietWork] = await h.byGoal(word("c-quiet-work"));
      await h.until(async () => (await heardFor(quietWork?.id)) >= 1, 15_000);
      await sleep(3_000);
      if ((await heardFor(quietWork?.id)) !== 1) failures.push(`c:a request that ended without reading it hears it once — onTaskSettled ran ${await heardFor(quietWork?.id)} time(s)`);

      // An ending and a deadline due together: one resume, one delivery.
      const together = await h.send("desk", conversation, "respond", {
        message: scripted("c-together", [
          { tool: "createTask", args: { goal: scripted(word("c-together-work"), [{ hold: "c-together" }, { answer: "c-together-work" }]), assignee: "doer.a" } },
          { tool: "getTask", args: { id: "$0", wait: true, deadline: 1_500 } },
          { answer: "c-together" }
        ])
      });
      const parkedAt = Date.now();
      await sleep(Math.max(0, 1_500 - (Date.now() - parkedAt) - 150));
      gate("c-together").open();
      await h.until(async () => (await h.status(together)) === "completed", 20_000);
      await sleep(3_000);
      const [togetherWork] = await h.byGoal(word("c-together-work"));
      const resumes = (((await h.record(together))?.items ?? []) as Array<{ type: string }>).filter((item) => item.type === "suspension_resume").length;
      const togetherRead = (await h.toolOutputs(together, "getTask")).join(" ");
      const delivered = (togetherRead.includes('"status":"completed"') ? 1 : 0) + (await heardFor(togetherWork?.id));
      if (resumes !== 1 || delivered !== 1) {
        failures.push(`c:an ending and a deadline due together resume once and deliver once — ${resumes} resume(s), delivered ${delivered} time(s)`);
      }

      // The task whose request waits is cancelled: that request ends with no further model call.
      const cancelled = await h.http.open("desk", { workerId: "lead" });
      await h.send("desk", cancelled, "respond", {
        message: scripted("c-cancel-file", [
          {
            tool: "createTask",
            args: {
              goal: scripted(word("c-cancel-a"), [
                { tool: "createTask", args: { goal: scripted(word("c-cancel-b"), [{ hold: "c-cancel" }, { answer: "c-cancel-b" }]), assignee: "doer.b" } },
                { tool: "getTask", args: { id: "$0", wait: true } },
                { answer: "c-cancel-a" }
              ]),
              assignee: "doer.a"
            }
          },
          { answer: "c-cancel-file" }
        ])
      });
      // Its request parks on the piece it filed, whose own row names this task.
      await h.until(async () => {
        const piece = (await h.byGoal(word("c-cancel-b")))[0];
        return piece !== undefined && (await h.parked()).some((p) => p.reason === "wait" && JSON.stringify(p.data ?? {}).includes(piece.id));
      }, 15_000);
      const [cancelRow] = await h.byGoal(word("c-cancel-a"));
      const runRequest = cancelRow?.run?.requestId;
      // The waiting request's own model calls: its turn reads the task as filed.
      const ownCalls = () => CALLS.filter((call) => call.label === "c-cancel-a" && call.last.startsWith(word("c-cancel-a"))).length;
      const before = ownCalls();
      await h.http.act("desk", cancelled, "updateTask_tasks", { id: cancelRow?.id, status: "cancelled" });
      await h.until(async () => (runRequest === undefined ? false : !["suspended", "in_progress"].includes((await h.status(runRequest)) ?? "")), 15_000);
      // The cancel cascades to the piece; one already claimed is held on its gate,
      // which nothing else opens, so open it before waiting for the host to go idle.
      gate("c-cancel").open();
      await h.idle();
      const after = ownCalls();
      const ended = runRequest === undefined ? undefined : await h.runtime.stores.request.get(runRequest);
      const cancelledRow = await h.byId(cancelRow?.id ?? "");
      const stillWaiting = ended?.status === "suspended" || ended?.status === "in_progress";
      if (after !== before || cancelledRow?.status !== "cancelled" || cancelledRow.output !== undefined || stillWaiting) {
        failures.push(`c:a cancelled task's waiting request ends with no further model call and no recorded return — ${after - before} model call(s) after the cancel; the request ${ended?.status}; the row ${cancelledRow?.status} with output ${JSON.stringify(cancelledRow?.output)}`);
      }

      // Killed mid-wait: the deadline still resumes it.
      rmSync(KILL_DB, { force: true });
      rmSync(KILL_PLAN, { force: true });
      spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
        stdio: "inherit",
        env: { ...process.env, GOAL_PHASE: "kill", GOAL_SCRATCH: SCRATCH }
      });
      if (!existsSync(KILL_PLAN)) {
        failures.push("c:killed mid-wait, the deadline resumes it — the second process left no plan");
      } else {
        const plan = JSON.parse(readFileSync(KILL_PLAN, "utf8")) as { asking: string; parkedAt: number; status: string };
        const restarted = buildHost(KILL_DB);
        hosts.push(restarted);
        const r = await restarted.connect();
        const restartedAt = Date.now();
        const resumed = await r.until(async () => (await r.status(plan.asking)) !== "suspended", KILL_DEADLINE_MS + 15_000);
        const resumedAt = Date.now();
        const due = Math.max(plan.parkedAt + KILL_DEADLINE_MS, restartedAt);
        // Resumed is the moment it left `suspended`; the read it resumed with lands as the request runs on.
        await r.until(async () => (await r.toolOutputs(plan.asking, "getTask")).join(" ").includes('"status"'), 5_000);
        const read = (await r.toolOutputs(plan.asking, "getTask")).join(" ");
        if (plan.status !== "suspended" || !resumed || resumedAt - due > 2_000 || !read.includes('"status"')) {
          failures.push(`c:killed mid-wait, the deadline resumes it within due time plus 2 s — parked as ${plan.status}; resumed ${resumed} ${resumedAt - due} ms past due; read ${read.slice(0, 200)}`);
        } else {
          notes.push(`c: after the kill the deadline resumed the wait ${resumedAt - due} ms past due`);
        }
      }
      notes.push(`c: the first read ${/"status":"([a-z_]+)"/.exec(reads[0] ?? "")?.[1]} on attempt 1, the second ${/"status":"([a-z_]+)"/.exec(reads[1] ?? "")?.[1]}; together: ${resumes} resume, ${delivered} delivery`);
    });

    // ---- e. a dispatcher that waits ---------------------------------------------------
    await leg("e", async () => {
      const conversation = await h.http.open("desk", { workerId: "lead" });
      const asked = await h.send("desk", conversation, "askProbe", { message: scripted("e-probe", [{ answer: "e-probe" }]) });
      await h.until(async () => (await h.status(asked)) === "completed", 15_000);
      const output = (await h.runtime.stores.request.get(asked))?.result?.output as { status?: string; output?: unknown } | undefined;
      if (output?.status !== "completed" || !String(output.output ?? "").includes(PRODUCED.get("e-probe") ?? "<none>")) {
        failures.push(`e:dispatcher({ wait: true }) outputs the child's output — it output ${JSON.stringify(output)?.slice(0, 300)}`);
      }
      notes.push(`e: the dispatcher output ${output?.status} with ${PRODUCED.get("e-probe")}`);
    });

    // ---- d. a step in a session of its own -------------------------------------------
    await leg("d", async () => {
      // Its own host: the drain waits at the host's default deadline, made short here.
      const short = open(join(SCRATCH, "steps.sqlite"), { defaultMs: 1_000, minMs: 1_000 });
      const s = await short.connect();
      const conversation = await s.http.open("desk", { workerId: "lead" });
      const plan = scripted(word("d-plan"), [
        { tool: "createTask", args: { goal: scripted(word("d-step-1"), [{ answer: "d-1" }]), assignee: "doer.a" } },
        {
          tool: "createTask",
          args: { goal: scripted(word("d-step-2"), [{ hold: "d" }, { answer: "d-2" }]), assignee: "doer.a", session: "new", deps: ["$0"] }
        },
        { tool: "createTask", args: { goal: scripted(word("d-step-3"), [{ answer: "d-3" }]), assignee: "doer.a", deps: ["$1"] } },
        { answer: "d-plan" }
      ]);
      await s.send("desk", conversation, "respond", {
        message: scripted("d-file", [{ tool: "createTask", args: { goal: plan, assignee: "doer.a" } }, { answer: "d-file" }])
      });
      const step = (n: number) => s.steps().then((rows) => rows.find((row) => row.goal.startsWith(word(`d-step-${n}`))));
      await s.until(async () => (await step(2))?.status === "in_progress", 15_000);
      // Two deadlines pass while the step runs in its own session.
      await sleep(2_800);
      const [task] = await s.byGoal(word("d-plan"));
      const drain = task?.run?.requestId;
      const parks = drain === undefined ? 0 : (((await s.record(drain))?.items ?? []) as Array<{ type: string }>).filter((item) => item.type === "suspension").length;
      const third = await step(3);
      if (parks < 3 || third?.status !== "pending") {
        failures.push(`d:the drain waits on the running step through two deadlines — it parked ${parks} time(s); the next step is ${third?.status}`);
      }
      gate("d").open();
      await s.until(async () => (await s.byGoal(word("d-plan")))[0]?.status === "completed", 20_000);
      await s.idle();
      const second = await step(2);
      const ran = String((await step(3))?.output ?? "");
      const own = PRODUCED.get("d-2") ?? "<none>";
      if (second?.status !== "completed" || !String(second.output ?? "").includes(own) || !ran.includes(own)) {
        failures.push(`d:the next step sees a value only the step in its own session produced — step 2 ${second?.status}, its token ${own}; step 3 read ${ran.slice(0, 300)}`);
      }
      const ownSession = (await s.runtime.stores.request.list({})).find(
        (r: { actionName: string; input?: unknown }) => r.actionName === "work" && JSON.stringify(r.input ?? "").includes(`"goal":"${word("d-step-2")}`)
      ) as { sessionId?: string } | undefined;
      if (ownSession?.sessionId === undefined || ownSession.sessionId === task?.run?.sessionId) {
        failures.push(`d:the step ran in a session of its own — it ran in ${ownSession?.sessionId}, its task in ${task?.run?.sessionId}`);
      }
      notes.push(`d: the drain parked ${parks} times while step 2 ran in ${ownSession?.sessionId}; step 3 read ${own}`);

      // The step in its own session is the plan's last: when it ends nothing is left open, and
      // the request that waited on it still owes the worker's answering turn, once (FIX-2110).
      const lastPlan = scripted(word("d-last-plan"), [
        { tool: "createTask", args: { goal: scripted(word("d-last-1"), [{ answer: "d-last-1" }]), assignee: "doer.a" } },
        {
          tool: "createTask",
          args: { goal: scripted(word("d-last-2"), [{ hold: "d-last" }, { answer: "d-last-2" }]), assignee: "doer.a", session: "new", deps: ["$0"] }
        },
        { answer: "d-last-plan" }
      ]);
      await s.send("desk", conversation, "respond", {
        message: scripted("d-last-file", [{ tool: "createTask", args: { goal: lastPlan, assignee: "doer.a" } }, { answer: "d-last-file" }])
      });
      const lastStep = () => s.steps().then((rows) => rows.find((row) => row.goal.startsWith(word("d-last-2"))));
      await s.until(async () => (await lastStep())?.status === "in_progress", 15_000);
      const answeredBefore = CALLS.filter((call) => call.last.startsWith(ANSWERING)).length;
      gate("d-last").open();
      await s.until(async () => (await s.byGoal(word("d-last-plan")))[0]?.status === "completed", 20_000);
      await s.idle();
      const lastOwn = PRODUCED.get("d-last-2") ?? "<none>";
      const landed = String((await s.byGoal(word("d-last-plan")))[0]?.output ?? "");
      const answered = CALLS.filter((call) => call.last.startsWith(ANSWERING)).length - answeredBefore;
      if ((await lastStep())?.status !== "completed" || !landed.includes(`read=${ANSWERING}`) || !landed.includes(lastOwn) || answered !== 1) {
        failures.push(
          `d:with the step in its own session last, the worker answers once after it, told its result — step ${(await lastStep())?.status}; ${answered} answering turn(s); its task landed ${landed.slice(0, 300)}`
        );
      }
      notes.push(`d: with that step last, ${answered} answering turn, its task landed the answer told ${lastOwn}`);
    });
  } finally {
    for (const host of hosts) await host.state.dispose().catch(() => undefined);
  }
  return { failures, evidence: notes.join(" · ") };
});

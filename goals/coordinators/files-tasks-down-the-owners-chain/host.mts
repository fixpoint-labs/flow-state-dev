/**
 * Legs a, c and d's host: a goal-local coordinator tree on the real engine,
 * its HTTP router and a SQLite store, driven through the shipped clients as
 * two people who each present their own verified bearer. No real model: the
 * coordinators' judgment and the `agent` workers' turns are scripted by marks
 * in what they read.
 *
 * It only acts, and reports what each action answered on one `__GOAL__<json>`
 * line; `run.mts` grades, reading the store file this host writes. Run by
 * `run.mts` as its own process, so a control's module patch is in place
 * before any Workforce module loads. Against another commit, `run.mts` copies
 * this file and `fixtures/` into that checkout's `goals/`, so every import
 * resolves to that commit's packages.
 *
 * The tree (`fixtures/workforce/`): `desk.lead`, a coordinator whose
 * delegates are `desk.alpha` and `desk.beta` (both on `agent`) and
 * `desk.sub`, a coordinator. Scripts:
 *
 * - a coordinator's turn files a `[file:<worker>]` message as a task for that
 *   worker, with the message less that mark as its goal, through its own
 *   `addTask` tool; a `[split:<worker>]` message it tries to split, filing a
 *   piece for that worker; a line that tells it a task ended it notes, and
 *   files nothing; anything else it notes;
 * - an `agent` worker's turn holds its answer for `[slow:<ms>]`, fails on
 *   `[fail]`, and otherwise answers `Done: <the task>`.
 *
 * Nothing here writes a row, a session or a notice: every change is an
 * action a person sends, or what the system does with it. The engine's
 * request store is read only to wait until nothing runs.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as engine from "@flow-state-dev/engine";
import { createClient, createSessionClient } from "@flow-state-dev/client";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import * as workforce from "@flow-state-dev/workforce";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const STORE = process.env.GOAL_STORE ?? "";
const LEGS = new Set((process.env.GOAL_LEGS ?? "a,c,d").split(",").map((s) => s.trim()).filter(Boolean));
/** The organization both people sign in to. */
const ORG = "goal-org";
/** The two people, each with their own verified bearer. */
const PEOPLE = {
  alice: { userId: "u_goal_alice", bearer: "goal-verified-alice" },
  bob: { userId: "u_goal_bob", bearer: "goal-verified-bob" },
} as const;
/** How long leg a's delegate holds its answer, so the filing can be seen returning first. */
const HOLD_MS = 2_500;
/** How long leg c's slow task runs, so the other conversation's board runs while it does. */
const SLOW_MS = 4_000;
/** The wait after things go quiet, before the run reports and the store is read again. */
const GRACE_MS = 5_000;

const report = (value: unknown) => process.stdout.write(`__GOAL__${JSON.stringify(value)}\n`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const WORDS = ["heron", "copper", "lantern", "marble", "saffron", "willow", "ember", "glacier", "orchid", "tinsel"];
const word = () => `${WORDS[randomBytes(1)[0]! % WORDS.length]}${randomBytes(3).toString("hex")}`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

if (STORE === "") {
  report({ setup: "GOAL_STORE names no store file" });
  process.exit(0);
}

const wf = workforce as unknown as Record<string, any>;
const missing = ["createWorkerInstallation", "defineAgentWorkerFlow", "defineCoordinatorFlow", "hireWorkforce"].filter(
  (name) => typeof wf[name] !== "function",
);
if (missing.length > 0) {
  report({ setup: `this commit's @flow-state-dev/workforce exports no ${missing.join(", ")}` });
  process.exit(0);
}

const tree = await readWorkforce(join(HERE, "fixtures", "workforce"));
if (tree.errors.length > 0) {
  report({ setup: `the goal-local tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}` });
  process.exit(0);
}

// ---- the scripted models ----------------------------------------------------

type Message = { role?: string; content?: unknown };

/** A message's text, whatever shape its content takes. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : JSON.stringify(part?.output ?? part ?? ""))).join("");
  return JSON.stringify(content ?? "");
}

/** The last thing a person (or a notice) said in this turn, and the tool results since. */
function lastAsk(messages: Message[]): { asked: string; results: Message[] } {
  let at = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") {
      at = i;
      break;
    }
  }
  return { asked: at < 0 ? "" : textOf(messages[at]!.content), results: messages.slice(at + 1).filter((m) => m.role === "tool") };
}

const judgment = {
  modelId: "scripted/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Message[] }) {
    const { asked, results } = lastAsk(options.messages ?? []);
    // A notice that a task ended: noted, and nothing filed.
    if (asked.startsWith('Task "')) return { text: "Noted.", finishReason: "stop" };
    if (results.length === 0) {
      const file = /\[file:([a-z.-]+)\]/.exec(asked);
      if (file !== null) {
        const goal = asked.replace(file[0], "").trim();
        return { toolCalls: [{ toolCallId: "file-0", toolName: "addTask", args: { goal, assignee: file[1] } }], finishReason: "tool-calls" };
      }
      const split = /\[split:([a-z.-]+)\]/.exec(asked);
      if (split !== null) {
        const goal = `a piece of: ${asked.replace(split[0], "").trim()}`;
        return { toolCalls: [{ toolCallId: "split-0", toolName: "addTask", args: { goal, assignee: split[1] } }], finishReason: "tool-calls" };
      }
      return { text: "Noted.", finishReason: "stop" };
    }
    return { text: `The filing answered: ${textOf(results.at(-1)!.content).slice(0, 400)}`, finishReason: "stop" };
  },
};

const agentModel = {
  modelId: "scripted/agent",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Message[] }) {
    const { asked } = lastAsk(options.messages ?? []);
    const slow = /\[slow:(\d+)\]/.exec(asked);
    if (slow !== null) await sleep(Number(slow[1]));
    if (asked.includes("[fail]")) throw new Error(`the scripted worker could not do: ${asked.slice(0, 120)}`);
    return { text: `Done: ${asked.slice(0, 200)}`, finishReason: "stop" };
  },
};

const modelResolver = Object.assign(
  (_id: string, block?: string) => {
    if (block?.startsWith("coordinator-judgment")) return judgment;
    if (block?.startsWith("agent-answer")) return agentModel;
    throw new Error(`the goal scripts no model for block "${block}"`);
  },
  { resolveId: (id: string) => id },
);

// ---- the app ----------------------------------------------------------------

let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });
const agent = wf.defineAgentWorkerFlow({ installation });
const coordinator = wf.defineCoordinatorFlow({ installation, delegateFlows: [agent], routeModel: "scripted/route" });
flows = { agent, coordinator };
const copies = wf.hireWorkforce(installation) as Array<{ id: string }>;
const ROSTER = (copies.find((copy) => copy.id !== "agent" && copy.id !== "coordinator")?.id ?? "workforce-roster") as string;

const bearers = Object.values(PEOPLE).map((person) =>
  engine.createBearerSecretPrincipalResolver({ secret: person.bearer, principal: { userId: person.userId, orgId: ORG } }),
);
/** One secret per person; a request with none, or one nobody recognises, is refused. */
const resolvePrincipal = async (context: unknown) => {
  for (const verify of bearers) {
    try {
      const principal = await verify(context as never);
      if (principal !== null) return principal;
      break;
    } catch (error) {
      if (!(error instanceof engine.PrincipalResolutionError)) throw error;
    }
  }
  throw new engine.PrincipalResolutionError("no verified bearer");
};

const state = engine.createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  stores: { default: { primary: sqliteStores({ filename: STORE }) } },
  modelResolver,
  resolvePrincipal,
} as never) as any;

type Person = (typeof PEOPLE)[keyof typeof PEOPLE];

/** A person signed in to the router: their bearer on every request. */
function connect(person: Person) {
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const router = await state.getRouter();
    const url = new URL(String(input), "http://goal.local");
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${person.bearer}`);
    const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    return router[(init?.method ?? "GET").toUpperCase()](new Request(url, { ...init, headers }), { params: { path } });
  };
  const transport = { baseUrl: "http://goal.local", fetcher: fetcher as typeof fetch };
  return {
    person,
    sessions: createSessionClient(transport) as any,
    workforce: createWorkforceClient({ userId: person.userId, ...transport }) as any,
    flow: (flowKind: string) => createClient({ flowKind, userId: person.userId, ...transport }) as any,
    get: (path: string) => fetcher(`http://goal.local/api/flows${path}`),
  };
}
type Connected = ReturnType<typeof connect>;

/** One action's end: how it ended, and what it answered or why it was refused. */
type Acted = { status: string; requestId: string | null; output: any; error: string | undefined; startedAt: number; endedAt: number };

const TERMINAL = new Set(["completed", "failed", "incomplete", "aborted", "interrupted"]);

async function act(who: Connected, flowKind: string, sessionId: string, action: string, input: unknown): Promise<Acted> {
  const startedAt = Date.now();
  const client = who.flow(flowKind);
  let requestId: string;
  try {
    requestId = (await client.sendAction(action, input, { sessionId })).request.id;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    return { status: `http ${typeof status === "number" ? status : "?"}`, requestId: null, output: undefined, error: messageOf(error), startedAt, endedAt: Date.now() };
  }
  let status = "timed-out";
  for (const until = Date.now() + 60_000; Date.now() < until; await sleep(25)) {
    const now = (await client.getRequestStatus(requestId).catch(() => undefined))?.status as string | undefined;
    if (now !== undefined && TERMINAL.has(now)) {
      status = now;
      break;
    }
  }
  const endedAt = Date.now();
  const listed = (await who.sessions.listSessionRequests(sessionId, { includeResultOutput: true, limit: 200 }).catch(() => [])) as any[];
  const found = listed.find((r) => r.id === requestId);
  return { status, requestId, output: found?.result?.output, error: found?.result?.error?.message, startedAt, endedAt };
}

/** Open a conversation with `worker` on the coordinator flow, as an app opens one. */
async function conversation(who: Connected, worker: string): Promise<string> {
  const created = await who.sessions.createSession({ flowKind: "coordinator", userId: who.person.userId, state: { workerId: worker } });
  return created.id as string;
}

/** The tool outputs one request's turn produced, in order, read through the session's items. */
async function toolOutputs(who: Connected, sessionId: string, requestId: string | null): Promise<Array<{ name: string; output: any }>> {
  if (requestId === null) return [];
  const state = await who.sessions.getSessionState(sessionId, { includeItems: true, itemTypes: ["tool_output"], limit: 500 });
  return ((state.items ?? []) as any[])
    .filter((item) => item.requestId === requestId)
    .map((item) => ({ name: String(item.toolCall?.name ?? ""), output: parsed(item.output ?? item.error ?? null) }));
}

function parsed(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Nothing running or waiting to run, three reads in a row. The request store is read only for this. */
async function quiet(timeoutMs = 90_000): Promise<number> {
  const runtime = await state.getRuntime();
  let calm = 0;
  for (const until = Date.now() + timeoutMs; Date.now() < until; await sleep(100)) {
    const running = ((await runtime.stores.request.list({})) as Array<{ status: string }>).some((r) =>
      ["pending", "queued", "in_progress", "running"].includes(r.status),
    );
    calm = running ? 0 : calm + 1;
    if (calm >= 3) return Date.now();
  }
  throw new Error(`something kept running for ${timeoutMs / 1000} s`);
}

/** A conversation's `filingSessionId`, as its own `listDelegates` answers it: what an app finds its sessions by. */
async function filingOf(who: Connected, sessionId: string): Promise<string> {
  const listed = await act(who, "coordinator", sessionId, "listDelegates", {});
  return (listed.output?.filingSessionId as string | undefined) ?? `(listDelegates answered ${listed.status}: ${listed.error ?? ""})`;
}

/** `findWorkerSession`, as the app calls it; what it threw, if it did. */
async function find(who: Connected, criteria: Record<string, string>): Promise<{ id: string | null; error?: string }> {
  try {
    const found = await who.workforce.findWorkerSession(criteria);
    return { id: found?.id ?? null };
  } catch (error) {
    return { id: null, error: messageOf(error) };
  }
}

const taskIdOf = (acted: Acted | { output: any }) => (acted.output?.ok === true ? (acted.output.taskId as string) : null);

// ---- the legs -------------------------------------------------------------------

try {
  const alice = connect(PEOPLE.alice);
  const bob = connect(PEOPLE.bob);
  const out: Record<string, unknown> = { org: ORG, people: PEOPLE, holdMs: HOLD_MS, slowMs: SLOW_MS, graceMs: GRACE_MS };

  // a: Alice's coordinator files a task for her `agent` delegate, and the
  // interim rule: a delegate's task session that tries to file is refused.
  let legA: Record<string, unknown> | undefined;
  if (LEGS.has("a")) {
    const conv = await conversation(alice, "desk.lead");
    const w = word();
    const filing = await act(alice, "coordinator", conv, "run", { message: `[file:desk.alpha] [slow:${HOLD_MS}] Summarize the ${w} notes` });
    const filed = await toolOutputs(alice, conv, filing.requestId);
    const taskId = filed.filter((t) => t.name === "addTask").map((t) => taskIdOf(t)).find((id) => id !== null) ?? null;
    const quietAt = await quiet();
    const filingSessionId = await filingOf(alice, conv);
    const found = taskId === null ? null : await find(alice, { worker: "desk.alpha", taskId, filingSessionId });

    // The interim rule: desk.sub's task session tries to file a piece, by its own tool and by the app.
    const w2 = word();
    const splitting = await act(alice, "coordinator", conv, "run", { message: `[file:desk.sub] [split:desk.beta] Plan the ${w2} rollout` });
    const subFiled = await toolOutputs(alice, conv, splitting.requestId);
    const subTaskId = subFiled.filter((t) => t.name === "addTask").map((t) => taskIdOf(t)).find((id) => id !== null) ?? null;
    await quiet();
    const subSession = subTaskId === null ? null : await find(alice, { worker: "desk.sub", taskId: subTaskId, filingSessionId });
    const appSplit =
      subSession?.id == null ? null : await act(alice, "coordinator", subSession.id, "addTask_tasks", { goal: `another piece of the ${w2} rollout`, assignee: "desk.alpha" });
    await quiet();
    legA = {
      conv,
      filingSessionId,
      word: w,
      filing,
      filed,
      taskId,
      quietAt,
      found,
      split: { word: w2, turn: splitting, filed: subFiled, taskId: subTaskId, session: subSession, app: appSplit },
    };
    out.a = legA;
  }

  // c: two of Alice's conversations with one coordinator, each filing one
  // task; the first names the second's task once.
  if (LEGS.has("c")) {
    const c1 = await conversation(alice, "desk.lead");
    const c2 = await conversation(alice, "desk.lead");
    const words = { t1: word(), t2: word(), t3: word() };
    // Unassigned, with three delegates that take tasks: it waits to be assigned.
    const t2 = await act(alice, "coordinator", c2, "addTask_tasks", { goal: `[slow:${SLOW_MS}] Draft the ${words.t2} brief` });
    const t1 = await act(alice, "coordinator", c1, "addTask_tasks", { goal: `Tidy the ${words.t1} list`, assignee: "desk.alpha" });
    await quiet();
    // The first conversation names the second's task by its id.
    const reach = await act(alice, "coordinator", c1, "assignTask_tasks", { taskId: taskIdOf(t2) ?? "none", assignee: "desk.alpha" });
    await quiet();
    // The second assigns its own task, which runs for a while.
    const assign = await act(alice, "coordinator", c2, "assignTask_tasks", { taskId: taskIdOf(t2) ?? "none", assignee: "desk.beta" });
    await sleep(1_000);
    // While it runs, the first conversation files another.
    const t3 = await act(alice, "coordinator", c1, "addTask_tasks", { goal: `Check the ${words.t3} links`, assignee: "desk.alpha" });
    const quietAt = await quiet();
    // Each conversation's own read.
    const list1 = await act(alice, "coordinator", c1, "listTasks_tasks", {});
    const list2 = await act(alice, "coordinator", c2, "listTasks_tasks", {});
    const ids = { t1: taskIdOf(t1), t2: taskIdOf(t2), t3: taskIdOf(t3) };
    const filing = { c1: await filingOf(alice, c1), c2: await filingOf(alice, c2) };
    const finds: Record<string, { id: string | null; error?: string }> = {};
    for (const [label, worker, taskId] of [
      ["t1", "desk.alpha", ids.t1],
      ["t2", "desk.beta", ids.t2],
      ["t3", "desk.alpha", ids.t3],
    ] as const) {
      if (taskId === null) continue;
      finds[`${label}@c1`] = await find(alice, { worker, taskId, filingSessionId: filing.c1 });
      finds[`${label}@c2`] = await find(alice, { worker, taskId, filingSessionId: filing.c2 });
    }
    out.c = { c1, c2, filing, words, ids, filed: { t1, t2, t3 }, reach, assign, quietAt, list1, list2, finds };
  }

  // d: Bob reaches into Alice's conversation, and names her worker on his own.
  if (LEGS.has("d")) {
    const dA = await conversation(alice, "desk.lead");
    const hers = `alice-${word()}`;
    const hired = await act(alice, ROSTER, `roster-${PEOPLE.alice.userId}`, "hire", { id: hers, flow: "agent", description: "Does Alice's errands." });
    const added = await act(alice, "coordinator", dA, "addDelegate", { worker: hers });
    const w = word();
    const herTask = await act(alice, "coordinator", dA, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: hers });
    await quiet();
    await sleep(50);
    const bobStartedAt = Date.now();
    const opened = await bob.get(`/sessions/${encodeURIComponent(dA)}`);
    const open = { status: opened.status, body: (await opened.text()).slice(0, 300) };
    const post = await act(bob, "coordinator", dA, "run", { message: `[file:desk.alpha] Sort the ${w} receipts` });
    const file = await act(bob, "coordinator", dA, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: "desk.alpha" });
    const dB = await conversation(bob, "desk.lead");
    const missingWorker = `nobody-${word()}`;
    const nameHers = await act(bob, "coordinator", dB, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: hers });
    const nameMissing = await act(bob, "coordinator", dB, "addTask_tasks", { goal: `Sort the ${w} receipts`, assignee: missingWorker });
    const addHers = await act(bob, "coordinator", dB, "addDelegate", { worker: hers });
    const bw = word();
    const bobsOwn = await act(bob, "coordinator", dB, "addTask_tasks", { goal: `File the ${bw} invoices`, assignee: "desk.alpha" });
    const quietAt = await quiet();
    out.d = { dA, dB, hers, missingWorker, hired, added, herTask, bobStartedAt, open, post, file, nameHers, nameMissing, addHers, bobsOwn, word: w, bobWord: bw, quietAt };
  }

  // The grace: anything late (a second notice, a stray run) lands before the store is read again.
  await sleep(GRACE_MS);
  out.gracedAt = await quiet();
  report(out);
} catch (error) {
  report({ setup: `the host failed: ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}` });
}
await state.dispose?.().catch(() => undefined);
process.exit(0);

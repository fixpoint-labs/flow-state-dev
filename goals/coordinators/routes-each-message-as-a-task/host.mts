/**
 * The goal's host: a coordinator tree written at run time, on the real engine
 * over a SQLite file with durable execution (so it keeps wakes), its HTTP
 * router, and the shipped clients, with scripted delegates and scripted model
 * turns. No real model.
 *
 * It reports what it did, and the few reads only a moment can show, on one
 * `__GOAL__<json>` line; `run.mts` grades that and the store file. Run by
 * `run.mts` as its own process, so a control's module patch is in place before
 * any Workforce module loads, and so leg b can kill it. Against another
 * commit, `run.mts` copies this file into that checkout's `goals/`, so every
 * import resolves to that commit's packages.
 *
 * `GOAL_PHASE` picks what it runs, on the tree and store under `GOAL_SCRATCH`:
 *
 * - `all` (the default): legs a, b (failed and late), c, d, e and the sweep;
 * - `kill`: leg b's first half. One message to `desk.restart`, whose first
 *   delegate works far past the round's deadline; once the other delegate's
 *   answer has landed and the first is still working, it reports and waits to
 *   be killed;
 * - `restart`: leg b's second half, on the same store. It starts the host and
 *   reports when the round `kill` left open closes.
 *
 * The tree: four delegates on the goal's `helper` flow, their ids and order
 * picked at run time, a `writer` on the built-in `agent` flow whose delegate
 * is the first of them, and these coordinators:
 *
 * - `desk.all`, `everyone`, over all four (leg a: the tasks, the touches);
 * - `desk.judge`, `judgment`, over the first two (legs a and d);
 * - `desk.one`, `everyone`, over the third (leg a: a busy delegate);
 * - `desk.rounds`, `everyone` with `rounds: 1`, over the first two (leg a: a cancel);
 * - `desk.late`, the same (leg b: a late delegate);
 * - `desk.fails`, `everyone` with `rounds: 1`, over the first and third (leg b: a failed one);
 * - `desk.restart`, the same as `desk.late` (leg b: the restart);
 * - `desk.write`, `everyone`, over the writer (leg c);
 * - `desk.legacy`, `everyone`, over the fourth (leg e);
 * - `desk.fit`, `best-fit` over the second and third, the third its fallback (leg d: the one fit check);
 * - `desk.vet`, `judgment` over the first, with `openWorkstream`, whose lead `desk.lead` is checked (leg d).
 *
 * One scripted evaluation answers every fit judgment, best fit's and the lead
 * vet's, and records each call: leg d grades that record.
 *
 * Scripts, by marks in the message, so they follow it wherever it goes: a
 * delegate answers `<worker> answers: <what it was handed>`, holds that answer
 * {@link SLOW_MS} on `[slow:<worker>]` and {@link SLOWER_MS} on
 * `[slower:<worker>]`, and fails on `[fail:<worker>]`. The judgment turn files a
 * `[judge]` message for the first delegate twice, with a goal of its own and
 * no `maxAttempts`, and a `[judge-3]` one with `maxAttempts: 3`. The writer
 * files a piece for the first delegate on a `[write]` message, ends its turn,
 * and answers the piece's ending with what the piece came back with.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@flow-state-dev/core";
import * as engine from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { mockEvaluationModel } from "@flow-state-dev/testing";
import * as workforce from "@flow-state-dev/workforce";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { z } from "zod";
import { boardRowPrefix, isRoutedTask } from "../../lib/routed-tasks.mts";
import { writeGoalReport } from "../../lib/driver.mts";

const ORG = "goal-org";
const ALICE = "u_alice";
/** How long a `[slow:<worker>]` mark holds that worker's answer: past the round's deadline. */
const SLOW_MS = 3_000;
/** How long a `[slower:<worker>]` mark holds it: far past the deadline, so it is still working when leg b kills the host. */
const SLOWER_MS = 20_000;
/** How long a round waits for its answers. */
const DEADLINE_MS = 2_000;
/** How many times leg a touches the board while the endings are owed. */
const TOUCHES = 5;
/** How long the check waits after things go quiet before it reads again. */
const GRACE_MS = 3_000;
/** How long the restart's watch runs past the deadline before it gives up on the round. */
const WATCH_MS = 8_000;

const PHASE = process.env.GOAL_PHASE ?? "all";
const SCRATCH = process.env.GOAL_SCRATCH;
if (SCRATCH === undefined || SCRATCH === "") throw new Error("GOAL_SCRATCH names the run's scratch directory");

const hex = (n: number) => randomBytes(n).toString("hex");
const word = () => `${["amber", "cobalt", "fjord", "quill", "tundra", "velvet"][randomBytes(1)[0]! % 6]}-${hex(3)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const wf = workforce as unknown as Record<string, any>;
const missing = ["defineCoordinatorFlow", "workerTaskEntry", "defineAgentWorkerFlow", "createWorkerInstallation", "hireWorkforce", "workerConfigSchema"].filter(
  (name) => typeof wf[name] !== "function",
);
if (missing.length > 0) {
  await writeGoalReport({ setup: `this commit's @flow-state-dev/workforce exports no ${missing.join(", ")}, so no coordinator can be built` });
  process.exit(0);
}
/** A commit from before routed tasks: its delegates take posts, on an entry of their own. */
const POST_ERA = typeof wf.delegatedPostEntry === "function";

// ---- the tree, written once per run, read by every phase --------------------

const storeFile = join(SCRATCH, "store.sqlite");
const namesFile = join(SCRATCH, "names.json");
if (!existsSync(namesFile)) {
  mkdirSync(SCRATCH, { recursive: true });
  // Four delegate names, in a random order: `desk.<name>` is each one's id.
  const picked = Array.from({ length: 4 }, () => `d${hex(3)}`).sort(() => randomBytes(1)[0]! - 128);
  writeFileSync(namesFile, JSON.stringify(picked));
}
const names = JSON.parse(readFileSync(namesFile, "utf8")) as string[];
const delegates = names.map((name) => `desk.${name}`);
const [first, second, third, fourth] = delegates as [string, string, string, string];
const WRITER = "desk.writer";
/** Leg d's lead: on the built-in `agent` flow, which can lead a workstream, its one delegate the first. */
const LEAD = "desk.lead";
/** Leg d's project, which Alice creates and opens workstreams in. */
const PROJECT = { visibility: "shared", id: "goal-project" };
const coordinators: Record<string, { routing: string; rounds?: number; delegates: string[]; fallback?: string; tools?: string[] }> = {
  all: { routing: "everyone", delegates },
  judge: { routing: "judgment", delegates: [first, second] },
  one: { routing: "everyone", delegates: [third] },
  rounds: { routing: "everyone", rounds: 1, delegates: [first, second] },
  late: { routing: "everyone", rounds: 1, delegates: [first, second] },
  fails: { routing: "everyone", rounds: 1, delegates: [first, third] },
  restart: { routing: "everyone", rounds: 1, delegates: [first, second] },
  write: { routing: "everyone", delegates: [WRITER] },
  legacy: { routing: "everyone", delegates: [fourth] },
  fit: { routing: "best-fit", delegates: [second, third], fallback: third },
  vet: { routing: "judgment", delegates: [first], tools: ["openWorkstream"] },
};
const treeDir = join(SCRATCH, "workforce");
const workerFile = (name: string, body: string) => {
  const dir = join(treeDir, "teams", "desk", "workers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "WORKER.md"), body);
};
for (const name of names) {
  workerFile(name, `---\ndescription: Answers what it is handed.\nflow: helper\n---\n\nYou answer what you are handed.\n`);
}
workerFile("writer", `---\ndescription: Writes pieces, with help.\nflow: agent\nmodel: scripted/writer\ndelegates: [${first}]\n---\n\nHave each piece drafted, then answer with the draft.\n`);
workerFile("lead", `---\ndescription: Leads code review and release work.\nflow: agent\nmodel: scripted/writer\ndelegates: [${first}]\n---\n\nRun the workstream through your delegate.\n`);
for (const [name, c] of Object.entries(coordinators)) {
  workerFile(
    name,
    `---\ndescription: Hands each message on.\nflow: coordinator\nmodel: scripted/judgment\nrouting: ${c.routing}\n` +
      `delegates: [${c.delegates.join(", ")}]\n${c.rounds === undefined ? "" : `rounds: ${c.rounds}\n`}` +
      `${c.fallback === undefined ? "" : `fallback: ${c.fallback}\n`}${c.tools === undefined ? "" : `tools: [${c.tools.join(", ")}]\n`}---\n\nHand each message on.\n`,
  );
}
const tree = await readWorkforce(treeDir);
if (tree.errors.length > 0) {
  await writeGoalReport({ setup: `the run's tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}` });
  process.exit(0);
}

// ---- the app ----------------------------------------------------------------

let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });

/** Every message a helper delegate was handed: by whom, in which session, when. */
const heard: Array<{ worker: string; message: string; sessionId: string; at: number }> = [];

const doorInput = z.object({ message: z.string() });
const door = core.handler({
  name: "goal-helper-run",
  inputSchema: doorInput,
  resources: { ...installation.resources },
  execute: async (input: { message: string }, ctx: any) => {
    const worker = await installation.resolveWorker(ctx, "helper");
    heard.push({ worker: worker.id, message: input.message, sessionId: ctx.session.identity.id, at: Date.now() });
    if (input.message.includes(`[fail:${worker.id}]`)) throw new Error(`${worker.id} fails on this message`);
    if (input.message.includes(`[slow:${worker.id}]`)) await sleep(SLOW_MS);
    if (input.message.includes(`[slower:${worker.id}]`)) await sleep(SLOWER_MS);
    return `${worker.id} answers: ${input.message}`;
  },
});
const work = wf.workerTaskEntry({ name: "goal-helper-task", turn: door });
const helper = core.defineFlow({
  kind: "helper",
  configSchema: wf.workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
  // A delegate is a worker whose flow takes tasks (FIX-2083). Before it, a post had an entry of its own.
  task: { actions: { [wf.WORKER_TASK_ENTRY ?? "work"]: work, ...(POST_ERA ? { onDelegatedPost: wf.delegatedPostEntry(door) } : {}) } },
} as never);
const agent = wf.defineAgentWorkerFlow({ installation });

type StepOptions = { messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ name: string; parameters?: unknown }> };

/** The tool definitions each judgment step was offered, by name: the sweep reads their fields. */
const offered = new Map<string, unknown>();

/** The text of the last user message of a call, and the tool results after it. */
function turnOf(options: StepOptions) {
  const messages = options.messages ?? [];
  const last = messages.map((m) => m.role).lastIndexOf("user");
  return {
    asked: last < 0 ? "" : JSON.stringify(messages[last]!.content).replaceAll("\\", ""),
    after: messages.slice(last + 1).filter((m) => m.role === "tool").map((m) => JSON.stringify(m.content)),
  };
}

/** One routed hand-off, as this commit's judgment turn makes one. */
const handTo = (assignee: string, extra: Record<string, unknown> = {}) =>
  POST_ERA
    ? { toolName: "createTask", args: { post: true, assignee } }
    : { toolName: "createTask", args: { goal: "Answer this message", assignee, session: "ongoing", resultTo: "conversation", ...extra } };

/** The judgment turn: a `[judge]` message goes to the first delegate twice; `[judge-3]` once, asking for three attempts. */
const judgment = {
  modelId: "scripted/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: StepOptions) {
    for (const tool of options.tools ?? []) offered.set(tool.name, tool.parameters);
    const { asked, after } = turnOf(options);
    // Leg d: open a workstream under the lead, for research it doesn't lead, or for work that is only a name.
    const vet = /\[vet-(misfit|bare)\] ([a-z]+-[0-9a-f]+)/.exec(asked);
    if (vet !== null) {
      if (after.length > 0) return { text: "Done.", finishReason: "stop" };
      const [, kind, w] = vet;
      const title = kind === "misfit" ? `Research what to build next, ${w}` : w!;
      const args = { project: PROJECT, id: `${kind}-${w}`, title, lead: LEAD, ...(kind === "misfit" ? { objectives: ["Rank three ideas"] } : {}) };
      return { toolCalls: [{ toolCallId: `vet-${kind}`, toolName: "openWorkstream", args }], finishReason: "tool-calls" };
    }
    if (asked.includes("[judge-3]") && after.length < 1) {
      return { toolCalls: [{ toolCallId: "hand-3", ...handTo(first, { maxAttempts: 3 }) }], finishReason: "tool-calls" };
    }
    if (asked.includes("[judge]") && after.length < 2) {
      return { toolCalls: [{ toolCallId: `hand-${after.length}`, ...handTo(first) }], finishReason: "tool-calls" };
    }
    return { text: after.length > 0 ? "Handed on." : "I'll take this one myself.", finishReason: "stop" };
  },
};

/**
 * The writer's turn: on a `[write]` message it files a piece for the first
 * delegate and ends; on the piece's ending it answers with what the piece
 * came back with. Its first turn says only that it filed.
 */
const writer = {
  modelId: "scripted/writer",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: StepOptions) {
    const { asked, after } = turnOf(options);
    if (after.length > 0) return { text: "Filed the piece.", finishReason: "stop" };
    const result = new RegExp(`${first.replace(".", "\\.")} answers: [^"]*`).exec(asked)?.[0];
    if (result !== undefined) return { text: `Drafted: ${result}`, finishReason: "stop" };
    const piece = /\[write\] (\S+)/.exec(asked)?.[1];
    if (piece !== undefined) {
      return { toolCalls: [{ toolCallId: "piece", toolName: "createTask", args: { goal: `Draft the piece ${piece}`, assignee: first } }], finishReason: "tool-calls" };
    }
    return { text: "OK.", finishReason: "stop" };
  },
};

/** The model leg d's fit judgments run on, best fit's and the lead vet's alike. */
const FIT_MODEL = "scripted/fit";

/**
 * Leg d's one scripted evaluation, which records every call it answers. Asked
 * about a lead (its choices hold a none-fits one), it answers none fits for
 * research and that the work doesn't say its sort for a bare name. Asked
 * best fit's question, it picks the worker a `[fit:<worker>]` mark names, and
 * fails a message with no mark.
 */
const fit = mockEvaluationModel({
  answers: ({ state, questions }) => {
    const choices = Object.keys((questions as { worker?: { criteria?: Record<string, string> } }).worker?.criteria ?? {});
    const none = choices.find((choice) => choice.includes("none"));
    if (none !== undefined) {
      const title = String((state as { work?: { title?: string } }).work?.title ?? "");
      const pick = title.startsWith("Research") ? none : !title.includes(" ") ? choices.find((choice) => choice.includes("sort"))! : LEAD;
      return { worker: { type: "choice", choice: pick, confidence: 0.9 } };
    }
    const mark = /\[fit:([^\]]+)\]/.exec(String((state as { post?: { text?: string } }).post?.text ?? ""))?.[1];
    if (mark === undefined) throw new Error("the scripted fit check has no answer for this message");
    return { worker: { type: "choice", choice: mark, confidence: 0.9 } };
  },
});

/** Every block the resolver was asked a language model for, and on which model id: leg d reads who judged fit. */
const askedModels: Array<{ block: string | null; id: string }> = [];

const modelResolver = Object.assign(
  (id: string, block?: string) => {
    askedModels.push({ block: block ?? null, id });
    if (block?.startsWith(wf.COORDINATOR_JUDGMENT ?? "coordinator-judgment")) return judgment;
    if (id === "scripted/writer") return writer;
    throw new Error(`the goal scripts no model for block "${block}" (${id})`);
  },
  {
    resolveId: (id: string) => id,
    resolveEvaluationModel: (id: string, block?: string) => {
      if (id === FIT_MODEL) return fit;
      throw new Error(`the goal scripts no evaluation for block "${block}" (${id})`);
    },
  },
);

// Leg d: a worker's open checks its lead with the fit check, on the same model as best fit.
const workstreams = wf.defineWorkstreamBlocks({ installation, leadFlows: [agent], leadFit: { model: FIT_MODEL } });
const coordinator = wf.defineCoordinatorFlow({
  installation,
  ...(POST_ERA ? { delegateFlows: [helper, agent] } : {}),
  routeModel: FIT_MODEL,
  roundDeadlineMs: DEADLINE_MS,
  agent: { catalog: { openWorkstream: workstreams.openWorkstreamTool.as({ name: "openWorkstream", description: "Open a workstream." }) } },
});
flows = { helper: { flow: helper, roles: ["contributor"] }, agent, coordinator };
/** The app's own flow, where Alice creates leg d's project and reads its workstreams. */
const lab = core.defineFlow({ kind: "lab", actions: { ...wf.defineProjectBlocks().actions, ...workstreams.actions } } as never);
const copies = wf.hireWorkforce(installation) as Array<{ id: string; task?: { actions?: object }; internal?: { actions?: object } }>;
const state = engine.createFlowState({
  flows: { ...Object.fromEntries(copies.map((copy) => [copy.id, copy])), lab: (lab as () => unknown)() },
  stores: { default: { primary: sqliteStores({ filename: storeFile }) } },
  modelResolver,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: ORG } : null;
  },
} as never) as any;

/** A fetch that hands each request to the router, as Alice. */
const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const router = await state.getRouter();
  const url = new URL(String(input), "http://goal.local");
  const headers = new Headers(init?.headers);
  headers.set("x-user", ALICE);
  const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  return router[(init?.method ?? "GET").toUpperCase()](new Request(url, { ...init, headers }), { params: { path } });
};
const transport = { fetcher: fetcher as typeof fetch };
// The app's one client, as Alice.
const fsd = createClient({ userId: ALICE, ...transport });
const people = createWorkforceClient(fsd);

const RUNNING = ["pending", "queued", "in_progress", "running"];

/** Nothing running, three reads in a row. */
async function quiet(): Promise<void> {
  const runtime = await state.getRuntime();
  let calm = 0;
  for (const until = Date.now() + 60_000; Date.now() < until; await sleep(100)) {
    const running = (await runtime.stores.request.list({})).some((r: { status: string }) => RUNNING.includes(r.status));
    calm = running ? 0 : calm + 1;
    if (calm >= 3) return;
  }
  throw new Error("something kept running for a minute");
}

/** The routed tasks on conversation `sessionId`'s board now, read from the store: a read only, as Alice. */
async function rowsNow(sessionId: string): Promise<Array<Record<string, any>>> {
  const runtime = await state.getRuntime();
  const rows = Object.values(await runtime.stores.resourceState.getByPrefix("user", `${ALICE}:~org:${ORG}`, boardRowPrefix(sessionId))) as Array<{ state: Record<string, any> }>;
  return rows.map((row) => row.state).filter(isRoutedTask);
}

type OpenRound = { postId: string; round: number; deadlineAt: number | null };

/** The conversation's open rounds now, with their deadlines, from its stored record: a read only. */
async function openRoundsNow(sessionId: string): Promise<OpenRound[]> {
  const runtime = await state.getRuntime();
  const stored = await runtime.stores.session.get(sessionId);
  return ((stored?.state?.openRounds ?? []) as Array<{ postId: string; round: number; deadlineAt?: number }>).map((r) => ({
    postId: r.postId,
    round: r.round,
    deadlineAt: r.deadlineAt ?? null,
  }));
}

/** The deadline of round `round` of message `postId`, while it is open. */
async function deadlineOf(sessionId: string, postId: string, round = 0): Promise<number | undefined> {
  const open = (await openRoundsNow(sessionId)).find((r) => r.postId === postId && r.round === round);
  return open?.deadlineAt ?? undefined;
}

/** Poll `read` until it returns something, or give up at `ms`. */
async function until<T>(read: () => Promise<T | undefined>, ms: number, every = 10): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(every)) {
    const value = await read();
    if (value !== undefined) return value;
  }
  return undefined;
}

type Item = { type?: string; role?: string; component?: string; data?: any; agentName?: string; content?: unknown; text?: string; toolCall?: { name?: string }; blockName?: string; output?: unknown; error?: unknown };

/** A conversation as Alice reads it through the session route: its routing records, its lines, and its tool results. */
async function itemsOf(sessionId: string) {
  const items: Item[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const res = await fetcher(`http://goal.local/api/flows/sessions/${encodeURIComponent(sessionId)}/state?include_items=true&offset=${offset}&limit=200`);
    const page = (await res.json()) as { items?: Item[]; pagination?: { hasMore?: boolean } };
    if (res.status !== 200) throw new Error(`reading ${sessionId}: ${res.status} ${JSON.stringify(page).slice(0, 300)}`);
    items.push(...(page.items ?? []));
    if (page.pagination?.hasMore !== true) break;
  }
  const text = (i: Item) => (typeof i.text === "string" ? i.text : Array.isArray(i.content) ? i.content.map((p: any) => p?.text ?? "").join("") : String(i.content ?? ""));
  return {
    records: items.filter((i) => i.type === "component" && i.component === (wf.COORDINATOR_ROUTE ?? "coordinator-route")).map((i) => i.data),
    lines: items.filter((i) => i.type === "message").map((i) => ({ role: i.role ?? null, agentName: i.agentName ?? null, text: text(i) })),
    tools: items.filter((i) => i.type === "tool_output").map((i) => ({ name: i.toolCall?.name ?? i.blockName ?? null, output: i.output, ...(i.error === undefined ? {} : { error: i.error }) })),
  };
}

/** One conversation with a coordinator, opened as an app opens one. */
async function conversation(worker: string) {
  const session = await people.ensureWorkerSession({ worker });
  return sessionOf(session as { id: string; flowKind: string });
}

/** A session of the app's own `lab` flow, created as Alice. */
async function labSession() {
  const res = await fetcher("http://goal.local/api/flows/lab/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: ALICE }),
  });
  const body = (await res.json()) as { session?: { id: string } };
  if (body.session === undefined) throw new Error(`creating a lab session: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return sessionOf({ id: body.session.id, flowKind: "lab" });
}

/** Send actions to one session as Alice, and read their answers back as an app does. */
function sessionOf(session: { id: string; flowKind: string }) {
  const client = fsd.flow(session.flowKind);
  /** Send an action and return as soon as it is accepted. */
  const send = async (action: string, input: unknown): Promise<{ requestId: string; error?: string }> => {
    try {
      const sent = await client.send(action, input as never, { sessionId: session.id });
      return { requestId: sent.id };
    } catch (error) {
      return { requestId: "", error: error instanceof Error ? error.message : String(error) };
    }
  };
  /** Send an action, wait for it to finish, and read its answer back from the session's requests, as an app does. */
  const act = async (action: string, input: unknown): Promise<{ requestId: string; status: string; error?: string; output?: any }> => {
    const sent = await send(action, input);
    if (sent.error !== undefined) return { ...sent, status: "refused" };
    let status = "in_progress";
    for (const end = Date.now() + 30_000; Date.now() < end && RUNNING.includes(status); await sleep(25)) {
      status = ((await client.request(sent.requestId).status()) as { status: string }).status;
    }
    const res = await fetcher(`http://goal.local/api/flows/sessions/${encodeURIComponent(session.id)}/requests?include_result_output=true&limit=500`);
    const listed = ((await res.json()) as { requests?: Array<{ id: string; result?: { output?: unknown; error?: unknown } }> }).requests ?? [];
    const found = listed.find((r) => r.id === sent.requestId);
    const error = found?.result?.error;
    return { requestId: sent.requestId, status, output: found?.result?.output, ...(error === undefined ? {} : { error: JSON.stringify(error).slice(0, 400) }) };
  };
  return { id: session.id as string, send, act };
}

/** A task as Alice's public task read gives it: `getTask` on the conversation, by id. */
async function taskRead(c: Awaited<ReturnType<typeof conversation>>, id: string) {
  const read = await c.act("getTask_tasks", { id });
  return read.output?.task ?? read.output ?? { error: read.error ?? read.status };
}

// ---- leg b's restart: kill, then restart ------------------------------------

if (PHASE === "kill") {
  try {
    await state.getRouter();
    const restart = await conversation("desk.restart");
    const w = word();
    const sent = await restart.send("respond", { message: `[slower:${first}] ${w} what do you both say?` });
    // The other delegate's answer has landed and its ending is acknowledged, and the first still works: the
    // round waits on it alone. An ending still owed would wake the conversation after the restart, and any
    // wake closes an overdue round, so the round's own deadline would go untested.
    const ready = await until(async () => {
      const rows = await rowsNow(restart.id);
      const firstRow = rows.find((r) => r.sealed.postId === sent.requestId && r.sealed.round === 0 && r.assignee === first);
      const secondRow = rows.find((r) => r.sealed.postId === sent.requestId && r.sealed.round === 0 && r.assignee === second);
      const owed = Object.entries((secondRow?.metadata ?? {}) as Record<string, unknown>).some(([key, value]) => key.startsWith("noticeOwed") && value != null);
      const landed = (await itemsOf(restart.id)).lines.some((l) => l.agentName === second && l.text.includes(w));
      return firstRow?.status === "in_progress" && secondRow?.status === "completed" && !owed && landed ? firstRow : undefined;
    }, 15_000);
    await writeGoalReport({
      phase: "kill",
      sessionId: restart.id,
      post: sent,
      word: w,
      deadlineAt: (await deadlineOf(restart.id, sent.requestId)) ?? null,
      readyAt: Date.now(),
      ready: ready !== undefined,
      openRounds: await openRoundsNow(restart.id),
    });
    // Waits here to be killed.
    await sleep(120_000);
  } catch (error) {
    await writeGoalReport({ setup: `the host failed before the kill: ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}` });
  }
  process.exit(0);
}

if (PHASE === "restart") {
  try {
    const killed = JSON.parse(process.env.GOAL_KILLED ?? "{}") as { sessionId?: string; post?: { requestId: string }; deadlineAt?: number };
    if (killed.sessionId === undefined || killed.post === undefined) throw new Error("GOAL_KILLED names no conversation");
    // The router starts the host's sweeper: from here the host serves its wakes.
    await state.getRouter();
    const restartAt = Date.now();
    const openAtRestart = await openRoundsNow(killed.sessionId);
    const deadlineAt = killed.deadlineAt ?? restartAt;
    const closedAt = await until(
      async () => ((await openRoundsNow(killed.sessionId!)).some((r) => r.postId === killed.post!.requestId && r.round === 0) ? undefined : Date.now()),
      Math.max(0, deadlineAt - Date.now()) + WATCH_MS,
      50,
    );
    const rows = (await rowsNow(killed.sessionId)).map((r) => ({ id: r.id, status: r.status, at: r.completedAt ?? null }));
    await writeGoalReport({ phase: "restart", restartAt, deadlineAt, openAtRestart, closedAt: closedAt ?? null, openAtEnd: await openRoundsNow(killed.sessionId), rows });
  } catch (error) {
    await writeGoalReport({ setup: `the restarted host failed: ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}` });
  }
  process.exit(0);
}

// ---- legs a, b, c, d, e and the sweep ----------------------------------------

try {
  await state.getRouter();
  const words = {
    rows: word(),
    twice: word(),
    three: word(),
    busy: word(),
    cancel: word(),
    late: word(),
    fails: word(),
    write: word(),
    legacy: word(),
    pick: word(),
    fallback: word(),
    misfit: word(),
    bare: word(),
  };

  // Leg a. One message to everyone: a task per delegate. As soon as the first
  // ending is written, touch the board while the rest are owed.
  const all = await conversation("desk.all");
  const rowsPost = await all.send("respond", { message: `${words.rows} what does everyone think?` });
  const firstEnded = await until(async () => ((await rowsNow(all.id)).some((r) => r.status === "completed") ? true : undefined), 15_000);
  const touches = await Promise.all(Array.from({ length: TOUCHES }, () => all.act("listTasks_tasks", {})));
  await quiet();
  await sleep(GRACE_MS);
  await quiet();
  const listed = await all.act("listTasks_tasks", {});
  const listedTasks = ((listed.output?.tasks ?? []) as Array<{ id: string }>);
  const allReads = await Promise.all(listedTasks.map((t) => taskRead(all, t.id)));

  // Leg a and d. The judgment turn files one message for the first delegate twice, its own goal, no maxAttempts.
  const judge = await conversation("desk.judge");
  const twicePost = await judge.act("respond", { message: `[judge] ${words.twice} hand this on.` });
  await quiet();
  const judgedRows = (await rowsNow(judge.id)).filter((r) => r.sealed.postId === twicePost.requestId);
  const judgedReads = await Promise.all(judgedRows.map((r) => taskRead(judge, r.id)));
  // ... and one asking for three attempts.
  const threePost = await judge.act("respond", { message: `[judge-3] ${words.three} hand this on, and try hard.` });
  await quiet();

  // Leg a. A busy delegate: a second message waits in Alice's list, then starts in the same session; a third is cancelled while it waits.
  const one = await conversation("desk.one");
  const busyA = await one.send("respond", { message: `[slow:${third}] ${words.busy} first` });
  const aWorking = await until(async () => (await rowsNow(one.id)).find((r) => r.sealed.postId === busyA.requestId && r.status === "in_progress"), 10_000);
  const busyB = await one.send("respond", { message: `${words.busy} second` });
  const busyC = await one.send("respond", { message: `${words.busy} third` });
  const waiting = await until(async () => {
    const rows = await rowsNow(one.id);
    const b = rows.find((r) => r.sealed.postId === busyB.requestId);
    const c = rows.find((r) => r.sealed.postId === busyC.requestId);
    return b !== undefined && c !== undefined ? { b: b.status as string, c: c.status as string, cId: c.id as string } : undefined;
  }, 10_000);
  const listedWaiting = ((await one.act("listTasks_tasks", {})).output?.tasks ?? []) as Array<{ id: string; status: string }>;
  const cancelWaiting = waiting === undefined ? undefined : await one.act("updateTask_tasks", { id: waiting.cId, status: "cancelled" });
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  // Leg a. A cancel: Alice cancels the first delegate's task while it works; the round closes without waiting for its deadline.
  const rounds = await conversation("desk.rounds");
  // The first delegate holds its answer past the cancel, so it still finishes, and its late settle is refused.
  const cancelPost = await rounds.send("respond", { message: `[slow:${first}] ${words.cancel} what do you both say?` });
  const hung = await until(async () => (await rowsNow(rounds.id)).find((r) => r.sealed.postId === cancelPost.requestId && r.assignee === first && r.status === "in_progress"), 10_000);
  const otherLanded = await until(async () => ((await itemsOf(rounds.id)).lines.some((l) => l.agentName === second && l.text.includes(words.cancel)) ? true : undefined), 10_000);
  const cancelDeadline = await deadlineOf(rounds.id, cancelPost.requestId);
  const cancelled = hung === undefined ? undefined : await rounds.act("updateTask_tasks", { id: hung.id, status: "cancelled" });
  const cancelledAt = Date.now();
  const cancelClosedAt = await until(
    async () => ((await openRoundsNow(rounds.id)).some((r) => r.postId === cancelPost.requestId && r.round === 0) ? undefined : Date.now()),
    10_000,
  );
  await quiet();

  // Leg b. A failed delegate: its round closes as soon as both have ended.
  const fails = await conversation("desk.fails");
  const failsPost = await fails.send("respond", { message: `[fail:${third}] ${words.fails} what do you both say?` });
  const failsDeadline = await until(() => deadlineOf(fails.id, failsPost.requestId), 10_000);
  const failsClosedAt = await until(
    async () => ((await openRoundsNow(fails.id)).some((r) => r.postId === failsPost.requestId && r.round === 0) ? undefined : Date.now()),
    10_000,
  );
  await quiet();

  // Leg b. A late delegate: its round closes at the deadline, before its answer.
  const late = await conversation("desk.late");
  const latePost = await late.send("respond", { message: `[slow:${second}] ${words.late} what do you both say?` });
  const lateRow = await until(async () => (await rowsNow(late.id)).find((r) => r.sealed.postId === latePost.requestId && r.sealed.round === 0 && r.assignee === second), 10_000);
  const deadlineAt = await until(() => deadlineOf(late.id, latePost.requestId), 10_000);
  // Watched from the deadline: when the round closes, and whether the late delegate still works then.
  let lateRowAtClose: string | null = null;
  const lateClosedAt = await until(async () => {
    if ((await openRoundsNow(late.id)).some((r) => r.postId === latePost.requestId && r.round === 0)) return undefined;
    lateRowAtClose = (await rowsNow(late.id)).find((r) => r.id === lateRow?.id)?.status ?? null;
    return Date.now();
  }, (deadlineAt ?? Date.now()) - Date.now() + WATCH_MS, 20);
  const atDeadline = { closedAt: lateClosedAt ?? null, lateRowStatus: lateRowAtClose };
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  // Leg c. The writer files a piece and ends its turn; its one answer lands once the piece ends.
  const write = await conversation("desk.write");
  const writePost = await write.send("respond", { message: `[write] ${words.write} please` });
  await until(async () => ((await itemsOf(write.id)).lines.some((l) => l.agentName === WRITER) ? true : undefined), 20_000);
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  // Leg e. A post row stored before the upgrade, on a board a warm-up message opened: the next message starts it.
  const legacy = await conversation("desk.legacy");
  await legacy.act("respond", { message: "warm up" });
  await quiet();
  const runtime = await state.getRuntime();
  const scope = `${ALICE}:~org:${ORG}`;
  const entries = (await runtime.stores.resourceState.getByPrefix("user", scope, boardRowPrefix(legacy.id))) as Record<string, { state: Record<string, any> }>;
  const warm = Object.entries(entries).find(([, value]) => typeof value.state?.sealed?.postId === "string");
  let seeded: { id: string; ok: boolean } | undefined;
  if (warm !== undefined) {
    const [key, entry] = warm;
    const stored = entry.state;
    const legacyId = `post:${hex(6)}:0:${fourth}`;
    const now = Date.now();
    const row: Record<string, any> = {
      ...stored,
      id: legacyId,
      title: `Post for ${fourth}`,
      goal: `${ALICE}, through desk.legacy: ${words.legacy} an old post`,
      status: "pending",
      assignee: fourth,
      attempts: 0,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
      incarnationId: `legacy-${hex(4)}`,
      sealed: {
        kind: "post",
        postId: `legacy-${hex(4)}`,
        round: 0,
        delegate: { worker: fourth },
        session: { key: `delegate:${JSON.stringify([fourth, null])}` },
        body: `${words.legacy} an old post`,
        from: ALICE,
        coordinator: "desk.legacy",
      },
    };
    // The fields a post row never had.
    for (const field of ["session", "resultTo", "targetSessionId", "run", "output", "startedAt", "completedAt", "leaseUntil", "claimedBy", "metadata"]) delete row[field];
    const legacyKey = key.replace(encodeURIComponent(stored.id), encodeURIComponent(legacyId));
    seeded = { id: legacyId, ok: (await runtime.stores.resourceState.set("user", scope, legacyKey, row, "any")).ok === true };
  }
  // The next message touches the board, which starts the stored row.
  await legacy.act("respond", { message: "next" });
  await until(async () => ((await itemsOf(legacy.id)).lines.some((l) => l.text.includes(words.legacy)) ? true : undefined), 15_000);
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  // Leg d. Best fit's pick and its fallback, and the lead vet on a misfit and on a bare name, each judged by the one fit check.
  const fitDesk = await conversation("desk.fit");
  const pickPost = await fitDesk.act("respond", { message: `[fit:${second}] ${words.pick} who takes this?` });
  await quiet();
  const fallbackPost = await fitDesk.act("respond", { message: `${words.fallback} who takes this?` });
  await quiet();
  const projectLab = await labSession();
  const created = await projectLab.act("createProject", { id: PROJECT.id, title: "Goal project" });
  const vet = await conversation("desk.vet");
  const misfitPost = await vet.act("respond", { message: `[vet-misfit] ${words.misfit}` });
  await quiet();
  const barePost = await vet.act("respond", { message: `[vet-bare] ${words.bare}` });
  await quiet();
  const project = await projectLab.act("readProject", { project: PROJECT });
  const opened = ((project.output?.workstreams ?? []) as Array<{ id: string }>).map((workstream) => workstream.id);

  // The sweep: what every flow declares, and the tool fields the judgment turn was offered.
  const declared = copies.map((copy) => ({
    id: copy.id,
    task: Object.keys(copy.task?.actions ?? {}),
    internal: Object.keys(copy.internal?.actions ?? {}),
  }));
  const shapeOf = (schema: any): Record<string, unknown> | undefined =>
    schema?.shape ?? schema?._def?.shape?.() ?? schema?._def?.schema?.shape ?? schema?._def?.innerType?.shape ?? schema?._def?.schema?._def?.schema?.shape;
  const toolFields = Object.fromEntries([...offered.entries()].map(([name, schema]) => [name, Object.keys(shapeOf(schema) ?? {})]));

  const read = {
    all: await itemsOf(all.id),
    judge: await itemsOf(judge.id),
    one: await itemsOf(one.id),
    rounds: await itemsOf(rounds.id),
    fails: await itemsOf(fails.id),
    late: await itemsOf(late.id),
    write: await itemsOf(write.id),
    legacy: await itemsOf(legacy.id),
    fit: await itemsOf(fitDesk.id),
    vet: await itemsOf(vet.id),
  };

  await writeGoalReport({
    phase: "all",
    postEra: POST_ERA,
    store: storeFile,
    read,
    heard,
    org: ORG,
    userId: ALICE,
    delegates,
    writer: WRITER,
    roles: { first, second, third, fourth },
    deadlineMs: DEADLINE_MS,
    slowMs: SLOW_MS,
    graceMs: GRACE_MS,
    words,
    a: {
      all: { sessionId: all.id, post: rowsPost, firstEnded: firstEnded === true, touches, listed: listedTasks, reads: allReads },
      judge: { sessionId: judge.id, twice: twicePost, three: threePost, reads: judgedReads },
      one: { sessionId: one.id, a: busyA, b: busyB, c: busyC, aWorking: aWorking?.id ?? null, waiting: waiting ?? null, listedWaiting, cancelWaiting: cancelWaiting ?? null },
      rounds: { sessionId: rounds.id, post: cancelPost, hung: hung?.id ?? null, otherLanded: otherLanded === true, cancelled: cancelled ?? null, cancelledAt, closedAt: cancelClosedAt ?? null, deadlineAt: cancelDeadline ?? null },
    },
    b: {
      fails: { sessionId: fails.id, post: failsPost, deadlineAt: failsDeadline ?? null, closedAt: failsClosedAt ?? null },
      late: { sessionId: late.id, post: latePost, deadlineAt: deadlineAt ?? null, atDeadline },
    },
    c: { sessionId: write.id, post: writePost },
    d: {
      lead: LEAD,
      fit: { sessionId: fitDesk.id, pick: pickPost, fallback: fallbackPost },
      vet: { sessionId: vet.id, created, misfit: misfitPost, bare: barePost, opened },
      // The one evaluation's own record: what each call was asked about, and its choices.
      fitCalls: fit.calls.map((call) => ({
        about: (call.state as { post?: unknown; work?: unknown }).post ?? (call.state as { work?: unknown }).work ?? call.state,
        questions: Object.keys(call.questions),
        choices: Object.keys((call.questions as { worker?: { criteria?: object } }).worker?.criteria ?? {}),
      })),
      askedModels,
    },
    e: { sessionId: legacy.id, seeded: seeded ?? null },
    sweep: { declared, toolFields },
  });
} catch (error) {
  await writeGoalReport({ setup: `the host failed: ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}`, store: storeFile });
}
process.exit(0);

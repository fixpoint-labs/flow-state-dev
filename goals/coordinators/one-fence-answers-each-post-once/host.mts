/**
 * The goal's host: a coordinator tree written at run time, on the real engine
 * over a SQLite file and its HTTP router, driven through the shipped clients,
 * with scripted delegates and a scripted judgment turn. No real model.
 *
 * It reports what it did, and the few reads only a moment can show, on one
 * `__GOAL__<json>` line; `run.mts` grades that and the store file. Run by
 * `run.mts` as its own process, so a control's module patch is in place
 * before any Workforce module loads. Against another commit, `run.mts` copies
 * this file into that checkout's `goals/`, so every import resolves to that
 * commit's packages.
 *
 * The tree: four delegates on the goal's `helper` flow, their ids and order
 * picked at run time, and four coordinators over them:
 *
 * - `desk.all`, `everyone`, over all four (leg b: rows, touches);
 * - `desk.judge`, `judgment`, over the first two (leg b: a double hand-off, a cancel);
 * - `desk.late`, `everyone` with `rounds: 1`, over the first two (leg d: a late delegate);
 * - `desk.fails`, `everyone` with `rounds: 1`, over the first and third (leg d: a failed one).
 *
 * Scripts, by marks in the post, so they follow the post wherever it goes:
 * a delegate answers `<worker> answers: <what it was handed>`, holds that
 * answer for {@link SLOW_MS} on `[slow:<worker>]`, and fails on
 * `[fail:<worker>]`; the judgment turn hands a `[judge]` post to the first
 * delegate twice, and answers anything else itself.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const ORG = "goal-org";
const ALICE = "u_alice";
/** How long a `[slow:<worker>]` mark holds that worker's answer. */
const SLOW_MS = 3_000;
/** How long a round waits for its answers: shorter than a slow answer, so a slow delegate is late. */
const DEADLINE_MS = 2_000;
/** How many times leg b touches the board while the endings are owed. */
const TOUCHES = 5;
/** How long the check waits after things go quiet before it reads again. */
const GRACE_MS = 3_000;

const hex = (n: number) => randomBytes(n).toString("hex");
const word = () => `${["amber", "cobalt", "fjord", "quill", "tundra", "velvet"][randomBytes(1)[0]! % 6]}-${hex(3)}`;
const report = (value: unknown) => process.stdout.write(`__GOAL__${JSON.stringify(value)}\n`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const wf = workforce as unknown as Record<string, any>;
const missing = ["defineCoordinatorFlow", "delegatedPostEntry", "createWorkerInstallation", "hireWorkforce", "workerConfigSchema"].filter(
  (name) => typeof wf[name] !== "function",
);
if (missing.length > 0) {
  report({ setup: `this commit's @flow-state-dev/workforce exports no ${missing.join(", ")}, so no coordinator can be built` });
  process.exit(0);
}

// ---- the tree, written at run time -------------------------------------------

const scratch = join(tmpdir(), `fsd-goal-one-fence-${Date.now()}-${hex(3)}`);
const storeFile = join(scratch, "store.sqlite");
// Four delegate names, in a random order: `desk.<name>` is each one's id.
const names = Array.from({ length: 4 }, () => `d${hex(3)}`).sort(() => randomBytes(1)[0]! - 128);
const [first, second, third] = names.map((name) => `desk.${name}`) as [string, string, string, string];
const delegates = names.map((name) => `desk.${name}`);
const coordinators: Record<string, { routing: string; rounds?: number; delegates: string[] }> = {
  all: { routing: "everyone", delegates },
  judge: { routing: "judgment", delegates: [first, second] },
  late: { routing: "everyone", rounds: 1, delegates: [first, second] },
  fails: { routing: "everyone", rounds: 1, delegates: [first, third] },
};
const workerFile = (name: string, body: string) => {
  const dir = join(scratch, "workforce", "teams", "desk", "workers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "WORKER.md"), body);
};
for (const name of names) {
  workerFile(name, `---\ndescription: Answers what it is handed.\nflow: helper\n---\n\nYou answer what you are handed.\n`);
}
for (const [name, c] of Object.entries(coordinators)) {
  workerFile(
    name,
    `---\ndescription: Hands each post on.\nflow: coordinator\nmodel: scripted/judgment\nrouting: ${c.routing}\n` +
      `delegates: [${c.delegates.join(", ")}]\n${c.rounds === undefined ? "" : `rounds: ${c.rounds}\n`}---\n\nHand each post on.\n`,
  );
}
const tree = await readWorkforce(join(scratch, "workforce"));
if (tree.errors.length > 0) {
  report({ setup: `the run's tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}` });
  process.exit(0);
}

// ---- the app ----------------------------------------------------------------

let flows: Record<string, unknown> = {};
const installation = wf.createWorkerInstallation({ standardWorkers: tree.workers, workerFlows: () => flows });

const doorInput = z.object({ message: z.string() });
const door = core.handler({
  name: "goal-helper-run",
  inputSchema: doorInput,
  resources: { ...installation.resources },
  execute: async (input: { message: string }, ctx: any) => {
    const worker = await installation.resolveWorker(ctx, "helper");
    if (input.message.includes(`[fail:${worker.id}]`)) throw new Error(`${worker.id} fails on this post`);
    if (input.message.includes(`[slow:${worker.id}]`)) await sleep(SLOW_MS);
    return `${worker.id} answers: ${input.message}`;
  },
});
// The post entry where this commit takes it: a task entry carries the board's
// gate binding (`from`), an internal one doesn't.
const postEntry = wf.delegatedPostEntry(door);
const takesTasks = typeof wf.workerTaskEntry === "function" ? { work: wf.workerTaskEntry({ name: "goal-helper-task", turn: door }) } : {};
const helper = core.defineFlow({
  kind: "helper",
  configSchema: wf.workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
  ...(postEntry.from !== undefined
    ? { task: { actions: { onDelegatedPost: postEntry, ...takesTasks } } }
    : { internal: { actions: { onDelegatedPost: postEntry } }, task: { actions: { ...takesTasks } } }),
} as never);

/** The judgment turn: a `[judge]` post goes to the first delegate twice; anything else it answers. */
const judgment = {
  modelId: "scripted/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Array<{ role?: string; content?: unknown }> }) {
    const messages = options.messages ?? [];
    const last = messages.map((m) => m.role).lastIndexOf("user");
    const asked = last < 0 ? "" : JSON.stringify(messages[last]!.content);
    // This turn's hand-offs only: the history holds the earlier turns' too.
    const handed = messages.slice(last + 1).filter((m) => m.role === "tool").length;
    if (asked.includes("[judge]") && handed < 2) {
      return { toolCalls: [{ toolCallId: `hand-${handed}`, toolName: "dispatchTask", args: { post: true, assignee: first } }], finishReason: "tool-calls" };
    }
    return { text: handed > 0 ? "Handed on." : "I'll take this one myself.", finishReason: "stop" };
  },
};
const modelResolver = Object.assign(
  (_id: string, block?: string) => {
    if (block?.startsWith(wf.COORDINATOR_JUDGMENT ?? "coordinator-judgment")) return judgment;
    throw new Error(`the goal scripts no model for block "${block}"`);
  },
  { resolveId: (id: string) => id },
);

// No coordinator here routes by best fit, so its evaluation is never called.
const route = mockEvaluationModel({
  answers: () => {
    throw new Error("no coordinator in this goal routes by best fit");
  },
});
const coordinator = wf.defineCoordinatorFlow({ installation, delegateFlows: [helper], routeModel: route, roundDeadlineMs: DEADLINE_MS });
flows = { helper, coordinator };
const copies = wf.hireWorkforce(installation) as Array<{ id: string }>;
const state = engine.createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
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
const people = createWorkforceClient({ userId: ALICE, ...transport });

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

/** The post rows on conversation `sessionId`'s board now, read from the store: a read only, as Alice. */
async function rowsNow(sessionId: string): Promise<Array<Record<string, any>>> {
  const runtime = await state.getRuntime();
  const prefix = `tasks/${[...`${sessionId}~`].map((c) => (/[a-z0-9-]/.test(c) ? c : `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)).join("")}`;
  const rows = Object.values(await runtime.stores.resourceState.getByPrefix("user", `${ALICE}:~org:${ORG}`, prefix)) as Array<{ state: Record<string, any> }>;
  return rows.map((row) => row.state).filter((row) => row?.sealed?.kind === "post");
}

/** The conversation's open rounds now, from its stored record: a read only. */
async function openRoundsNow(sessionId: string): Promise<Array<{ postId: string; round: number }>> {
  const runtime = await state.getRuntime();
  const stored = await runtime.stores.session.get(sessionId);
  return ((stored?.state?.openRounds ?? []) as Array<{ postId: string; round: number }>).map((r) => ({ postId: r.postId, round: r.round }));
}

/** Poll `read` until it returns something, or give up at `ms`. */
async function until<T>(read: () => Promise<T | undefined>, ms: number, every = 10): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(every)) {
    const value = await read();
    if (value !== undefined) return value;
  }
  return undefined;
}

type Item = { type?: string; role?: string; component?: string; data?: any; agentName?: string; content?: unknown; text?: string };

/**
 * A conversation as Alice reads it through the session route: its routing
 * records, and its lines with who wrote each.
 */
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
  };
}

/** One conversation with a coordinator, opened as an app opens one. */
async function conversation(worker: string) {
  const session = await people.ensureWorkerSession({ worker });
  const client = createClient({ flowKind: session.flowKind, userId: ALICE, ...transport });
  /** Send an action and return as soon as it is accepted. */
  const send = async (action: string, input: unknown): Promise<{ requestId: string; error?: string }> => {
    try {
      const sent = await client.sendAction(action, input as never, { sessionId: session.id });
      return { requestId: sent.request.id };
    } catch (error) {
      return { requestId: "", error: error instanceof Error ? error.message : String(error) };
    }
  };
  /** Send an action and wait for it to finish. */
  const act = async (action: string, input: unknown): Promise<{ requestId: string; status: string; error?: string; output?: unknown }> => {
    const sent = await send(action, input);
    if (sent.error !== undefined) return { ...sent, status: "refused" };
    let status = "in_progress";
    let output: unknown;
    for (const end = Date.now() + 30_000; Date.now() < end && RUNNING.includes(status); await sleep(25)) {
      const read = (await client.getRequestStatus(sent.requestId)) as { status: string; output?: unknown };
      status = read.status;
      output = read.output;
    }
    return { requestId: sent.requestId, status, output };
  };
  return { id: session.id as string, send, act };
}

// ---- the scenario -----------------------------------------------------------

try {
  const words = { rows: word(), twice: word(), cancel: word(), late: word(), fails: word() };

  // Leg b. One post to everyone: a row per delegate. As soon as the first
  // ending is written, touch the board while the rest are owed.
  const all = await conversation("desk.all");
  const rowsPost = await all.send("run", { message: `${words.rows} what does everyone think?` });
  const firstEnded = await until(async () => ((await rowsNow(all.id)).some((r) => r.status === "completed") ? true : undefined), 15_000);
  const touches = await Promise.all(Array.from({ length: TOUCHES }, () => all.act("listTasks_tasks", {})));
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  // Leg b. The judgment turn hands the first delegate one post twice.
  const judge = await conversation("desk.judge");
  const twicePost = await judge.act("run", { message: `[judge] ${words.twice} hand this on.` });
  await quiet();

  // Leg b. A post to the first delegate, held 3 s; its task cancelled while it works.
  const cancelPost = await judge.send("run", { message: `[judge] [slow:${first}] ${words.cancel} take your time.` });
  const working = await until(async () => (await rowsNow(judge.id)).find((r) => r.sealed.postId === cancelPost.requestId && r.status === "in_progress"), 10_000);
  const cancelled = working === undefined ? undefined : await judge.act("updateTask_tasks", { id: working.id, status: "cancelled" });
  const cancelledAt = Date.now();
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  // Leg d. A failed delegate: its round closes as soon as both have ended.
  const fails = await conversation("desk.fails");
  const failsPost = await fails.send("run", { message: `[fail:${third}] ${words.fails} what do you both say?` });
  const failsRow = await until(async () => (await rowsNow(fails.id)).find((r) => r.sealed.postId === failsPost.requestId && r.sealed.round === 0), 10_000);
  const failsClosedAt = await until(
    async () => ((await openRoundsNow(fails.id)).some((r) => r.postId === failsPost.requestId && r.round === 0) ? undefined : Date.now()),
    10_000,
  );
  await quiet();

  // Leg d. A late delegate: its round closes at the deadline, before its answer.
  const late = await conversation("desk.late");
  const latePost = await late.send("run", { message: `[slow:${second}] ${words.late} what do you both say?` });
  const lateRow = await until(async () => (await rowsNow(late.id)).find((r) => r.sealed.postId === latePost.requestId && r.sealed.round === 0 && r.assignee === second), 10_000);
  const deadlineAt = lateRow?.sealed?.deadlineAt as number | undefined;
  if (deadlineAt !== undefined) await sleep(Math.max(0, deadlineAt + 400 - Date.now()));
  const atDeadline = {
    at: Date.now(),
    openRounds: await openRoundsNow(late.id),
    lateRowStatus: (await rowsNow(late.id)).find((r) => r.id === lateRow?.id)?.status ?? null,
  };
  await quiet();
  await sleep(GRACE_MS);
  await quiet();

  const read = { all: await itemsOf(all.id), judge: await itemsOf(judge.id), fails: await itemsOf(fails.id), late: await itemsOf(late.id) };

  report({
    store: storeFile,
    read,
    org: ORG,
    userId: ALICE,
    delegates,
    roles: { first, second, third },
    deadlineMs: DEADLINE_MS,
    slowMs: SLOW_MS,
    graceMs: GRACE_MS,
    words,
    b: {
      all: { sessionId: all.id, post: rowsPost, firstEnded: firstEnded === true, touches },
      judge: { sessionId: judge.id, twice: twicePost, cancel: { post: cancelPost, working: working?.id ?? null, cancelled, cancelledAt } },
    },
    d: {
      fails: { sessionId: fails.id, post: failsPost, deadlineAt: failsRow?.sealed?.deadlineAt ?? null, closedAt: failsClosedAt ?? null },
      late: { sessionId: late.id, post: latePost, deadlineAt: deadlineAt ?? null, atDeadline },
    },
  });
} catch (error) {
  report({ setup: `the host failed: ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}`, store: storeFile });
}
process.exit(0);

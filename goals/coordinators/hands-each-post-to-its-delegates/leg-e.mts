/**
 * Leg e's host: a goal-local coordinator tree on the real engine and its HTTP
 * router, driven through the shipped clients, with scripted delegates, a
 * scripted best-fit evaluator and a scripted judgment turn. No real model.
 *
 * It reports what happened on one `__GOAL__<json>` line; `run.mts` grades it.
 * Run by `run.mts` as its own process, so a control's module patch
 * (`goals/lib/module-patch.mjs`, through `NODE_OPTIONS`) is in place before any
 * Workforce module loads. Against another commit, `run.mts` copies this file
 * and `fixtures/` into that checkout's `goals/`, so every import resolves to
 * that commit's packages.
 *
 * The tree (`fixtures/workforce/`): four coordinators over the same two
 * delegates, `desk.alpha` and `desk.beta`, on the goal's `helper` flow.
 *
 * - `desk.fit`, `best-fit` with `desk.beta` as its fallback and no floor;
 * - `desk.floor`, `best-fit` with `desk.beta` as its fallback and
 *   `minConfidence: 0.7`;
 * - `desk.turns`, `round-robin`;
 * - `desk.all`, `everyone` with `rounds: 1`.
 *
 * Scripts, all marked in the post so a swapped post still drives them:
 *
 * - the evaluator picks the choice a `[route:<choice>]` mark names (a
 *   delegate, or the coordinator itself), reports confidence `n` for a
 *   `[conf:<n>]` mark and none without one, and fails a post with no mark it
 *   is offered (a failed call);
 * - the judgment turn hands a `[judge]` post to `desk.alpha` twice (the second
 *   is a redelivery), answers anything else itself, and fails a
 *   `[judge-fail]` post;
 * - a delegate answers `<worker> answers: <what it was handed>`, and holds its
 *   answer for {@link SLOW_MS} on a `[slow:<worker>]` mark.
 *
 * Every grade is read back as Alice: the conversation's items (records and
 * lines) through the router, and its session record (its delegates, its
 * fallback and its delivery ledger) from the engine's session store, from the
 * row Alice owns. The session route sends a client only the state a flow
 * exposes, and the coordinator exposes none of those fields. The engine's
 * request store is read only to wait until nothing is running.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@flow-state-dev/core";
import * as engine from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import { mockEvaluationModel } from "@flow-state-dev/testing";
import * as workforce from "@flow-state-dev/workforce";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { z } from "zod";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ORG = "goal-org";
const ALICE = "u_alice";
/** How long a `[slow:<worker>]` mark holds that worker's answer. */
const SLOW_MS = 3_000;
/** How long the check waits after things go quiet before it counts answers again. */
const GRACE_MS = 3_000;

const word = () => `${["amber", "cobalt", "fjord", "quill", "tundra", "velvet"][randomBytes(1)[0]! % 6]}-${randomBytes(3).toString("hex")}`;
const report = (value: unknown) => process.stdout.write(`__GOAL__${JSON.stringify(value)}\n`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Item = { type?: string; role?: string; component?: string; data?: any; agentName?: string; content?: unknown; text?: string; requestId?: string };

const wf = workforce as unknown as Record<string, any>;
const missing = ["defineCoordinatorFlow", "delegatedPostEntry", "createWorkerInstallation", "hireWorkforce", "workerConfigSchema"].filter(
  (name) => typeof wf[name] !== "function",
);
if (missing.length > 0) {
  report({ setup: `this commit's @flow-state-dev/workforce exports no ${missing.join(", ")}, so no coordinator can be built` });
  process.exit(0);
}

const tree = await readWorkforce(join(HERE, "fixtures", "workforce"));
if (tree.errors.length > 0) {
  report({ setup: `the goal-local tree did not load: ${JSON.stringify(tree.errors).slice(0, 600)}` });
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
    if (input.message.includes(`[slow:${worker.id}]`)) await sleep(SLOW_MS);
    return `${worker.id} answers: ${input.message}`;
  },
});
const helper = core.defineFlow({
  kind: "helper",
  configSchema: wf.workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
  internal: { actions: { onDelegatedPost: wf.delegatedPostEntry(door) } },
} as never);

/**
 * Best fit's evaluator: the first `[route:<choice>]` mark it is offered, else a
 * failed call. A `[conf:<n>]` mark reports confidence `n`, as Jev does; with
 * none, it reports none.
 */
const route = mockEvaluationModel({
  answers: ({ state, questions }) => {
    const text = (state as { post: { text: string } }).post.text;
    const offered = (questions as { member?: { criteria?: Record<string, string> } }).member?.criteria ?? {};
    const pick = [...text.matchAll(/\[route:([a-z.-]+)\]/g)].map((m) => m[1]!).find((mark) => Object.hasOwn(offered, mark));
    if (pick === undefined) throw new Error("the scripted evaluation has no pick for this post");
    const confidence = /\[conf:([0-9.]+)\]/.exec(text)?.[1];
    return { member: { type: "choice", choice: pick, ...(confidence === undefined ? {} : { confidence: Number(confidence) }) } };
  },
});
/** The choices each evaluator call was offered, in order. */
const offeredChoices = () => route.calls.map((call) => Object.keys((call.questions as { member?: { criteria?: Record<string, string> } }).member?.criteria ?? {}));

/** The judgment turn: a `[judge]` post goes to `desk.alpha` twice; `[judge-fail]` fails; anything else it answers. */
let judgmentTurns = 0;
const judgment = {
  modelId: "scripted/judgment",
  async generate() {
    throw new Error("the owned tool loop calls generateStep");
  },
  async generateStep(options: { messages?: Array<{ role?: string; content?: unknown }> }) {
    const messages = options.messages ?? [];
    const asked = messages.filter((m) => m.role === "user").map((m) => JSON.stringify(m.content)).at(-1) ?? "";
    const handed = messages.filter((m) => m.role === "tool").length;
    if (handed === 0) judgmentTurns += 1;
    if (asked.includes("[judge-fail]")) throw new Error("the scripted judgment turn failed");
    if (asked.includes("[judge]") && handed < 2) {
      return { toolCalls: [{ toolCallId: `hand-${handed}`, toolName: "handOff", args: { worker: "desk.alpha" } }], finishReason: "tool-calls" };
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

const coordinator = wf.defineCoordinatorFlow({ installation, delegateFlows: [helper], routeModel: route });
flows = { helper, coordinator };
const copies = wf.hireWorkforce(installation) as Array<{ id: string }>;
const state = engine.createFlowState({
  flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
  stores: { default: { primary: engine.inMemoryStores() } },
  modelResolver,
  resolvePrincipal: (context: any) => {
    const user = context.request?.headers.get("x-user");
    return typeof user === "string" ? { userId: user, orgId: ORG } : null;
  },
} as never) as any;

/** A fetch that hands each request to the router, as `userId`. */
const fetcher =
  (userId: string) =>
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const router = await state.getRouter();
    const url = new URL(String(input), "http://goal.local");
    const headers = new Headers(init?.headers);
    headers.set("x-user", userId);
    const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    return router[(init?.method ?? "GET").toUpperCase()](new Request(url, { ...init, headers }), { params: { path } });
  };

const transport = { fetcher: fetcher(ALICE) as typeof fetch };
const people = createWorkforceClient({ userId: ALICE, ...transport });

/** GET a route as Alice. */
async function get(path: string): Promise<any> {
  const res = await transport.fetcher(`http://goal.local/api/flows${path}`);
  const body = await res.json();
  if (res.status !== 200) throw new Error(`GET ${path}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** Nothing running, twice in a row. */
async function quiet(): Promise<void> {
  const runtime = await state.getRuntime();
  let calm = 0;
  for (const until = Date.now() + 60_000; Date.now() < until; await sleep(100)) {
    const running = (await runtime.stores.request.list({})).some((r: { status: string }) => ["pending", "queued", "in_progress", "running"].includes(r.status));
    calm = running ? 0 : calm + 1;
    if (calm >= 3) return;
  }
  throw new Error("something kept running for a minute");
}

/** One conversation with a coordinator, opened as an app opens one. */
async function conversation(worker: string) {
  const session = await people.ensureWorkerSession({ worker });
  const client = createClient({ flowKind: session.flowKind, userId: ALICE, ...transport });
  const act = async (action: string, input: unknown): Promise<{ requestId: string; status: string; error?: string }> => {
    try {
      const sent = await client.sendAction(action, input as never, { sessionId: session.id });
      let status = "in_progress";
      for (const until = Date.now() + 30_000; Date.now() < until && ["pending", "queued", "in_progress", "running"].includes(status); await sleep(25)) {
        status = (await client.getRequestStatus(sent.request.id)).status as string;
      }
      return { requestId: sent.request.id, status };
    } catch (error) {
      return { requestId: "", status: "refused", error: error instanceof Error ? error.message : String(error) };
    }
  };
  /** What the conversation holds now: its records, its lines, its delegates and its ledger. */
  const read = async () => {
    const items: Item[] = [];
    for (let offset = 0; offset < 5000; offset += 200) {
      const page = await get(`/sessions/${encodeURIComponent(session.id)}/state?include_items=true&offset=${offset}&limit=200`);
      items.push(...(page.items ?? []));
      if (page.pagination?.hasMore !== true) break;
    }
    // The stored record, not the session route's projection of it.
    const stored = await (await state.getRuntime()).stores.session.get(session.id);
    const record = stored?.userId === ALICE ? stored : undefined;
    const text = (i: Item) => (typeof i.text === "string" ? i.text : Array.isArray(i.content) ? i.content.map((p: any) => p?.text ?? "").join("") : String(i.content ?? ""));
    return {
      records: items.filter((i) => i.type === "component" && i.component === (wf.COORDINATOR_ROUTE ?? "coordinator-route")).map((i) => i.data),
      lines: items.filter((i) => i.type === "message").map((i) => ({ role: i.role, agentName: i.agentName ?? null, text: text(i) })),
      delegates: record?.state?.delegates ?? null,
      fallback: record?.state?.fallback ?? null,
      ledger: (record?.state?.deliveries ?? []) as Array<{ postId: string; round: number; delegate: { worker: string }; status: string; answered: boolean }>,
    };
  };
  return { session, act, read };
}

// ---- the scenario -----------------------------------------------------------

try {
  const words = { p1: word(), p2: word(), p3: word(), p4: word(), p5: word(), q: [word(), word(), word()], r: word(), f: [word(), word(), word(), word()] };

  // Best fit with no floor: a pick at a low confidence is used; then a held
  // follow-up, a failed call to the fallback, and, with the fallback removed,
  // the judgment turn and then nobody.
  const fit = await conversation("desk.fit");
  const calls = () => route.calls.length;
  const ladder: Record<string, unknown> = {};
  const c0 = calls();
  const p1 = await fit.act("run", { message: `[route:desk.alpha] [conf:0.2] [slow:desk.alpha] ${words.p1} what ships in the alpha?` });
  const c1 = calls();
  // Sent while desk.alpha is still holding its answer to p1.
  const p2 = await fit.act("run", { message: `${words.p2} and when does it ship?` });
  const c2 = calls();
  await quiet();
  const p3 = await fit.act("run", { message: `${words.p3} who can tell me anything at all?` });
  const c3 = calls();
  await quiet();
  const removed = await fit.act("removeDelegate", { worker: "desk.beta" });
  const afterRemove = await fit.read();
  const p4 = await fit.act("run", { message: `[judge] ${words.p4} nobody's description fits this one.` });
  await quiet();
  const p5 = await fit.act("run", { message: `[judge-fail] ${words.p5} nor this one.` });
  await quiet();
  const fitAfterQuiet = await fit.read();
  await sleep(GRACE_MS);
  await quiet();
  Object.assign(ladder, {
    posts: { p1, p2, p3, p4, p5 },
    words,
    evaluatorCalls: { before: c0, afterP1: c1, afterP2: c2, afterP3: c3, end: calls() },
    removed,
    afterRemove: { delegates: afterRemove.delegates, fallback: afterRemove.fallback },
    quiet: fitAfterQuiet,
    graced: await fit.read(),
  });

  // Best fit with a floor of 0.7 and a fallback: a pick below it, a pick with
  // no confidence, a pick above it, and a pick of the coordinator itself.
  const floor = await conversation("desk.floor");
  const floorFirstCall = calls();
  const floorPosts: Record<string, { requestId: string; status: string }> = {};
  for (const [name, marks, w] of [
    ["below", "[route:desk.alpha] [conf:0.4]", words.f[0]],
    ["none", "[route:desk.alpha]", words.f[1]],
    ["above", "[route:desk.alpha] [conf:0.9]", words.f[2]],
    ["self", "[route:desk.floor] [conf:0.3]", words.f[3]],
  ] as const) {
    floorPosts[name] = await floor.act("run", { message: `${marks} ${w} what does the plan say?` });
    await quiet();
  }
  const floored = { posts: floorPosts, offered: offeredChoices().slice(floorFirstCall), read: await floor.read() };

  // Round robin over three posts.
  const turns = await conversation("desk.turns");
  const rr: Array<{ requestId: string; status: string }> = [];
  for (const w of words.q) {
    rr.push(await turns.act("run", { message: `${w} next question, please.` }));
    await quiet();
  }
  const roundRobin = { posts: rr, read: await turns.read() };

  // Everyone, with a limit of one round.
  const all = await conversation("desk.all");
  const r1 = await all.act("run", { message: `${words.r} what does everyone think?` });
  await quiet();
  const allQuiet = await all.read();
  await sleep(GRACE_MS);
  await quiet();
  const everyone = { post: r1, quiet: allQuiet, graced: await all.read() };

  report({ ladder, floored, roundRobin, everyone, judgmentTurns, graceMs: GRACE_MS, slowMs: SLOW_MS });
} catch (error) {
  report({ setup: `leg e's host failed: ${error instanceof Error ? (error.stack ?? error.message).slice(0, 1500) : String(error)}` });
}
process.exit(0);

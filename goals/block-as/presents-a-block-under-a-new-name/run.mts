/**
 * Goal check — a block shown to a model under a new name with `.as()`.
 *
 * Real path, real model, out of CI. See goal.md for the contract.
 *
 *   a  A generator offers a renamed note-writing handler as `saveNote`. The
 *      model calls `saveNote`, the call suspends for approval, and after the
 *      approval the note is written exactly once. Every name the item log and
 *      the suspension record carry for the call is `saveNote`.
 *   b  Workforce's built-in worker flow takes Workforce's own hire block in
 *      its tool catalog as `hire`, renamed with `.as()`. The flow loads, a
 *      worker whose `tools:` names `hire` is asked to hire, it calls `hire`,
 *      and one row appears on the person's roster.
 *
 * `GOAL_CONTROL=no-as` passes both blocks as they are, which is what an author
 * could do before `.as()`: leg a must fail on "a:calls-new-name" and leg b on
 * "b:flow-loads".
 *
 * Run: pnpm tsx goals/block-as/presents-a-block-under-a-new-name/run.mts
 */
import { createRequire } from "node:module";
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import {
  createModelResolver,
  defineFlow,
  DEFAULT_ORG_ID,
  generator,
  handler,
  sequencer,
} from "@flow-state-dev/core";
import type { BlockDefinition, FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import {
  continueRequest,
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { runAction } from "@flow-state-dev/engine";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineWorkerRosterFlow,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { z } from "zod";
import {
  approvalContext,
  approvePending,
  durableStores,
  gatewayModel,
  goalAttempts,
  goalModel,
  loadFixture,
  registryFor,
  runGoal,
  silentLogger,
  stripIntentOverrides,
} from "../../lib/index.mts";

type Fixture = { note: string; user: string; org: string; worker: string; hire: string };

const fixture = loadFixture<Fixture>(import.meta.url);
const MODEL = goalModel(gatewayModel());
const ATTEMPTS = goalAttempts(3);
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "no-as") {
  throw new Error(`Unknown GOAL_CONTROL "${CONTROL}". This goal understands: no-as.`);
}
const RENAME = CONTROL !== "no-as";

/** The names the model must see, and the ones it must never see. */
const NEW_NOTE_NAME = "saveNote";
const ORIGINAL_NOTE_NAME = "notes.write";
const NEW_HIRE_NAME = "hire";

stripIntentOverrides();

/** A real model resolver over the Vercel gateway, with `MODEL` as the chat intent. */
async function realResolver(): Promise<ModelResolver> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("this goal needs AI_GATEWAY_API_KEY for real inference");
  // `goals/` cannot resolve the gateway package; kitchen-sink's node_modules can.
  const ksRequire = createRequire(new URL("../../../apps/kitchen-sink/package.json", import.meta.url));
  const { createGateway } = (await import(ksRequire.resolve("@ai-sdk/gateway"))) as {
    createGateway: (options: { apiKey: string }) => unknown;
  };
  return createModelResolver({
    gateways: { vercel: createGateway({ apiKey }) as never },
    defaultModel: MODEL,
    intents: { chat: [MODEL] },
    env: {},
  });
}

/** Keys under which an item or a suspension record names a block or a tool. */
const NAME_KEYS = new Set(["blockName", "agentName", "generatorBlock", "name", "alias", "toolName"]);

/** Every string held under a name key, anywhere in `value`. */
function namesIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) namesIn(entry, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (NAME_KEYS.has(key) && typeof entry === "string") into.add(entry);
      namesIn(entry, into);
    }
  }
  return into;
}

// ---------------------------------------------------------------------------
// Leg a: a renamed generator tool that asks before it runs.
// ---------------------------------------------------------------------------

interface LegAObservation {
  /** The tool names the model's calls were recorded under. */
  calledNames: string[];
  /** Notes in the store when the run suspended. */
  writesAtSuspend: number;
  notes: string[];
  status: string | undefined;
  /** Every name the item log and the suspension record carry. */
  names: string[];
  detail: string;
}

async function legAOnce(resolver: ModelResolver): Promise<LegAObservation> {
  // The store the tool writes to; its count is the side effect graded.
  const notes: string[] = [];
  const write = handler({
    name: ORIGINAL_NOTE_NAME,
    description: "Writes a note to the store.",
    inputSchema: z.object({ text: z.string().describe("The note, in the person's words") }),
    outputSchema: z.object({ saved: z.boolean() }),
    execute: async (input, ctx) => {
      await ctx.suspend!({ reason: "approval", message: `Save the note "${input.text}"?` });
      notes.push(input.text);
      return { saved: true };
    },
  });
  const tool: BlockDefinition<any, any> = RENAME
    ? write.as({ name: NEW_NOTE_NAME, description: "Save a note for the person. Use it whenever they ask you to note or remember something." })
    : write;

  const assistant = generator({
    name: "assistant",
    model: resolver(MODEL, "assistant") as never,
    tools: [tool],
    user: (input: { message: string }) => input.message,
    prompt:
      `You are a note-taking assistant. When the person asks you to note something, call the ` +
      `${NEW_NOTE_NAME} tool exactly once with the note text, then confirm in one short sentence.`,
  });
  const flow = defineFlow({
    kind: "goal-block-as-notes",
    actions: {
      run: {
        block: sequencer({ name: "root", durable: true }).step(assistant),
        inputSchema: z.object({ message: z.string() }),
      },
    },
  })({ id: "goal-block-as-notes" }) as FlowInstance;

  const { stores, provider, runtimeConfig } = durableStores();
  const initial = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: flow as never,
    actionName: "run",
    input: { message: `Please note this down for me: ${fixture.note}` },
    userId: fixture.user,
    stores,
    runtimeConfig: runtimeConfig as never,
  });
  const requestId = initial.requestId!;
  const suspended = await stores.request.get(requestId);
  const calledNames = ((suspended?.items ?? []) as Array<{ type: string; toolCall?: { name: string } }>)
    .filter((item) => item.type === "tool_output")
    .map((item) => item.toolCall!.name);
  if (suspended?.status !== "suspended") {
    return {
      calledNames,
      writesAtSuspend: notes.length,
      notes,
      status: suspended?.status,
      names: [...namesIn(suspended?.items ?? [])],
      detail: `status ${suspended?.status}, output ${JSON.stringify(initial.output ?? initial.error ?? null)}`,
    };
  }
  const writesAtSuspend = notes.length;
  const suspension = await approvePending(provider, requestId, { approved: true });
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registryFor(flow),
    resumeContext: approvalContext(suspension, { approved: true }, "goal-reviewer") as never,
    runtimeConfig: runtimeConfig as never,
  });
  await finished;
  const record = await stores.request.get(requestId);
  return {
    calledNames,
    writesAtSuspend,
    notes,
    status: record?.status,
    names: [...namesIn([record?.items ?? [], suspension])],
    detail: `status ${record?.status}`,
  };
}

async function legA(resolver: ModelResolver, failures: string[], evidence: string[]): Promise<void> {
  let observation: LegAObservation | undefined;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    observation = await legAOnce(resolver);
    if (observation.calledNames.length > 0) break;
    console.error(`(retrying leg a) attempt ${attempt}: the model called no tool — ${observation.detail}`);
  }
  if (observation === undefined || observation.calledNames.length === 0) {
    failures.push(`a:calls-new-name — the model called no tool in ${ATTEMPTS} attempts`);
    return;
  }
  const o = observation;
  if (!o.calledNames.includes(NEW_NOTE_NAME)) {
    failures.push(`a:calls-new-name — the model called ${JSON.stringify(o.calledNames)}, never "${NEW_NOTE_NAME}"`);
    return;
  }
  if (o.writesAtSuspend !== 0) failures.push(`a:suspends — the note was written before approval (${o.writesAtSuspend})`);
  if (o.status !== "completed") failures.push(`a:resumes — the request ended "${o.status}" after approval`);
  if (o.notes.length !== 1) failures.push(`a:once — the store holds ${o.notes.length} notes, want exactly 1`);
  const saved = o.notes[0] ?? "";
  const keyWords = fixture.note.split(/\s+/).filter((word) => word.length > 4);
  const missing = keyWords.filter((word) => !saved.toLowerCase().includes(word.toLowerCase().replace(/[^a-z]/gi, "")));
  if (missing.length > keyWords.length / 2) {
    failures.push(`a:once — the saved note ${JSON.stringify(saved)} lost most of the held-out note's words (${missing.join(", ")})`);
  }
  const leaked = o.names.filter((name) => name === ORIGINAL_NOTE_NAME || name === "notes_write");
  if (leaked.length > 0) failures.push(`a:one-name — the item log or the suspension names ${leaked.join(", ")}`);
  if (!o.names.includes(NEW_NOTE_NAME)) failures.push(`a:one-name — nothing in the item log names "${NEW_NOTE_NAME}"`);
  evidence.push(
    `a: the model called ${JSON.stringify(o.calledNames)}; 0 notes at the suspension, ${o.notes.length} after approval ` +
      `(${JSON.stringify(saved)}); names in items and suspension: ${o.names.sort().join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Leg b: Workforce's hire block in the tool catalog, renamed to its key.
// ---------------------------------------------------------------------------

/** The app: the built-in worker flow with a one-entry catalog, and the roster flow. */
function appFlows(): FlowInstance[] {
  let flows: Record<string, unknown> = {};
  const worker: WorkerManifest = {
    id: fixture.worker,
    declared: { description: "Keeps the person's roster of workers.", tools: [NEW_HIRE_NAME] },
    body:
      `You keep the person's roster of workers. When they ask you to hire a worker, call the ` +
      `${NEW_HIRE_NAME} tool once with the id they give, then confirm in one short sentence.`,
  };
  const installation = createWorkerInstallation({ standardWorkers: [worker], workerFlows: () => flows as never });
  const blocks = createWorkerHireBlocks(installation);
  const entry = RENAME
    ? blocks.hire.as({ name: NEW_HIRE_NAME, description: "Hire a new worker onto the person's roster, by id." })
    : blocks.hire;
  const agent = defineAgentWorkerFlow({ installation, catalog: { [NEW_HIRE_NAME]: entry } });
  flows = { agent };
  const roster = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: blocks.hire.inputSchema, block: blocks.hire },
  });
  return [agent({ id: "agent" }), roster()] as unknown as FlowInstance[];
}

async function legB(resolver: ModelResolver, failures: string[], evidence: string[]): Promise<void> {
  let flows: FlowInstance[];
  try {
    flows = appFlows();
  } catch (error) {
    failures.push(`b:flow-loads — the agent worker flow refused its catalog: ${(error as Error).message.split("\n")[0]}`);
    return;
  }

  const stores = createInMemoryStores() as unknown as StoreRegistry;
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow);
  const router = createFlowApiRouter({
    registry,
    stores,
    resolvePrincipal: () => ({ userId: fixture.user, orgId: fixture.org }),
    modelResolver: resolver,
    logger: silentLogger,
    staleSweepIntervalMs: 0,
  } as never) as unknown as Record<string, (request: Request, context: unknown) => Promise<Response>>;
  const fetcher: ClientFetch = async (input, init) => {
    const url = new URL(String(input), "http://goal.local");
    const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const method = (init?.method ?? "GET").toUpperCase();
    return router[method]!(new Request(url, init), { params: { path } });
  };
  const transport = { fetcher };
  const workforce = createWorkforceClient({ userId: fixture.user, ...transport });

  const before = (await workforce.roster()).map((row) => row.id);
  if (before.includes(fixture.hire)) {
    failures.push(`b:roster-row — "${fixture.hire}" is on the roster before the turn`);
    return;
  }

  let calledNames: string[] = [];
  let after: string[] = before;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const session = await workforce.ensureWorkerSession({ worker: fixture.worker });
    const actions = createClient({ flowKind: session.flowKind, userId: fixture.user, ...transport });
    const started = await actions.sendAction(
      "run",
      { message: `Please hire a new worker with the id "${fixture.hire}" onto my roster.` },
      { sessionId: session.id },
    );
    const until = Date.now() + 120_000;
    let status = (await actions.getRequestStatus(started.request.id)).status;
    while (status === "in_progress") {
      if (Date.now() > until) throw new Error("the worker's turn never settled");
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await actions.getRequestStatus(started.request.id)).status;
    }
    const request = await stores.request.get(started.request.id);
    calledNames = ((request?.items ?? []) as Array<{ type: string; toolCall?: { name: string } }>)
      .filter((item) => item.type === "tool_output")
      .map((item) => item.toolCall!.name);
    after = (await workforce.roster()).map((row) => row.id);
    if (after.includes(fixture.hire)) break;
    console.error(`(retrying leg b) attempt ${attempt}: turn ${status}, tools called ${JSON.stringify(calledNames)}`);
  }

  const added = after.filter((id) => !before.includes(id));
  if (!added.includes(fixture.hire)) {
    failures.push(`b:roster-row — no "${fixture.hire}" on the roster after the turn (added: ${JSON.stringify(added)})`);
  }
  if (added.length !== 1) failures.push(`b:roster-row — ${added.length} rows added, want exactly 1`);
  evidence.push(
    `b: the agent worker flow loaded with catalog { hire: <workforce-hire>.as({ name: "hire" }) }; ` +
      `the worker called ${JSON.stringify(calledNames)} and the roster gained ${JSON.stringify(added)}`,
  );
}

await runGoal(async (failures) => {
  const evidence: string[] = [`model ${MODEL}${CONTROL ? `, control ${CONTROL}` : ""}`];
  const resolver = await realResolver();
  await legA(resolver, failures, evidence);
  await legB(resolver, failures, evidence);
  return { failures, evidence: evidence.join(" | ") };
});

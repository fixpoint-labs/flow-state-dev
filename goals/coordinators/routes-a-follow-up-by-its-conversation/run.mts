/**
 * coordinators › it routes a follow-up by its conversation. The contract is
 * `goal.md`; this is its runnable form.
 *
 * A person asks a best-fit support coordinator something one specialist
 * answers, then follows up with a post whose words alone point at another
 * specialist. The follow-up must reach the specialist that answered, by best
 * fit's one evaluation, on real models.
 *
 * The app is built here the way a new app would write it, from the published
 * packages and the fixture's worker files: Workforce's `coordinator` flow with
 * the built-in `agent` as the flow its delegates take posts on. Every grade is
 * read back through the app's own router as the person: who heard a post from
 * each delegate's own conversations, and how it was routed from the
 * conversation's routing record. Only the wait reads the engine's stores.
 *
 * Run:      pnpm tsx goals/coordinators/routes-a-follow-up-by-its-conversation/run.mts
 * Control:  GOAL_CONTROL=no-recent (best fit's evaluation handed the post without the conversation's lines)
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createModelResolver } from "@flow-state-dev/core";
import type { EvaluationModel, FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import {
  DEFAULT_MODEL,
  gatewayModel,
  goalAttempts,
  keysServing,
  loadFixture,
  runGoal,
  silentLogger,
  stripIntentOverrides
} from "../../lib/index.mts";

// A container's FSDEV_DEFAULT_MODEL / FSDEV_INTENT_* would swap the answers' model under the resolver.
stripIntentOverrides();

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["no-recent"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
}

/** The person who talks to the desk, and the org the app runs as. */
const OWNER = "u_followup";
const ORG = "org_followup";

/** Best fit's evaluation model, named the way the app names it. */
const ROUTE_MODEL = "vercel/typesafe-ai/jev";

/** One thread: an opener the `on` specialist answers, and a follow-up whose words point elsewhere. */
type Thread = { on: string; opener: string; followUp: string };

type Message = { role: string; text: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The app's model resolver, on the Vercel AI Gateway. */
async function gatewayResolver(apiKey: string): Promise<ModelResolver> {
  // `goals/` cannot resolve the gateway package; kitchen-sink's node_modules can.
  const ksRequire = createRequire(new URL("../../../apps/kitchen-sink/package.json", import.meta.url));
  const { createGateway } = (await import(ksRequire.resolve("@ai-sdk/gateway"))) as {
    createGateway: (options: { apiKey: string }) => unknown;
  };
  const answerModel = gatewayModel();
  return createModelResolver({
    gateways: { vercel: createGateway({ apiKey }) as never },
    defaultModel: answerModel,
    intents: { chat: [answerModel] }
  });
}

/**
 * `no-recent`: best fit's evaluation is handed `{ post }` alone, as if the
 * coordinator had read no lines. Applied around the model, never inside a
 * package.
 */
async function routeModelFor(resolver: ModelResolver): Promise<string | EvaluationModel> {
  if (CONTROL !== "no-recent") return ROUTE_MODEL;
  const model = await resolver.resolveEvaluationModel!(ROUTE_MODEL);
  return {
    ...model,
    doEvaluate: (call: { state: { recent?: unknown } }) => {
      const { recent: _recent, ...state } = call.state;
      return (model as unknown as { doEvaluate: (c: unknown) => PromiseLike<unknown> }).doEvaluate({ ...call, state });
    }
  } as unknown as EvaluationModel;
}

/** The app: the fixture's workers, one copy of each worker flow, served on fresh in-memory stores. */
async function startApp(resolver: ModelResolver) {
  const read = await readWorkforce(TREE);
  if (read.errors.length > 0) throw new Error(`the tree did not load: ${JSON.stringify(read.errors).slice(0, 600)}`);
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: read.workers, workerFlows: () => flows as never });
  const agent = defineAgentWorkerFlow({ installation });
  flows = {
    agent,
    coordinator: defineCoordinatorFlow({ installation, delegateFlows: [agent], routeModel: await routeModelFor(resolver) })
  };
  const copies = hireWorkforce(installation) as FlowInstance[];
  const state: FlowState = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    resolvePrincipal: () => ({ userId: OWNER, orgId: ORG }),
    modelResolver: resolver
  } as never);
  // The runtime's own narration, off, so the attempts and the verdict are what the run prints.
  (await state.getRuntime()).runtimeConfig.logger = silentLogger;
  return { state, router: await state.getRouter(), workers: read.workers };
}

type App = Awaited<ReturnType<typeof startApp>>;

/** Reads and writes through the app's own router, as the person. */
function reader(app: App) {
  const call = async (method: "GET" | "POST", segments: string[], body?: unknown, query = "") => {
    const res = await (app.router as any)[method](
      new Request(`http://followup.local/api/flows/${segments.map(encodeURIComponent).join("/")}${query}`, {
        method,
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path: segments } }
    );
    return { status: res.status as number, text: (await res.text()) as string };
  };
  const itemsOf = async (sessionId: string) => {
    const state = await call("GET", ["sessions", sessionId, "state"], undefined, "?include_items=true&limit=1000");
    return ((JSON.parse(state.text) as { items?: any[] }).items ?? []).filter((item) => item.transient !== true);
  };
  const textOf = (item: { content?: Array<{ text?: string }> }) => (item.content ?? []).map((c) => c.text ?? "").join("");
  return {
    open: async (coordinator: string) => {
      const res = await call("POST", ["coordinator", "sessions"], { userId: OWNER, state: { workerId: coordinator } });
      if (res.status !== 201) throw new Error(`a conversation with ${coordinator} was not opened: ${res.status} ${res.text.slice(0, 300)}`);
      return (JSON.parse(res.text) as { session: { id: string } }).session.id;
    },
    post: async (conversation: string, message: string) => {
      const res = await call("POST", ["coordinator", "actions", "run"], { userId: OWNER, sessionId: conversation, input: { message } });
      if (res.status !== 200) throw new Error(`post "${message}" refused: ${res.status} ${res.text.slice(0, 300)}`);
    },
    /** The delegates' answers that landed in the conversation, oldest first. */
    answersIn: async (conversation: string) =>
      (await itemsOf(conversation))
        .filter((item) => item.type === "message" && item.role === "assistant" && typeof item.agentName === "string")
        .map((item) => ({ author: item.agentName as string, text: textOf(item) })),
    /** The conversation's routing records, oldest first. */
    recordsIn: async (conversation: string) =>
      (await itemsOf(conversation)).filter((item) => item.type === "component" && item.component === "coordinator-route").map((item) => item.data),
    /** The messages of each of a delegate's conversations under this one. */
    conversationsOf: async (delegate: string, conversation: string): Promise<Message[][]> => {
      const listed = await call(
        "GET",
        ["sessions"],
        undefined,
        `?flowId=agent&state.workerId=${encodeURIComponent(delegate)}&userId=${OWNER}&include=dispatch-runs&limit=100`
      );
      const rows = (JSON.parse(listed.text) as { sessions?: Array<{ id: string; parentSessionId?: string | null }> }).sessions ?? [];
      const out: Message[][] = [];
      for (const row of rows.filter((r) => r.parentSessionId === conversation)) {
        out.push((await itemsOf(row.id)).filter((item) => item.type === "message").map((item) => ({ role: item.role ?? "", text: textOf(item) })));
      }
      return out;
    }
  };
}

/** Until nothing in the app has run for three reads in a row, or `ms` passes. Not graded. */
async function quiet(app: App, ms: number): Promise<void> {
  const runtime = await app.state.getRuntime();
  const busy = async () => {
    for (const session of await runtime.stores.session.list({ parentage: "all" } as never)) {
      if ((await runtime.stores.request.list({ sessionId: session.id })).some((r) => r.status === "in_progress")) return true;
    }
    return false;
  };
  const until = Date.now() + ms;
  for (let calm = 0; calm < 3 && Date.now() < until; ) {
    calm = (await busy()) ? 0 : calm + 1;
    await sleep(100);
  }
}

/**
 * One thread in a conversation of its own. Pushes `followup:<assertion>`
 * failures; returns the evidence line.
 */
async function runThread(app: App, thread: Thread, fail: (line: string) => void): Promise<string> {
  const io = reader(app);
  const help = app.workers.find((w) => w.declared.flow === "coordinator" && w.declared.routing === "best-fit");
  if (help === undefined) throw new Error("the fixture needs one coordinator on best-fit");
  const delegates = help.declared.delegates as string[];
  if (!delegates.includes(thread.on)) throw new Error(`the thread is on ${thread.on}, which isn't one of ${help.id}'s delegates`);
  const heardBy = async (conversation: string, body: string) => {
    const who: string[] = [];
    for (const delegate of delegates) {
      const turns = (await io.conversationsOf(delegate, conversation)).flat().filter((m) => m.role === "user");
      if (turns.some((m) => m.text.endsWith(`: ${body}`))) who.push(delegate);
    }
    return who;
  };

  const conversation = await io.open(help.id);
  await io.post(conversation, thread.opener);
  await quiet(app, 120_000);
  const openedBy = await heardBy(conversation, thread.opener);
  const answers = await io.answersIn(conversation);
  if (openedBy.length !== 1 || openedBy[0] !== thread.on || answers.length !== 1 || answers[0]!.author !== thread.on) {
    fail(
      `followup:opener — "${thread.opener}" was heard by [${openedBy.join(", ")}] and answered by ` +
        `[${answers.map((a) => a.author).join(", ")}] (want ${thread.on}, once), so there is no thread to follow up`
    );
    return `"${thread.opener}" → [${openedBy.join(", ")}]`;
  }

  // The opener's answer has landed, so nothing holds the follow-up: best fit's evaluation places it.
  await io.post(conversation, thread.followUp);
  await quiet(app, 120_000);
  const followedBy = await heardBy(conversation, thread.followUp);
  const records = await io.recordsIn(conversation);
  const record = records.at(-1) as { by?: string; delegates?: Array<{ worker: string; outcome: string }> } | undefined;
  const after = (await io.answersIn(conversation)).slice(1);
  const line =
    `"${thread.opener}" → ${thread.on}: "${answers[0]!.text}" · "${thread.followUp}" → [${followedBy.join(", ")}] ` +
    `by ${record?.by ?? "no record"} · ${after.map((a) => `${a.author}: "${a.text}"`).join(" | ")}`;
  if (followedBy.length !== 1 || followedBy[0] !== thread.on) {
    fail(`followup:delegate — "${thread.followUp}" was heard by [${followedBy.join(", ")}] (want ${thread.on}, which answered "${thread.opener}")`);
  }
  if (records.length !== 2 || record?.by !== "evaluated") {
    fail(`followup:evaluated — the follow-up's routing record says by ${record?.by ?? "nothing"} (want evaluated: one evaluation placed it, nothing held it)`);
  }
  if (after.length !== 1 || after[0]!.author !== followedBy[0]) {
    fail(`followup:answered — the follow-up got [${after.map((a) => a.author).join(", ")}] (want one answer, by the delegate that heard it)`);
  }
  return line;
}

await runGoal(async (failures) => {
  // Each model the run calls needs a key that serves it here; the route model only the gateway serves.
  for (const model of [ROUTE_MODEL.replace(/^vercel\//, ""), DEFAULT_MODEL]) {
    const keys = keysServing(model);
    if (!keys.some((key) => (process.env[key] ?? "") !== "")) {
      return { failures: [`blocked: no key here serves ${model}; none of ${keys.join(", ")} is set`], evidence: "" };
    }
  }
  const threads = loadFixture<Thread[]>(import.meta.url, "threads.json");
  const resolver = await gatewayResolver(process.env.AI_GATEWAY_API_KEY ?? "");
  // Retry until the first pass: a real model routes differently run to run. One attempt under a control.
  const attempts = CONTROL === "" ? goalAttempts() : 1;
  const evidence: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const missed: string[] = [];
    const app = await startApp(resolver);
    try {
      for (const thread of threads) {
        const line = await runThread(app, thread, (failure) => missed.push(failure));
        console.log(`  attempt ${attempt}  ${line}`);
        evidence.push(`attempt ${attempt}: ${line}`);
      }
    } finally {
      await app.state.dispose();
    }
    if (missed.length === 0) {
      return { failures, evidence: `passed on attempt ${attempt} of ${attempts}${CONTROL === "" ? "" : ` (control ${CONTROL})`}; ${evidence.join(" ;; ")}` };
    }
    console.log(`  attempt ${attempt} failed:\n    - ${missed.join("\n    - ")}`);
    if (attempt === attempts) failures.push(...missed);
  }
  return { failures, evidence: evidence.join(" ;; ") };
});

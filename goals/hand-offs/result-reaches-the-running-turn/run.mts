/**
 * hand-offs › it result reaches the running turn. The contract is `goal.md`;
 * this is its runnable form.
 *
 * A person asks the main worker, on a real model, to look two things up. It
 * files one task per thing for its delegate and answers. The first task ends
 * while that answer is still running; the second ends while the worker answers
 * again. Each result must show in the person's own request, once, and the
 * worker's text after it in that request must use it.
 *
 * The app is built the way a new app would write it: the built-in `agent` flow
 * with `answerAgain: true`, and a delegate on a flow of its own that answers
 * each task with a code fixed per run. The run only decides WHEN each task
 * ends: it holds the delegate's answer until a moment in the main worker's
 * turn (after its answering model call, then during its answer again), and
 * holds that model call's return until the row reads ended in the store. It
 * never takes a notice, writes a row or resumes a request. Every grade reads
 * the session's stored items: what an app draws.
 *
 * Run:      pnpm tsx goals/hand-offs/result-reaches-the-running-turn/run.mts
 * Controls: GOAL_CONTROL=read-only (the app's block reads finished rows instead of taking them)
 *           GOAL_CONTROL=no-source (no `answerAgain`: the flow as it is on main before FIX-2159)
 * Order:    GOAL_ORDER=reversed ends the second-filed task first.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { createModelResolver, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, type FlowState } from "@flow-state-dev/engine";
import { isTerminalStatus, noticeText, readCommittedTask, type Task } from "@flow-state-dev/orchestration/tasks";
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  hireWorkforce,
  workerConfigSchema,
  workerMessagesResources,
  workerTaskEntry,
  type WorkerInstallation,
  type WorkerManifest
} from "@flow-state-dev/workforce";
import { z } from "zod";
// The read-only control's block reads its own conversation's ledger, as a lab with no take would.
import { ownConversationLedger } from "../../../packages/workforce/src/conversation-board/ledger.ts";
import {
  gatewayModel,
  goalAttempts,
  actingAs,
  hearsMessages,
  keysServing,
  loadFixture,
  runGoal,
  silentLogger,
  stripIntentOverrides,
  untilIdle
} from "../../lib/index.mts";

// A container's FSDEV_DEFAULT_MODEL / FSDEV_INTENT_* would swap the model under the resolver.
stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["read-only", "no-source"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
const REVERSED = process.env.GOAL_ORDER === "reversed";

const fixture = loadFixture<{ instructions: string; ask: string }>(import.meta.url);

const OWNER = "u_person";
const ORG = "org_result_turn";
const MAIN = "lead";
const DELEGATE = "scout";
/** What the answer again is told, by the package's pre-built source: how the run knows the worker is answering again. */
const ANSWERING_AGAIN = "finished while you answered";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The app's model resolver, on the Vercel AI Gateway. */
async function gatewayResolver(apiKey: string): Promise<ModelResolver> {
  // `goals/` cannot resolve the gateway package; kitchen-sink's node_modules can.
  const ksRequire = createRequire(new URL("../../../apps/kitchen-sink/package.json", import.meta.url));
  const { createGateway } = (await import(ksRequire.resolve("@ai-sdk/gateway"))) as { createGateway: (options: { apiKey: string }) => unknown };
  const model = gatewayModel(process.env.GOAL_MODEL);
  return createModelResolver({ gateways: { vercel: createGateway({ apiKey }) as never }, defaultModel: model, intents: { chat: [model] } });
}

/** One run's timing: which task ends when, and the code each answers with. */
class Timing {
  readonly codes = [`rc-${randomBytes(3).toString("hex")}`, `rc-${randomBytes(3).toString("hex")}`];
  private readonly gates = new Map<string, () => void>();
  private readonly waiting = new Map<string, Promise<void>>();
  private released = 0;
  /** The code each task answered with, by task id, in the order they ended. */
  readonly answered = new Map<string, string>();

  /** The delegate's turn waits here until the run lets `taskId` end. */
  gate(taskId: string): Promise<void> {
    if (!this.waiting.has(taskId)) this.waiting.set(taskId, new Promise<void>((resolve) => this.gates.set(taskId, resolve)));
    return this.waiting.get(taskId)!;
  }

  /** Let `taskId` end, with the next code. */
  release(taskId: string): void {
    this.answered.set(taskId, this.codes[this.released]!);
    this.released += 1;
    void this.gate(taskId);
    this.gates.get(taskId)!();
  }

  get count(): number {
    return this.released;
  }
}

/** The delegate's flow: each task waits for the run's release, then answers with its code. No model. */
function lookupFlow(installation: WorkerInstallation, timing: Timing) {
  const turn = handler({
    name: "lookup-turn",
    inputSchema: z.object({ message: z.string() }),
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      const taskId = String((ctx.session.state as Record<string, unknown>).taskId);
      await timing.gate(taskId);
      return `The code is ${timing.answered.get(taskId)}.`;
    }
  });
  return defineFlow({
    kind: "lookup",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: { inputSchema: z.object({ message: z.string() }), block: turn, userMessage: (input: { message: string }) => input.message } },
    internal: { actions: hearsMessages(installation, "lookup") },
    task: { actions: { work: workerTaskEntry({ name: "lookup-task", turn }) } }
  });
}

/**
 * The read-only control: what a lab could do with no take. It reads its
 * conversation's finished rows, says each one it hasn't said as the line
 * under the delegate's name, and asks the worker to answer again with it.
 * The notice stays owed.
 */
const readOnlySource = handler({
  name: "lab-read-finished",
  inputSchema: z.unknown(),
  outputSchema: z.object({ message: z.string().optional() }),
  execute: async (_input, rawCtx) => {
    const ctx = rawCtx as unknown as BlockContext;
    const ref = await ownConversationLedger(ctx);
    if (ref === undefined) return {};
    const said = new Set(((ctx.request.state as Record<string, unknown> | undefined)?.labSaid ?? []) as string[]);
    const lines: string[] = [];
    for (const seen of ref.list()) {
      if (said.has(seen.id)) continue;
      const row = await readCommittedTask(ref, seen.id);
      if (row === undefined || row.status !== "completed") continue;
      const line = noticeText({ boardId: "tasks", taskId: row.id, attempt: row.attempts, ending: "completed", output: row.output }, row);
      ctx.emit.message(line, row.assignee !== undefined ? { agentName: row.assignee } : {});
      lines.push(line);
      said.add(row.id);
    }
    if (lines.length === 0) return {};
    await ctx.request.patchState({ labSaid: [...said] } as never);
    return { message: `These tasks you handed out ${ANSWERING_AGAIN}:\n\n${lines.map((line) => `- ${line}`).join("\n")}` };
  }
});

/** The app: the main worker on the built-in `agent` flow, its delegate on `lookup`, on fresh in-memory stores. */
async function startApp(resolver: ModelResolver, timing: Timing) {
  const workers: WorkerManifest[] = [
    { id: MAIN, declared: { description: "Coordinates lookups.", delegates: [DELEGATE] }, body: fixture.instructions, skills: [] },
    { id: DELEGATE, declared: { description: "Looks up release codes.", flow: "lookup" }, body: "", skills: [] }
  ];
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  const answerAgain = CONTROL === "no-source" ? {} : { answerAgain: CONTROL === "read-only" ? readOnlySource : (true as const) };
  flows = {
    agent: defineAgentWorkerFlow({ installation, model: gatewayModel(process.env.GOAL_MODEL), ...answerAgain }),
    lookup: { flow: lookupFlow(installation, timing), roles: ["contributor"] }
  };
  const copies = hireWorkforce(installation) as FlowInstance[];
  let state!: FlowState;
  const rows = async (): Promise<Task[]> => {
    const runtime = await state.getRuntime();
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${OWNER}:~org:${ORG}`, "tasks/");
    return Object.values(entries)
      .map((entry) => entry.state as Task)
      .filter((row) => row.assignee === DELEGATE)
      .sort((a, b) => a.createdAt - b.createdAt);
  };
  const ended = async (taskId: string) => {
    for (let i = 0; i < 1500; i += 1) {
      if ((await rows()).some((row) => row.id === taskId && isTerminalStatus(row.status))) return;
      await sleep(20);
    }
    throw new Error(`task ${taskId} never ended`);
  };
  /**
   * After each of the main worker's model calls, before its answer goes on:
   * once both tasks are filed, the first ends while that answer runs; when the
   * worker is answering again, the second ends meanwhile.
   */
  const afterCall = async (input: string) => {
    const filed = await rows();
    if (timing.count === 0 && filed.length >= 2) {
      const first = REVERSED ? filed[1]! : filed[0]!;
      timing.release(first.id);
      await ended(first.id);
      return;
    }
    if (timing.count === 1 && input.includes(ANSWERING_AGAIN)) {
      const second = filed.find((row) => !timing.answered.has(row.id));
      if (second === undefined) return;
      timing.release(second.id);
      await ended(second.id);
    }
  };
  const holding = (model: GeneratorModel): GeneratorModel => {
    const wrapped: Record<string, unknown> = { ...model };
    for (const key of ["generate", "generateStep"] as const) {
      const call = model[key]?.bind(model);
      if (call !== undefined) {
        wrapped[key] = async (options: unknown) => {
          const result = await call(options as never);
          await afterCall(JSON.stringify(options));
          return result;
        };
      }
    }
    for (const key of ["stream", "streamStep"] as const) {
      const call = model[key]?.bind(model);
      if (call !== undefined) {
        wrapped[key] = async function* (options: unknown) {
          yield* call(options as never);
          await afterCall(JSON.stringify(options));
        };
      }
    }
    return wrapped as unknown as GeneratorModel;
  };
  const timed = Object.assign(
    ((modelId: string, blockName?: string, options?: unknown) => {
      const model = (resolver as (...args: unknown[]) => GeneratorModel)(modelId, blockName, options);
      return blockName?.startsWith("agent-answer") === true ? holding(model) : model;
    }) as ModelResolver,
    resolver
  );
  state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    },
    modelResolver: timed
  } as never);
  const runtime = await state.getRuntime();
  runtime.runtimeConfig.logger = silentLogger;
  return { state, runtime, router: await state.getRouter(), rows };
}

type Line = { requestId: string; agentName?: string; role?: string; text: string };

/** Every message item the session holds, with the request it landed in, in order. */
async function itemsOf(app: Awaited<ReturnType<typeof startApp>>, sessionId: string): Promise<Line[]> {
  const requests = (await app.runtime.stores.request.list({ sessionId, withItems: true } as never)) as Array<{ id: string; createdAt: number; items?: any[] }>;
  return requests
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((request) =>
      (request.items ?? [])
        .filter((item) => item.type === "message")
        .map((item) => ({
          requestId: request.id,
          agentName: item.agentName as string | undefined,
          role: item.role as string | undefined,
          text: typeof item.text === "string" ? item.text : ((item.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("")
        }))
    );
}

/** One attempt on fresh stores. Pushes what failed; returns the evidence, or `undefined` when the model didn't file two tasks (retried). */
async function attempt(resolver: ModelResolver, failures: string[], tell: { over<T>(name: string, values: readonly T[]): T[] }) {
  const timing = new Timing();
  const app = await startApp(resolver, timing);
  try {
    const http = actingAs(app.router as never, OWNER);
    const session = await http.open("agent", { workerId: MAIN });
    const sent = await http.call("POST", ["agent", session, "actions", "respond"], { userId: OWNER, input: { message: fixture.ask } });
    if (sent.status !== 202) throw new Error(`the ask was refused (${sent.status}): ${sent.text}`);
    const respond = JSON.parse(sent.text).request.id as string;
    // Until the reply and everything it set off are done; a task never released ends the wait as it is.
    const idle = () => Promise.race([untilIdle(app.runtime.stores as never).catch(() => undefined), sleep(240_000)]);
    await idle();
    // No answer again let the second end during the reply: it ends now, after it.
    const unreleased = (await app.rows()).find((row) => !timing.answered.has(row.id));
    if (timing.count === 1 && unreleased !== undefined) {
      timing.release(unreleased.id);
      await idle();
    }
    const filed = await app.rows();
    if (filed.length < 2 || timing.count < 2) {
      console.log(`  attempt: the model filed ${filed.length} task(s) for ${DELEGATE} and ${timing.count} ended; trying again`);
      return undefined;
    }
    const items = await itemsOf(app, session);
    const evidence: string[] = [];
    for (const [taskId, code] of timing.answered) {
      const lines = tell.over(`${code} · lines under ${DELEGATE}`, items.filter((item) => item.agentName === DELEGATE && item.text.includes(code)));
      if (lines.length !== 1) failures.push(`once: ${code} (task ${taskId}) was said ${lines.length} times under ${DELEGATE}, in requests ${lines.map((l) => (l.requestId === respond ? "respond" : l.requestId)).join(", ")}`);
      const line = lines[0]!;
      if (line.requestId !== respond) {
        failures.push(`request-id: ${code} (task ${taskId}) landed in request ${line.requestId}, not the person's request ${respond}`);
        continue;
      }
      const inRespond = items.filter((item) => item.requestId === respond);
      const after = inRespond.slice(inRespond.indexOf(line) + 1).filter((item) => item.agentName !== DELEGATE && item.role !== "user");
      const used = after.find((item) => item.text.includes(code));
      if (used === undefined) failures.push(`uses-it: no text after ${code}'s line in the person's request names it`);
      else evidence.push(`${code}: one line in the person's request, then "${used.text.slice(0, 120).replaceAll("\n", " ")}"`);
    }
    console.log(`  the person's request ${respond}; endings in order: ${[...timing.answered.values()].join(", ")}${REVERSED ? " (second-filed first)" : ""}`);
    return evidence.join(" · ");
  } finally {
    await app.state.dispose();
  }
}

await runGoal(async (failures, tell) => {
  const model = gatewayModel(process.env.GOAL_MODEL);
  const key = keysServing(model).find((name) => (process.env[name] ?? "") !== "");
  if (key === undefined || key !== "AI_GATEWAY_API_KEY") {
    return { failures: [`blocked: no AI_GATEWAY_API_KEY to serve ${model}`], evidence: "" };
  }
  const resolver = await gatewayResolver(process.env[key]!);
  const attempts = CONTROL === "" ? goalAttempts() : 1;
  for (let i = 1; i <= attempts; i += 1) {
    console.log(`attempt ${i} of ${attempts}${CONTROL !== "" ? ` (control ${CONTROL})` : ""} on ${model}`);
    const evidence = await attempt(resolver, failures, tell);
    if (evidence !== undefined) return { failures, evidence: `attempt ${i}: ${evidence}` };
  }
  failures.push(`setup: the model never filed two tasks for ${DELEGATE} in ${attempts} attempts`);
  return { failures, evidence: "" };
});

/**
 * A host for a conversation's task board on the real engine (FIX-1794 P2):
 * the coordinator flow, the built-in `agent` flow, and two fixture worker
 * flows, registered once each on one worker installation, with an HTTP router
 * whose caller is the verified user in an `x-user` header.
 *
 * - `tasker` takes tasks and nothing else. Its turn records each run (who,
 *   where, which attempt, as whom) and does what the task's goal says:
 *   `[fail]` throws, `[fail-until:N]` throws on every attempt below N,
 *   `[ask:<question>]` holds the task on its question, once,
 *   `[slow:<ms>]` takes that long, `[hold:<name>]` waits until the test
 *   releases the gate of that name (`holds`), and anything else is done.
 * - `helper` answers the message a routed task hands it.
 * - `agent` is the built-in worker flow, scripted by its generator's block name
 *   (`agent-answer`).
 *
 * Models are scripted: the coordinator's judgment turn by its generator's
 * block name (`coordinator-judgment`), from the script a test hands in.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import type { FlowInstance, GeneratorModel } from "@flow-state-dev/core/types";
import { createFlowState, createInProcessFetch, inMemoryStores, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { askMidway } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver, mockGenerator, type MockGeneratorInstance } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineAgentWorkerFlow, type AgentWorkerFlowOptions } from "../src/agent-worker-flow";
import { conversationLedgerAt, conversationLedgerResources } from "../src/conversation-board/ledger";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { workerMessagesResources } from "../src/messages/message-log";
import { messageReceivedEntry } from "../src/messages/message-received-entry";
import { defineCoordinatorFlow, type CoordinatorFlowOptions } from "../src/coordinator/coordinator-flow";
import { COORDINATOR_ROUTE } from "../src/coordinator/coordinator-keys";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkforceClient } from "../src/workers/client";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { ROSTER_FLOW } from "../src/workers/keys";
import { hireWorkforce, type HireWorkforceOptions } from "../src/workers/register";
import { mockEvaluationModel } from "@flow-state-dev/testing";

export const ORG = "acme";

/** The standard workers: coordinators that file, workers that take tasks, one that answers what it is handed. */
export function boardWorkers(overrides: Partial<Record<string, Record<string, unknown>>> = {}): WorkerManifest[] {
  const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({
    id,
    declared: { ...declared, ...(overrides[id] ?? {}) },
    body,
    skills: []
  });
  return [
    worker("lead", { flow: "coordinator", delegates: ["eng.tasker"], description: "Files work." }, "Hand out the work."),
    worker("pm", { flow: "coordinator", delegates: ["eng.tasker", "eng.writer"] }, "Plan the work."),
    worker("desk", {
      flow: "coordinator",
      routing: "best-fit",
      delegates: ["eng.tasker"],
      fallback: "eng.tasker"
    }),
    worker("rota", { flow: "coordinator", routing: "round-robin", delegates: ["eng.tasker", "eng.writer"] }),
    worker("mixed", { flow: "coordinator", delegates: ["eng.helper", "eng.tasker"] }),
    worker("boss", { flow: "coordinator", delegates: ["lead"] }, "Run the team."),
    worker("front", { flow: "coordinator", routing: "best-fit", delegates: ["otto"], fallback: "otto" }),
    worker("eng.tasker", { flow: "tasker", description: "Does tasks." }),
    worker("eng.writer", { flow: "tasker", description: "Writes things." }),
    worker("eng.helper", { flow: "helper", description: "Answers what it is handed." }),
    worker("otto", { description: "An agent worker." }, "You do what you're asked.")
  ];
}

/** One run of a task, as the worker's turn saw it. */
type TaskRun = {
  worker: string;
  message: string;
  sessionId: string;
  userId: string;
  attempt: number;
  taskId: string;
};

const doorInput = z.object({ message: z.string() });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function taskerFlow(installation: WorkerInstallation, runs: TaskRun[], holds: ReadonlyMap<string, Promise<void>>) {
  const turn = handler({
    name: "tasker-turn",
    inputSchema: doorInput,
    resources: { ...installation.resources, ...conversationLedgerResources },
    execute: async (input, ctx) => {
      const worker = await installation.resolveWorker(ctx, "tasker");
      // The row this run works, read where its task session says it is: the
      // conversation that filed it, the task it was opened for.
      const state = ctx.session.state as Record<string, unknown>;
      const partition = state.filingSessionId as string;
      const taskId = state.taskId as string;
      const tasks = await conversationLedgerAt(ctx as never, partition);
      const held = tasks?.get(taskId);
      const attempt = held?.attempts ?? 0;
      runs.push({
        worker: worker.id,
        message: input.message,
        sessionId: ctx.session.identity.id,
        userId: ctx.session.identity.userId ?? "",
        attempt,
        taskId
      });
      const message = input.message;
      const slow = /\[slow:(\d+)\]/.exec(message);
      if (slow !== null) await sleep(Number(slow[1]));
      const hold = /\[hold:([^\]]+)\]/.exec(message);
      if (hold !== null) {
        const gate = holds.get(hold[1]!);
        if (gate === undefined) throw new Error(`[hold:${hold[1]}] names no gate the test passed in holds`);
        await gate;
      }
      if (message.includes("[fail]")) throw new Error(`${worker.id} could not do it`);
      const until = /\[fail-until:(\d+)\]/.exec(message);
      if (until !== null && attempt < Number(until[1])) throw new Error(`${worker.id} failed attempt ${attempt}`);
      const ask = /\[ask:([^\]]+)\]/.exec(message);
      if (ask !== null && held !== undefined && held.askedInTurn === undefined && tasks !== undefined) {
        // `[ask:a|b]` asks two questions at once.
        const asked = await askMidway(ctx as never, tasks, ask[1]!.split("|").map((prompt) => ({ prompt })));
        if (!asked.ok) throw new Error(`the question could not hold the task: ${asked.reason}`);
        return "asked";
      }
      return `${worker.id} did: ${message}`;
    }
  });
  return defineFlow({
    kind: "tasker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...conversationLedgerResources, ...workerMessagesResources },
    actions: { respond: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
    // Like a coding worker: it hears messages only in its tasks' sessions.
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "tasker", hears: "task-sessions" }) } },
    task: { actions: { work: workerTaskEntry({ name: "tasker-task", turn }) } }
  });
}

function helperFlow(installation: WorkerInstallation) {
  const door = handler({
    name: "helper-run",
    inputSchema: doorInput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => `${(await installation.resolveWorker(ctx, "helper")).id} heard: ${input.message}`
  });
  return defineFlow({
    kind: "helper",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...workerMessagesResources },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
    internal: { actions: { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind: "helper", hears: "task-sessions" }) } },
    task: { actions: { work: workerTaskEntry({ name: "helper-task", turn: door }) } }
  });
}

/** What the default judgment turn says: it reads what woke it and does nothing else. */
const QUIET_TURN = "Noted.";

export type BoardHostOptions = {
  standard?: WorkerManifest[];
  /**
   * The judgment turn's scripted model. Omitted, every judgment turn answers
   * {@link QUIET_TURN} and does nothing else, so a turn a task's ending wakes
   * runs cleanly rather than failing unseen.
   */
  judgment?: MockGeneratorInstance;
  /** The agent worker's scripted model. */
  agentAnswer?: MockGeneratorInstance;
  /** The options the judgment turn is built with: the agent worker flow's catalog and capabilities. */
  agent?: CoordinatorFlowOptions["agent"];
  /** The `agent` flow's `answerAgain` (FIX-2159), which the coordinator flow doesn't take. */
  answerAgain?: AgentWorkerFlowOptions["answerAgain"];
  /** Capabilities the `agent` flow installs that need the installation (FIX-2173's consult). */
  agentUses?: (installation: WorkerInstallation) => NonNullable<AgentWorkerFlowOptions["uses"]>;
  stores?: StoreRegistry;
  /** Told the names of the tools each model call is handed, by the calling block's name. */
  observeTools?: (blockName: string | undefined, names: string[], input: unknown) => void;
  /**
   * Awaited after each model call, before its block sees the answer, by the
   * calling block's name: a test holds a turn open past its tool calls with it.
   */
  afterModelCall?: (blockName: string | undefined) => Promise<void>;
  /** Durable execution, so a turn can park (FIX-1816's asks). Off by default. */
  durable?: boolean;
  /** The host's debt age (`RequestWakes.maxDebtAgeMs`): how long a debt may stay owed before a pass ends it. */
  maxDebtAgeMs?: number;
  /** The host's wait deadline bounds (`RequestWaits.deadlines`). */
  waitDeadlines?: { defaultMs?: number; minMs?: number; maxMs?: number };
  /** The gates a `[hold:<name>]` task waits on, by name, until the test releases them. */
  holds?: ReadonlyMap<string, Promise<void>>;
  /**
   * A step model for the judgment turn, in place of `judgment`'s script: one
   * the generator drives step by step, so a turn parked in a tool call resumes
   * at its next step (FIX-1816's asks).
   */
  judgmentModel?: GeneratorModel;
  /**
   * A step model for the agent worker's turn, in place of `agentAnswer`'s
   * script: the generator drives it step by step, re-reading its context
   * before each step (FIX-2086's steers).
   */
  agentModel?: GeneratorModel;
  /** More worker flows, built on the installation, registered beside the four, keyed by `kind`. */
  flows?: (installation: WorkerInstallation) => Record<string, unknown>;
  /** More scripted generators, by block name. */
  generators?: Record<string, MockGeneratorInstance>;
  /** What `hireWorkforce` is called with beside the installation. */
  hire?: HireWorkforceOptions;
  /** Flows that are no worker flow, registered beside them as they are, keyed by id. */
  plainFlows?: Record<string, FlowInstance>;
  /** The engine's `errorCapture` handler (FIX-1983's reporter). */
  errorCapture?: (event: any) => void;
  /** Inbound transport adapters for the router, such as the scheduled-dispatch one. */
  adapters?: unknown[];
};

/**
 * A model resolver that tells `observe` which tools each call carries, defers
 * to `base`, and waits for `after` before the call returns.
 */
function observingTools(
  base: ReturnType<typeof createMockModelResolver>,
  observe: BoardHostOptions["observeTools"],
  after: BoardHostOptions["afterModelCall"]
): ReturnType<typeof createMockModelResolver> {
  const resolver = ((modelId: string, blockName?: string) => {
    const model = (base as any)(modelId, blockName);
    const names = (options: { tools?: Array<{ name: string }> }) => (options.tools ?? []).map((tool) => tool.name);
    return {
      ...model,
      generate: async (options: any) => {
        observe?.(blockName, names(options), options);
        const result = await model.generate(options);
        await after?.(blockName);
        return result;
      },
      ...(model.stream === undefined
        ? {}
        : {
            stream: async function* (options: any) {
              observe?.(blockName, names(options), options);
              yield* model.stream(options);
              await after?.(blockName);
            }
          })
    };
  }) as ReturnType<typeof createMockModelResolver>;
  return Object.assign(resolver, base);
}

/** `base`, with the judgment turn's block answered by `model` when one is given, and the agent's by `agent`. */
function withJudgmentModel(
  base: ReturnType<typeof createMockModelResolver>,
  model: GeneratorModel | undefined,
  agent?: GeneratorModel
): ReturnType<typeof createMockModelResolver> {
  if (model === undefined && agent === undefined) return base;
  const resolver = ((modelId: string, blockName?: string) => {
    if (model !== undefined && blockName === "coordinator-judgment") return model;
    if (agent !== undefined && blockName?.startsWith("agent-answer") === true) return agent;
    return (base as any)(modelId, blockName);
  }) as ReturnType<typeof createMockModelResolver>;
  return Object.assign(resolver, base);
}

/** One host of the app over `stores`. */
export function bootBoardHost(options: BoardHostOptions = {}) {
  const stores = options.stores ?? inMemoryStores();
  const runs: TaskRun[] = [];
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: options.standard ?? boardWorkers(),
    workerFlows: () => flows as never
  });
  const tasker = taskerFlow(installation, runs, options.holds ?? new Map());
  const helper = helperFlow(installation);
  const agent = defineAgentWorkerFlow({
    installation,
    ...(options.agent ?? {}),
    ...(options.answerAgain === undefined ? {} : { answerAgain: options.answerAgain }),
    ...(options.agentUses === undefined ? {} : { uses: options.agentUses(installation) })
  });
  const coordinator = defineCoordinatorFlow({
    installation,
    routeModel: "typesafe-ai/jev",
    ...(options.agent === undefined ? {} : { agent: options.agent })
  });
  flows = {
    tasker: { flow: tasker, roles: ["contributor"] },
    helper: { flow: helper, roles: ["contributor"] },
    agent,
    coordinator,
    ...(options.flows?.(installation) ?? {})
  };

  // One copy per worker flow, and the roster flow, as an app registers them.
  const instances: Record<string, FlowInstance> = Object.fromEntries(
    hireWorkforce(installation, options.hire).map((copy) => [copy.id === ROSTER_FLOW ? "roster" : copy.id, copy])
  );
  Object.assign(instances, options.plainFlows ?? {});
  const judgment = options.judgment ?? mockGenerator({ script: [{ when: () => true, then: { text: QUIET_TURN } }] });
  const agentAnswer = options.agentAnswer ?? mockGenerator({ script: [] });
  const models = createMockModelResolver({
    evaluators: {
      [COORDINATOR_ROUTE]: mockEvaluationModel({ answers: { worker: { type: "choice", choice: "eng.tasker" } } })
    },
    generators: { "coordinator-judgment": judgment, "agent-answer": agentAnswer, ...(options.generators ?? {}) }
  });
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: stores } },
    ...(options.durable === true ? { durable: true } : {}),
    ...(options.maxDebtAgeMs === undefined ? {} : { maxDebtAgeMs: options.maxDebtAgeMs }),
    ...(options.waitDeadlines === undefined ? {} : { waitDeadlines: options.waitDeadlines }),
    ...(options.errorCapture === undefined ? {} : { errorCapture: options.errorCapture }),
    ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
    modelResolver: withJudgmentModel(
      options.observeTools === undefined && options.afterModelCall === undefined
        ? models
        : observingTools(models, options.observeTools, options.afterModelCall),
      options.judgmentModel,
      options.agentModel
    ),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const router = async () => (await state.getRouter()) as any;

  /** One POST, shared by session create, action dispatch, and abort. */
  const postJson = async (userId: string, path: string[], body: unknown): Promise<Response> => {
    const request = new Request(`http://localhost/api/flows/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify(body)
    });
    return (await router()).POST(request, { params: { path } });
  };

  /** POST a session create as `userId`. */
  const create = async (userId: string, flow: string, body: Record<string, unknown>) => {
    const res = await postJson(userId, [flow, "sessions"], { userId, ...body });
    return { status: res.status, body: (await res.json()) as { session?: { id: string }; error?: string } };
  };

  /** A coordinator conversation for `userId` with worker `worker`. */
  const conversation = async (userId: string, worker = "lead", sessionId?: string) => {
    const created = await create(userId, "coordinator", {
      ...(sessionId === undefined ? {} : { sessionId }),
      state: { workerId: worker }
    });
    if (created.status !== 201 && created.status !== 200) {
      throw new Error(`creating a ${worker} conversation failed (${created.status}): ${JSON.stringify(created.body)}`);
    }
    return created.body.session!.id;
  };

  /** POST an action through the host's dispatch, so its concurrency policy applies. The accepted request's id. */
  const post = async (userId: string, sessionId: string, actionName: string, input: unknown, flow = "coordinator") => {
    const res = await postJson(userId, [flow, sessionId, "actions", actionName], { userId, input });
    const body = (await res.json()) as { request?: { id: string }; error?: unknown };
    if (res.status !== 202) throw new Error(`POST ${actionName} was refused (${res.status}): ${JSON.stringify(body)}`);
    return body.request!.id;
  };

  /** Cancel a request as `userId`. */
  const abort = async (userId: string, requestId: string, flow = "coordinator") => {
    const res = await postJson(userId, [flow, "requests", requestId, "abort"], { userId });
    if (res.status >= 300) throw new Error(`aborting ${requestId} was refused (${res.status}): ${await res.text()}`);
  };

  /** Run an action on `flow` as `userId`, in process. */
  const act = async (userId: string, sessionId: string, actionName: string, input: unknown, flow = "coordinator") => {
    const runtime = await state.getRuntime();
    return (await runAction({
      flow: instances[flow]!,
      actionName,
      input,
      userId,
      orgId: ORG,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    })) as { output?: any; error?: { message?: string } | unknown; status?: string; requestId?: string };
  };

  /** Every request in the store, once none is still running. */
  const settled = async (timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    // Still running: in progress, or ended but not finalized. A record reads
    // `completed` before `onFinished` and the request-end check (FIX-2077)
    // have run, and a task's row is settled by that check.
    const running = (r: { status: string; finalizedAtMs?: number | null }) =>
      r.status === "in_progress" || (r.status !== "suspended" && r.status !== "pending" && r.finalizedAtMs == null);
    for (;;) {
      const all = await (await state.getRuntime()).stores.request.list({});
      if (!all.some(running)) {
        // Read again after a beat: a dispatch accepted just now may not have
        // written its request yet.
        await sleep(20);
        const again = await (await state.getRuntime()).stores.request.list({});
        if (!again.some(running) && again.length === all.length) return again;
        continue;
      }
      if (Date.now() > deadline) throw new Error("a request never finished");
      await sleep(10);
    }
  };

  /** Every row of `userId`'s conversation ledger, by partition: read from the store, not through the board. */
  const rows = async (userId: string): Promise<Array<Task & { partition: string }>> => {
    const runtime = await state.getRuntime();
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, "tasks/");
    return Object.entries(entries).map(([key, value]) => ({
      ...(value.state as Task),
      partition: key.split("/")[1]!
    }));
  };

  /** One row, by the partition it was filed in. */
  const row = async (userId: string, partition: string, taskId: string) =>
    (await rows(userId)).find((r) => r.partition === encodeUserSegment(partition) && r.id === taskId);

  /** A conversation's `filingSessionId`, as its `listDelegates` answers it. */
  const filingOf = async (userId: string, sessionId: string): Promise<string> => {
    const listed = await act(userId, sessionId, "listDelegates", {});
    return listed.output.filingSessionId;
  };

  /** A session's record. */
  const session = async (sessionId: string) => (await (await state.getRuntime()).stores.session.get(sessionId))!;

  /** Every request a session ran, oldest first. */
  const requestsOf = async (sessionId: string) =>
    (await (await state.getRuntime()).stores.request.list({ sessionId, withItems: true })).sort(
      (a, b) => a.createdAt - b.createdAt
    );

  /** A session's message items, oldest first. */
  const messages = async (sessionId: string) =>
    (await requestsOf(sessionId))
      .flatMap((request) => (request as unknown as { items?: any[] }).items ?? [])
      .filter((item) => item.type === "message")
      .map((item) => ({ agentName: item.agentName as string | undefined, text: textOf(item) }));

  /** An app's workforce client for `userId`, talking to this host's router. */
  const inProcess = createInProcessFetch(state);
  const client = (userId: string) =>
    createWorkforceClient(
      createClient({
        userId,
        // This host's router in-process, as `userId`.
        fetcher: (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("x-user", userId);
          return inProcess(input, { ...init, headers });
        }
      })
    );

  /**
   * Make every new request on `actionName` fail to be written, as a store
   * that is down when the dispatch records it: the dispatch is lost, the way
   * a process dying before it would lose it. Returns the restore.
   */
  const loseDispatches = async (actionName: string) => {
    const store = (await state.getRuntime()).stores.request;
    const set = store.set.bind(store);
    let lost = 0;
    store.set = (async (id: string, record: { actionName?: string }, ...rest: unknown[]) => {
      if (record.actionName === actionName && (await store.get(id)) === undefined) {
        lost += 1;
        throw new Error(`the store is down: request ${id} was not recorded`);
      }
      return (set as (...args: unknown[]) => Promise<unknown>)(id, record, ...rest);
    }) as typeof store.set;
    return {
      lost: () => lost,
      restore: () => {
        store.set = set as typeof store.set;
      }
    };
  };

  /** Write a stored row as a crash would leave it: a test's stand-in for a write that landed with nothing after it. */
  const writeRow = async (userId: string, partition: string, task: Task) => {
    const store = (await state.getRuntime()).stores.resourceState;
    const key = `tasks/${encodeUserSegment(partition)}/${task.id}`;
    await store.set("user", `${userId}:~org:${ORG}`, key, task as never, "any" as never);
  };

  /** Hire or fire a worker on `userId`'s roster. */
  const hire = async (userId: string, input: Record<string, unknown>) =>
    act(userId, `roster-${userId}`, "hire", input, "roster");
  const fire = async (userId: string, id: string) => act(userId, `roster-${userId}`, "fire", { id }, "roster");

  return {
    installation,
    stores,
    state,
    instances,
    runs,
    judgment,
    agentAnswer,
    create,
    conversation,
    post,
    abort,
    act,
    settled,
    rows,
    row,
    filingOf,
    session,
    requestsOf,
    messages,
    client,
    hire,
    fire,
    loseDispatches,
    writeRow,
    router,
    dispose: () => state.dispose()
  };
}

export type BoardHost = ReturnType<typeof bootBoardHost>;

function textOf(item: any): string {
  if (typeof item.text === "string") return item.text;
  const content = item.content as Array<{ type: string; text?: string }> | undefined;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

/** An error's message, whatever shape a run reported it in. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

/**
 * A fixture worker flow's `onMessageReceived`, which every worker flow on an
 * installation must carry: spread into `internal.actions`, with
 * `workerMessagesResources` in the flow's resources. No turn: a message lands
 * as its items and nothing runs.
 */
export function hearsMessages(installation: WorkerInstallation, flowKind: string, hears?: "task-sessions") {
  return { [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({ installation, flowKind, ...(hears === undefined ? {} : { hears }) }) };
}

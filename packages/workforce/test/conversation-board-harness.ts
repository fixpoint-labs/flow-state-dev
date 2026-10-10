/**
 * A host for a conversation's task board on the real engine (FIX-1794 P2):
 * the coordinator flow, the built-in `agent` flow, and two fixture worker
 * flows, registered once each on one worker installation, with an HTTP router
 * whose caller is the verified user in an `x-user` header.
 *
 * - `tasker` takes tasks and nothing else. Its turn records each run (who,
 *   where, which attempt, as whom) and does what the task's goal says:
 *   `[fail]` throws, `[fail-until:N]` throws on every attempt below N,
 *   `[park:<question>]` parks the task on its question on the first attempt,
 *   `[slow:<ms>]` takes that long, and anything else is done.
 * - `helper` takes delegated posts and no task.
 * - `agent` is the built-in kind, scripted by its generator's block name
 *   (`agent-answer`).
 *
 * Models are scripted: the coordinator's judgment turn by its generator's
 * block name (`coordinator-judgment`), from the script a test hands in.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import { ticketForClaim, type Task } from "@flow-state-dev/orchestration/tasks";
import { createMockModelResolver, mockGenerator, type MockGeneratorInstance } from "@flow-state-dev/testing";
import { z } from "zod";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { conversationLedgerAt, conversationLedgerResources } from "../src/conversation-board/ledger";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { defineCoordinatorFlow, type CoordinatorFlowOptions } from "../src/coordinator/coordinator-flow";
import { COORDINATOR_ROUTE } from "../src/coordinator/coordinator-keys";
import { delegatedPostEntry } from "../src/coordinator/delegated-post";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkforceClient } from "../src/workers/client";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { ROSTER_FLOW_KIND } from "../src/workers/keys";
import { hireWorkforce } from "../src/workers/register";
import { mockEvaluationModel } from "@flow-state-dev/testing";

export const ORG = "acme";

/** The standard workers: coordinators that file, workers that take tasks, one that takes only posts. */
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
    worker("eng.helper", { flow: "helper", description: "Answers posts." }),
    worker("otto", { description: "An agent worker." }, "You do what you're asked.")
  ];
}

/** One run of a task, as the worker's turn saw it. */
export type TaskRun = {
  worker: string;
  message: string;
  sessionId: string;
  userId: string;
  attempt: number;
  taskId: string;
};

const doorInput = z.object({ message: z.string() });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function taskerFlow(installation: WorkerInstallation, runs: TaskRun[]) {
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
      if (message.includes("[fail]")) throw new Error(`${worker.id} could not do it`);
      const until = /\[fail-until:(\d+)\]/.exec(message);
      if (until !== null && attempt < Number(until[1])) throw new Error(`${worker.id} failed attempt ${attempt}`);
      const park = /\[park:([^\]]+)\]/.exec(message);
      if (park !== null && attempt === 1 && held !== undefined) {
        await tasks!.awaitReview(taskId, park[1], { claim: ticketForClaim(tasks!.collectionId, held, partition) });
        return "parked";
      }
      return `${worker.id} did: ${message}`;
    }
  });
  return defineFlow({
    kind: "tasker",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources, ...conversationLedgerResources },
    actions: { run: { inputSchema: doorInput, block: turn, userMessage: (i: { message: string }) => i.message } },
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
    resources: { ...installation.resources },
    actions: { run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
    internal: { actions: { onDelegatedPost: delegatedPostEntry(door) } }
  });
}

export type BoardHostOptions = {
  standard?: WorkerManifest[];
  /** The judgment turn's scripted model. Omitted, a judgment turn has no script and fails. */
  judgment?: MockGeneratorInstance;
  /** The agent worker's scripted model. */
  agentAnswer?: MockGeneratorInstance;
  /** The options the judgment turn is built with: the agent kind's catalog and capabilities. */
  agent?: CoordinatorFlowOptions["agent"];
  stores?: StoreRegistry;
  /** Told the names of the tools each model call is handed, by the calling block's name. */
  observeTools?: (blockName: string | undefined, names: string[], input: unknown) => void;
  /**
   * Awaited after each model call, before its block sees the answer, by the
   * calling block's name: a test holds a turn open past its tool calls with it.
   */
  afterModelCall?: (blockName: string | undefined) => Promise<void>;
  /** More worker flows, built on the installation, registered beside the four, by kind. */
  flows?: (installation: WorkerInstallation) => Record<string, unknown>;
  /** More scripted generators, by block name. */
  generators?: Record<string, MockGeneratorInstance>;
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

/** One host of the app over `stores`. */
export function bootBoardHost(options: BoardHostOptions = {}) {
  const stores = options.stores ?? inMemoryStores();
  const runs: TaskRun[] = [];
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: options.standard ?? boardWorkers(),
    workerFlows: () => flows as never
  });
  const tasker = taskerFlow(installation, runs);
  const helper = helperFlow(installation);
  const agent = defineAgentWorkerFlow({ installation, ...(options.agent ?? {}) });
  const coordinator = defineCoordinatorFlow({
    installation,
    delegateFlows: [helper, agent],
    routeModel: "typesafe-ai/jev",
    ...(options.agent === undefined ? {} : { agent: options.agent })
  });
  flows = { tasker, helper, agent, coordinator, ...(options.flows?.(installation) ?? {}) };

  // One copy per worker flow, and the roster flow, as an app registers them.
  const instances: Record<string, FlowInstance> = Object.fromEntries(
    hireWorkforce(installation).map((copy) => [copy.id === ROSTER_FLOW_KIND ? "roster" : copy.id, copy])
  );
  const judgment = options.judgment ?? mockGenerator({ script: [] });
  const agentAnswer = options.agentAnswer ?? mockGenerator({ script: [] });
  const models = createMockModelResolver({
    evaluators: {
      [COORDINATOR_ROUTE]: mockEvaluationModel({ answers: { member: { type: "choice", choice: "eng.tasker" } } })
    },
    generators: { "coordinator-judgment": judgment, "agent-answer": agentAnswer, ...(options.generators ?? {}) }
  });
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: stores } },
    modelResolver:
      options.observeTools === undefined && options.afterModelCall === undefined
        ? models
        : observingTools(models, options.observeTools, options.afterModelCall),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  const router = async () => (await state.getRouter()) as any;

  /** POST a session create as `userId`. */
  const create = async (userId: string, flow: string, body: Record<string, unknown>) => {
    const request = new Request(`http://localhost/api/flows/${flow}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ userId, ...body })
    });
    const res: Response = await (await router()).POST(request, { params: { path: [flow, "sessions"] } });
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
    for (;;) {
      const all = await (await state.getRuntime()).stores.request.list({});
      if (!all.some((r) => r.status === "in_progress")) {
        // Read again after a beat: a dispatch accepted just now may not have
        // written its request yet.
        await sleep(20);
        const again = await (await state.getRuntime()).stores.request.list({});
        if (!again.some((r) => r.status === "in_progress") && again.length === all.length) return again;
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
  const client = (userId: string) =>
    createWorkforceClient({
      userId,
      fetcher: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input), "http://localhost");
        const headers = new Headers(init?.headers);
        headers.set("x-user", userId);
        const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
        const method = (init?.method ?? "GET").toUpperCase();
        return (await router())[method](new Request(url, { ...init, headers }), { params: { path } });
      }
    });

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

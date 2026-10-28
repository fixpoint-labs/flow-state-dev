/**
 * A host running the coordinator on the real engine, for the coordinator
 * tests: the coordinator flow and four fixture worker flows registered once
 * each on one worker installation, the roster flow with the hire and fire
 * blocks, and an HTTP router whose caller is the verified user in an
 * `x-user` header.
 *
 * - `helper` takes a conversation's tasks, the routed ones a coordinator
 *   files for its user's messages among them (FIX-2083). Its turn answers
 *   `<worker> heard: <message>` and records every message it hears; a message
 *   carrying `[fail]` makes its turn throw, so the task is never answered.
 *   `[fail:<worker>]` fails only that worker's turn, and `[slow:<worker>]`
 *   holds only that worker's answer for {@link SLOW_MS}. `[hang:<worker>]`
 *   holds that worker's first task until its run is cancelled
 *   (`cancelDelegate`).
 * - `quiet` takes nothing: its workers can't be delegates.
 * - `tasker` and `allround` take tasks. Their turns answer `<flow> heard it`.
 *
 * Models are scripted: the best-fit evaluator by block name
 * (`coordinator-route`), answering from the post's first `[route:<worker>]`
 * mark among the choices it is offered, else its first mark, and failing a
 * post with none; a `[conf:<n>]` mark makes it report confidence `n`, and
 * without one it reports none; the judgment turn by its generator's block name
 * (`coordinator-judgment`), from the script a test hands in.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, createInProcessFetch, inMemoryStores, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";
import {
  createMockModelResolver,
  mockEvaluationModel,
  mockGenerator,
  type MockGeneratorInstance
} from "@flow-state-dev/testing";
import { z } from "zod";
import { defineCoordinatorFlow, type CoordinatorFlowOptions } from "../src/coordinator/coordinator-flow";
import { workerTaskEntry } from "../src/conversation-board/task-entry";
import { COORDINATOR_ROUTE } from "../src/coordinator/coordinator-keys";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkforceClient } from "../src/workers/client";
import { createWorkerHireBlocks } from "../src/workers/hire-blocks";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { defineWorkerRosterFlow } from "../src/workers/roster-flow";

export const ORG = "acme";

/**
 * The standard workers: two coordinators, four helpers, one worker that takes
 * nothing, and two more that take tasks.
 */
export function standardWorkers(overrides: Partial<Record<string, Record<string, unknown>>> = {}): WorkerManifest[] {
  const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({
    id,
    declared: { ...declared, ...(overrides[id] ?? {}) },
    body,
    skills: []
  });
  return [
    worker("chief", { flow: "coordinator", delegates: ["eng.em"], description: "Your one point of contact." }, "Route the work."),
    worker("desk", {
      flow: "coordinator",
      routing: "best-fit",
      delegates: ["eng.em", "eng.coder", "support.general"],
      fallback: "support.general",
      description: "Ask the team anything."
    }),
    worker("eng.em", { flow: "helper", description: "Plans and staffs engineering work." }),
    worker("eng.coder", { flow: "helper", description: "Writes code." }),
    worker("support.general", { flow: "helper", description: "Anything that fits no one else." }),
    worker("silent", { flow: "helper" }),
    worker("notes", { flow: "quiet", description: "Takes notes." }),
    worker("eng.builder", { flow: "tasker", description: "Builds what a task names." }),
    worker("eng.lead", { flow: "allround", description: "Leads engineering work." })
  ];
}

/** One message a helper heard. */
export type Heard = { worker: string; message: string; sessionId: string };

const doorInput = z.object({ message: z.string() });

/** How long a `[slow:<worker>]` mark holds that worker's answer. */
export const SLOW_MS = 1_500;

/** The longest a `[hang:<worker>]` mark waits to be cancelled. */
const HANG_MS = 10_000;

function helperFlow(installation: WorkerInstallation, heard: Heard[]) {
  const hung = new Set<string>();
  const door = handler({
    name: "helper-run",
    inputSchema: doorInput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const worker = await installation.resolveWorker(ctx, "helper");
      heard.push({ worker: worker.id, message: input.message, sessionId: ctx.session.identity.id });
      if (input.message.includes("[fail]") || input.message.includes(`[fail:${worker.id}]`)) {
        throw new Error(`${worker.id} could not answer`);
      }
      if (input.message.includes(`[slow:${worker.id}]`)) await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      // The first task for this worker waits until its run is cancelled.
      if (input.message.includes(`[hang:${worker.id}]`) && !hung.has(worker.id)) {
        hung.add(worker.id);
        await new Promise<void>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${worker.id} was never cancelled`)), HANG_MS);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error(`${worker.id} was cancelled`));
          });
        });
      }
      // `[empty]`: the turn answers nothing; `[empty:<worker>]`, only that worker's.
      if (input.message.includes("[empty]") || input.message.includes(`[empty:${worker.id}]`)) return "";
      return `${worker.id} heard: ${input.message}`;
    }
  });
  return defineFlow({
    kind: "helper",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
    task: { actions: { work: workerTaskEntry({ name: "helper-task", turn: door }) } }
  });
}

function quietFlow(installation: WorkerInstallation) {
  const door = handler({ name: "quiet-run", inputSchema: doorInput, execute: () => "noted" });
  return defineFlow({
    kind: "quiet",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } }
  });
}

/** A flow that takes tasks: `tasker` and `allround`. */
function taskingFlow(installation: WorkerInstallation, flow: "tasker" | "allround") {
  const door = handler({ name: `${flow}-run`, inputSchema: doorInput, execute: () => `${flow} heard it` });
  return defineFlow({
    kind: flow,
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } },
    // Takes a conversation's tasks, as the delegate check requires (FIX-1842).
    task: { actions: { work: workerTaskEntry({ name: `${flow}-task`, turn: door }) } }
  });
}

/**
 * The scripted best-fit evaluation: the first `[route:<worker>]` mark naming a
 * choice it is offered picks that one, else the first mark picks its worker,
 * `[route:none]` an off-list one; no mark fails. A `[conf:<n>]` mark reports
 * confidence `n`; without one, none is reported.
 */
function scriptedRoute() {
  return mockEvaluationModel({
    answers: ({ state, questions }) => {
      const text = (state as { post: { text: string } }).post.text;
      const marks = [...text.matchAll(/\[route:([a-z.-]+)\]/g)].map((match) => match[1]!);
      if (marks.length === 0) throw new Error("the scripted route has no answer for this message");
      const offered = (questions as { worker?: { criteria?: Record<string, string> } }).worker?.criteria ?? {};
      const picked = marks.find((mark) => Object.hasOwn(offered, mark)) ?? marks[0]!;
      const confidence = /\[conf:([0-9.]+)\]/.exec(text)?.[1];
      return {
        worker: {
          type: "choice",
          choice: picked === "none" ? "nobody.here" : picked,
          ...(confidence === undefined ? {} : { confidence: Number(confidence) })
        }
      };
    }
  });
}

export type HostOptions = {
  standard?: WorkerManifest[];
  /** The judgment turn's scripted model. Omitted, a judgment turn has no script and fails. */
  judgment?: MockGeneratorInstance;
  /** The options the judgment turn is built with: the agent worker flow's catalog and capabilities. */
  agent?: CoordinatorFlowOptions["agent"];
  /** How long a round waits for its answers. */
  roundDeadlineMs?: number;
  /** When set, the evaluator throws and this generator answers best fit's question. */
  languageRoute?: MockGeneratorInstance;
  stores?: StoreRegistry;
  /** Durable execution, so the host keeps wakes (FIX-2078). Off by default. */
  durable?: boolean;
  /** More flows to register beside the fixture ones, keyed by flow name. */
  flows?: Record<string, FlowInstance>;
};

/** One host of the app over `stores`. */
export function bootHost(options: HostOptions = {}) {
  const stores = options.stores ?? inMemoryStores();
  const heard: Heard[] = [];
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: options.standard ?? standardWorkers(),
    workerFlows: () => flows as never
  });
  const helper = helperFlow(installation, heard);
  const quiet = quietFlow(installation);
  const tasker = taskingFlow(installation, "tasker");
  const allround = taskingFlow(installation, "allround");
  const coordinator = defineCoordinatorFlow({
    installation,
    routeModel: "typesafe-ai/jev",
    ...(options.agent === undefined ? {} : { agent: options.agent }),
    ...(options.roundDeadlineMs === undefined ? {} : { roundDeadlineMs: options.roundDeadlineMs })
  });
  flows = {
    helper: { flow: helper, roles: ["contributor"] },
    quiet,
    tasker: { flow: tasker, roles: ["contributor"] },
    allround: { flow: allround, roles: ["contributor"] },
    coordinator
  };

  const blocks = createWorkerHireBlocks(installation);
  const rosterFlow = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: blocks.hire.inputSchema, block: blocks.hire },
    fire: { inputSchema: blocks.fire.inputSchema, block: blocks.fire }
  });

  const instances: Record<string, FlowInstance> = {
    coordinator: coordinator() as unknown as FlowInstance,
    helper: helper() as unknown as FlowInstance,
    quiet: quiet() as unknown as FlowInstance,
    tasker: tasker() as unknown as FlowInstance,
    allround: allround() as unknown as FlowInstance,
    roster: rosterFlow() as unknown as FlowInstance,
    ...(options.flows ?? {})
  };
  const route =
    options.languageRoute === undefined
      ? scriptedRoute()
      : // The gateway's refusal of a language model, whatever `routeModel` names.
        mockEvaluationModel({
          error: new Error("Model is a language model, not a decision model. Use the language generation API instead.")
        });
  const judgment = options.judgment ?? mockGenerator({ script: [] });
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: stores } },
    ...(options.durable === true ? { durable: true } : {}),
    modelResolver: createMockModelResolver({
      evaluators: { [COORDINATOR_ROUTE]: route },
      generators: {
        "coordinator-judgment": judgment,
        ...(options.languageRoute === undefined ? {} : { "coordinator-route-ask": options.languageRoute })
      }
    }),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG } : null;
    }
  } as never);

  /** POST a session create as `userId`. */
  const create = async (userId: string, flow: string, body: Record<string, unknown>) => {
    const router = (await state.getRouter()) as any;
    const request = new Request(`http://localhost/api/flows/${flow}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ userId, ...body })
    });
    const res: Response = await router.POST(request, { params: { path: [flow, "sessions"] } });
    return { status: res.status, body: (await res.json()) as { session?: { id: string }; error?: string } };
  };

  /** A coordinator conversation for `userId` with worker `worker`. */
  const conversation = async (userId: string, worker = "chief", sessionId?: string) => {
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
  const act = async (
    userId: string,
    sessionId: string,
    actionName: string,
    input: unknown,
    flow = "coordinator",
    source?: "internal"
  ) => {
    const runtime = await state.getRuntime();
    return (await runAction({
      flow: instances[flow]!,
      actionName,
      input,
      userId,
      orgId: ORG,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
      ...(source === undefined ? {} : { source })
    })) as { output?: any; error?: { message?: string } | unknown; status?: string };
  };

  /** Hire a worker onto `userId`'s roster. */
  const hire = async (userId: string, input: Record<string, unknown>) =>
    act(userId, `roster-${userId}`, "hire", input, "roster");
  const fire = async (userId: string, id: string) => act(userId, `roster-${userId}`, "fire", { id }, "roster");

  /**
   * Abort `worker`'s running task request, as `userId` would through the
   * app's abort route, once it is running. Returns the route's status.
   */
  const cancelDelegate = async (userId: string, worker: string) => {
    const runtime = await state.getRuntime();
    const deadline = Date.now() + 5_000;
    for (;;) {
      const running = (await runtime.stores.request.list({})).find(
        (request) =>
          request.status === "in_progress" &&
          request.actionName === "work" &&
          heard.some((h) => h.worker === worker && h.sessionId === request.sessionId)
      );
      if (running !== undefined) {
        const router = (await state.getRouter()) as any;
        const res: Response = await router.POST(
          new Request(`http://localhost/api/flows/helper/requests/${running.id}/abort`, {
            method: "POST",
            headers: { "x-user": userId }
          }),
          { params: { path: ["helper", "requests", running.id, "abort"] } }
        );
        return res.status;
      }
      if (Date.now() > deadline) throw new Error(`no task for ${worker} is running`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  /** Every request in the store, once none is still running. */
  const settled = async () => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const all = await (await state.getRuntime()).stores.request.list({});
      if (!all.some((r) => r.status === "in_progress")) return all;
      if (Date.now() > deadline) throw new Error("a request never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  /**
   * Every routed task on `userId`'s conversation boards (FIX-2083), oldest
   * first: each task whose brief names the message it routes, read from the
   * store, not through a board.
   */
  const routedRows = async (userId: string): Promise<any[]> => {
    const runtime = await state.getRuntime();
    const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, "tasks/");
    return Object.values(entries)
      .map((value) => value.state as any)
      .filter((row) => typeof row?.sealed?.postId === "string")
      .sort((a, b) => a.createdAt - b.createdAt);
  };

  /** A conversation's session state, as stored. */
  const sessionState = async (sessionId: string) =>
    ((await (await state.getRuntime()).stores.session.get(sessionId))?.state ?? {}) as Record<string, any>;

  /** A session's component items of `component`, and its messages, oldest first. */
  const items = async (sessionId: string) => {
    const requests = await (await state.getRuntime()).stores.request.list({ sessionId, withItems: true });
    const all = requests
      .sort((a, b) => a.createdAt - b.createdAt)
      .flatMap((request) => (request as unknown as { items?: any[] }).items ?? []);
    const records = all
      .filter((item) => item.type === "component" && item.component === COORDINATOR_ROUTE)
      .map((item) => item.data);
    const messages = all
      .filter((item) => item.type === "message")
      .map((item) => ({ agentName: item.agentName as string | undefined, text: textOf(item) }));
    return { records, messages, all };
  };

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

  return {
    installation,
    stores,
    state,
    heard,
    route,
    judgment,
    create,
    conversation,
    act,
    hire,
    fire,
    cancelDelegate,
    settled,
    sessionState,
    routedRows,
    items,
    client
  };
}

function textOf(item: any): string {
  if (typeof item.text === "string") return item.text;
  const content = item.content as Array<{ type: string; text?: string }> | undefined;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

/** An error's message, whatever shape a run reported it in. */
/**
 * Every request settled, read again after a grace period, until nothing new
 * starts: answers that go back out run in requests of their own.
 */
export async function quiet(host: { settled(): Promise<unknown[]> }) {
  let seen = -1;
  for (;;) {
    const settled = await host.settled();
    if (settled.length === seen) return settled;
    seen = settled.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

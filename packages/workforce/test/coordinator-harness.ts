/**
 * A host running the coordinator on the real engine, for the coordinator
 * tests: the coordinator flow and two fixture worker flows registered once
 * each on one worker installation, the roster flow with the hire and fire
 * blocks, and an HTTP router whose caller is the verified user in an
 * `x-user` header.
 *
 * - `helper` takes delegated posts. Its door answers `<worker> heard: <message>`
 *   and records every delivery it hears; a message carrying `[fail]` makes its
 *   turn throw, so the delivery is never answered.
 * - `quiet` takes nothing: its workers can't be delegates.
 *
 * Models are scripted: the best-fit evaluator by block name
 * (`coordinator-route`), answering from the post's `[route:<worker>]` mark and
 * failing a post with none; the judgment turn by its generator's block name
 * (`coordinator-judgment`), from the script a test hands in.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction, type StoreRegistry } from "@flow-state-dev/engine";
import {
  createMockModelResolver,
  mockEvaluationModel,
  mockGenerator,
  type MockGeneratorInstance
} from "@flow-state-dev/testing";
import { z } from "zod";
import { defineCoordinatorFlow } from "../src/coordinator/coordinator-flow";
import { delegatedPostEntry } from "../src/coordinator/delegated-post";
import { COORDINATOR_ROUTE } from "../src/coordinator/coordinator-keys";
import type { WorkerManifest } from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkerHireBlocks } from "../src/workers/hire-blocks";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { defineWorkerRosterFlow } from "../src/workers/roster-flow";

export const ORG = "acme";

/** The standard workers: two coordinators, four helpers, one worker that takes nothing. */
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
    worker("notes", { flow: "quiet", description: "Takes notes." })
  ];
}

/** One delivery a helper heard. */
export type Heard = { worker: string; message: string; sessionId: string };

const doorInput = z.object({ message: z.string() });

function helperFlow(installation: WorkerInstallation, heard: Heard[]) {
  const door = handler({
    name: "helper-run",
    inputSchema: doorInput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const worker = await installation.resolveWorker(ctx, "helper");
      heard.push({ worker: worker.id, message: input.message, sessionId: ctx.session.identity.id });
      if (input.message.includes("[fail]")) throw new Error(`${worker.id} could not answer`);
      return `${worker.id} heard: ${input.message}`;
    }
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

function quietFlow(installation: WorkerInstallation) {
  const door = handler({ name: "quiet-run", inputSchema: doorInput, execute: () => "noted" });
  return defineFlow({
    kind: "quiet",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message } }
  });
}

/** The scripted best-fit evaluation: `[route:<worker>]` picks that worker, `[route:none]` an off-list one; no mark fails. */
function scriptedRoute() {
  return mockEvaluationModel({
    answers: ({ state }) => {
      const text = (state as { post: { text: string } }).post.text;
      const picked = /\[route:([a-z.-]+)\]/.exec(text)?.[1];
      if (picked === undefined) throw new Error("the scripted route has no answer for this post");
      return { member: { type: "choice", choice: picked === "none" ? "nobody.here" : picked } };
    }
  });
}

export type HostOptions = {
  standard?: WorkerManifest[];
  /** The judgment turn's scripted model. Omitted, a judgment turn has no script and fails. */
  judgment?: MockGeneratorInstance;
  stores?: StoreRegistry;
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
  const coordinator = defineCoordinatorFlow({ installation, delegateFlows: [helper], routeModel: "typesafe-ai/jev" });
  flows = { helper, quiet, coordinator };

  const blocks = createWorkerHireBlocks(installation);
  const rosterFlow = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: blocks.hire.inputSchema, block: blocks.hire },
    fire: { inputSchema: blocks.fire.inputSchema, block: blocks.fire }
  });

  const instances: Record<string, FlowInstance> = {
    coordinator: coordinator() as unknown as FlowInstance,
    helper: helper() as unknown as FlowInstance,
    quiet: quiet() as unknown as FlowInstance,
    roster: rosterFlow() as unknown as FlowInstance
  };
  const route = scriptedRoute();
  const judgment = options.judgment ?? mockGenerator({ script: [] });
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({
      evaluators: { [COORDINATOR_ROUTE]: route },
      generators: { "coordinator-judgment": judgment }
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

  /** Every request in the store, once none is still running. */
  const settled = async () => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const all = await (await state.getRuntime()).stores.request.list({});
      if (!all.some((r) => r.status === "in_progress" || r.status === "queued")) return all;
      if (Date.now() > deadline) throw new Error("a request never finished");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
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

  return { installation, stores, state, heard, route, judgment, create, conversation, act, hire, fire, settled, sessionState, items };
}

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

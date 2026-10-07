/**
 * A host running the worker model on the real engine, for the worker-model
 * tests: two worker flows registered once each, the roster flow with the
 * hire, fork, edit and fire blocks, and an HTTP router whose caller is the
 * verified user in an `x-user` header. Two hosts built over one store are two
 * processes of one app.
 *
 * `fixture-worker`'s door answers with what the turn ran as: the worker, its
 * instructions and settings as its flow parsed them, its skills, and which of
 * the two documents it reaches. Given `share:<key>`, it also writes a shared
 * entry through `writeShared`.
 */
import {
  defineFlow,
  defineResource,
  dispatcher,
  handler,
  taskDispatchInputSchema,
  type InitialSkill
} from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { createWorkforceClient } from "../src/workers/client";
import { createWorkerHireBlocks } from "../src/workers/hire-blocks";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { defineWorkerRosterFlow } from "../src/workers/roster-flow";
import { sharedResource, writeShared } from "../src/shared-resource";
import { createWorkerLookup } from "../src/worker-lookup";
import { workerConfigSchema } from "../src/worker-config";
import type { WorkerManifest } from "../src/manifest";
import { z } from "zod";

/** The organization a caller is in unless a test names another. */
export const ORG = "acme";

export const FIXTURE = "fixture-worker";
export const OTHER = "other-worker";

/** A document, the shape `resourcesFromDocs` produces: org-scoped, body as content. */
function document(ref: string) {
  return defineResource({
    ref,
    scope: "org",
    stateSchema: z.object({}).passthrough(),
    default: {},
    content: `# ${ref}`,
    llmReadable: true,
    llmWritable: true
  });
}

/** Two documents a worker may be granted. */
export const handbook = document("handbook");
export const ledger = document("ledger");

/** A shared resource every entry of which names who wrote it. */
export const teamNotes = sharedResource("team-notes/*", { text: z.string() });

/** Two standard workers, one per worker flow, the way the loader reads them. */
export function standardWorkers(overrides: { researcherBody?: string } = {}): WorkerManifest[] {
  return [
    {
      id: "researcher",
      declared: { flow: FIXTURE, description: "Finds things out.", tone: "formal" },
      body: overrides.researcherBody ?? "Research carefully.",
      teamInstructions: "We cite sources.",
      skills: [skill("cite")]
    },
    { id: "planner", declared: { flow: OTHER, description: "Plans." }, body: "Plan the week.", skills: [] }
  ];
}

export function skill(name: string): InitialSkill {
  return { name, skillMd: `---\nname: ${name}\ndescription: ${name}\n---\n${name}` };
}

/** What `fixture-worker`'s door answers. */
export type TurnAnswer = {
  worker: string;
  standard: boolean;
  instructions: string | null;
  teamInstructions: string | null;
  tone: string;
  skills: string[];
  handbook: boolean;
  ledger: boolean;
};

export type HostOptions = {
  standard?: WorkerManifest[];
  /** Keep `fixture-worker` for standard workers. */
  standardOnly?: boolean;
  /** The skills a user's own worker may name; omitted, the standard workers'. */
  skills?: InitialSkill[];
};

export type Host = ReturnType<typeof bootHost>;

const doorInput = z.object({ message: z.string() }).strict();

function workerFlow(kind: string, installation: WorkerInstallation) {
  const door = handler({
    name: `${kind}-run`,
    inputSchema: doorInput,
    // The documents stay on the flow: a block that declared one would hand it
    // back to every worker, past any grant.
    resources: { ...installation.resources, teamNotes },
    execute: async (input, ctx): Promise<TurnAnswer> => {
      const worker = await installation.resolveWorker(ctx, kind);
      if (input.message.startsWith("share:")) {
        await writeShared(ctx as never, "teamNotes", input.message.slice("share:".length), { text: input.message });
      }
      const config = worker.config as Record<string, unknown>;
      return {
        worker: worker.id,
        standard: worker.standard,
        instructions: (config.instructions as string | undefined) ?? null,
        teamInstructions: (config.teamInstructions as string | undefined) ?? null,
        tone: String(config.tone),
        skills: ((config.seatSkills as InitialSkill[] | undefined) ?? []).map((s) => s.name),
        handbook: worker.reaches("handbook"),
        ledger: worker.reaches("ledger")
      };
    }
  });
  // A task's turn: runs as the session's worker, like the door.
  const work = handler({
    name: `${kind}-work`,
    resources: { ...installation.resources },
    execute: async (_input, ctx) => {
      const worker = await installation.resolveWorker(ctx, kind);
      return { worker: worker.id };
    }
  });
  return defineFlow({
    kind,
    configSchema: workerConfigSchema().extend({ tone: z.string().default("plain") }),
    session: installation.session(),
    resources: { ...installation.resources, handbook, ledger, teamNotes },
    actions: {
      run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message }
    },
    // The gate lets every task through: what is under test is the child's
    // birth, which happens before any gate runs.
    task: { actions: { work: { block: work, from: { boardId: "board", gate: (entry) => entry } } } }
  });
}

/**
 * A flow that hands a task to `fixture-worker`, naming the task's worker the
 * way a list's fallback does: `createWorkerLookup(...).state`.
 */
function filerFlow() {
  const lookup = createWorkerLookup({ instanceAt: () => undefined, declared: [] });
  return defineFlow({
    kind: "filer",
    actions: {
      send: {
        inputSchema: taskDispatchInputSchema,
        block: dispatcher({
          name: "filer-send",
          type: "task",
          action: "work",
          flowKind: FIXTURE,
          session: "per-task",
          state: lookup.state
        })
      }
    }
  });
}

/** One host of the app over `stores`. */
export function bootHost(stores: StoreRegistry, options: HostOptions = {}) {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: options.standard ?? standardWorkers(),
    workerFlows: () => flows as never,
    documents: { handbook, ledger },
    ...(options.skills !== undefined ? { skills: options.skills } : {})
  });
  const fixture = workerFlow(FIXTURE, installation);
  const other = workerFlow(OTHER, installation);
  flows = {
    [FIXTURE]: options.standardOnly === true ? { flow: fixture, standardOnly: true } : fixture,
    [OTHER]: other
  };

  const blocks = createWorkerHireBlocks(installation);
  const rosterFlow = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: blocks.hire.inputSchema, block: blocks.hire },
    fork: { inputSchema: blocks.fork.inputSchema, block: blocks.fork },
    edit: { inputSchema: blocks.edit.inputSchema, block: blocks.edit },
    fire: { inputSchema: blocks.fire.inputSchema, block: blocks.fire }
  });

  const instances = {
    [FIXTURE]: fixture() as unknown as FlowInstance,
    [OTHER]: other() as unknown as FlowInstance,
    roster: rosterFlow() as unknown as FlowInstance,
    filer: filerFlow()() as unknown as FlowInstance
  };
  const registry = createFlowRegistry();
  for (const instance of Object.values(instances)) registry.register(instance);
  const router = createFlowApiRouter({
    registry,
    stores,
    staleSweepIntervalMs: 0,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: context.request.headers.get("x-org") ?? ORG } : null;
    }
  });

  /** A fetch that hands a request to this host's router as `userId`. */
  const fetcherFor =
    (userId: string, orgId?: string) =>
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), "http://localhost");
      const headers = new Headers(init?.headers);
      headers.set("x-user", userId);
      if (orgId !== undefined) headers.set("x-org", orgId);
      const request = new Request(url, { ...init, headers });
      const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
      const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
      return (router as any)[method](request, { params: { path } });
    };

  const client = (userId: string, orgId?: string) =>
    createWorkforceClient({ userId, fetcher: fetcherFor(userId, orgId) });

  /** POST a session create as `userId`. */
  const create = async (userId: string, flow: string, body: Record<string, unknown>) => {
    const res = await fetcherFor(userId)(`/api/flows/${flow}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, ...body })
    });
    return { status: res.status, body: (await res.json()) as { session?: { id: string }; error?: string } };
  };

  /** One turn on `fixture-worker` (or `flow`) as `userId`, in process. */
  const turn = async (userId: string, sessionId: string, message = "hello", flow: string = FIXTURE, orgId = ORG) => {
    const result = await runAction({
      flow: instances[flow as keyof typeof instances],
      actionName: "run",
      input: { message },
      userId,
      orgId,
      sessionId,
      stores,
      runtimeConfig: {}
    });
    return result as { output?: TurnAnswer; error?: { message?: string } | unknown };
  };

  /** Run a roster action as `userId`, in process, on their roster session. */
  const rosterAction = async (userId: string, action: "hire" | "fork" | "edit" | "fire", input: unknown, orgId = ORG) => {
    const result = await runAction({
      flow: instances.roster,
      actionName: action,
      input,
      userId,
      orgId,
      sessionId: `roster-admin-${userId}-${orgId}`,
      stores,
      runtimeConfig: {}
    });
    return result as { output?: unknown; error?: unknown };
  };

  /** Every request on `sessionId`, once none is still running. */
  const settled = async (sessionId: string) => {
    const deadline = Date.now() + 5_000;
    while ((await stores.request.list({ sessionId })).some((r) => r.status === "in_progress")) {
      if (Date.now() > deadline) throw new Error(`a request on ${sessionId} never finished`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return stores.request.list({ sessionId, withItems: true });
  };

  return { installation, registry, router, instances, client, create, turn, rosterAction, fetcherFor, settled };
}

/** An error's message, whatever shape a run reported it in. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

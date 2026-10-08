/**
 * A host for the project and workstream tests, on the real engine and the
 * real HTTP router: two organizations (`acme`, `beta`), users named by
 * verified headers (`x-user`, `x-org`), never by the body (BP-031).
 *
 * Registered:
 *
 * - `lab`: the app's own flow, with the project blocks and the workstream
 *   blocks as actions, plus whatever test-only actions a test file adds.
 * - `lead` and `quiet`: two fixture worker flows on one worker installation.
 *   A worker on `lead` can lead a workstream; a worker on `quiet` can't.
 * - `roster`: the roster flow, with the hire block, so each user hires their
 *   own workers.
 *
 * Every user's worker is hired through the app, never seeded.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { MAILBOX_KIND, mailboxFlow } from "../src/index";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkerHireBlocks } from "../src/workers/hire-blocks";
import { createWorkerInstallation, type WorkerInstallation } from "../src/workers/installation";
import { defineWorkerRosterFlow } from "../src/workers/roster-flow";

export const ORG = "acme";
export const OTHER_ORG = "beta";

/** What a test file adds to the host: actions on `lab`, and actions on the `lead` flow. */
export type HostExtras = {
  /** The `lab` flow's actions, given the installation. */
  lab: (installation: WorkerInstallation) => Record<string, unknown>;
  /** Extra actions on the `lead` flow, given the installation. */
  lead?: (installation: WorkerInstallation) => Record<string, unknown>;
  /** Extra internal actions on the `lead` flow. */
  leadInternal?: (installation: WorkerInstallation) => Record<string, unknown>;
  /** Whether the room's talk kind is registered. Default true: `createProject` binds a talk session. */
  mailbox?: boolean;
};

const doorInput = z.object({ message: z.string() });

/** A worker flow whose door echoes, with whatever actions the test adds. */
function workerFlow(
  kind: string,
  installation: WorkerInstallation,
  extra: Record<string, unknown> = {},
  internal: Record<string, unknown> = {}
) {
  const door = handler({
    name: `${kind}-run`,
    inputSchema: doorInput,
    resources: { ...installation.resources },
    execute: async (input, ctx) => {
      const worker = await installation.resolveWorker(ctx, kind);
      return `${worker.id} heard: ${input.message}`;
    }
  });
  return defineFlow({
    kind,
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      run: { inputSchema: doorInput, block: door, userMessage: (i: { message: string }) => i.message },
      ...extra
    },
    ...(Object.keys(internal).length === 0 ? {} : { internal: { actions: internal } })
  } as never);
}

/** Boot one host over `stores`. */
export async function bootProjectsHost(extras: HostExtras, options: { stores?: StoreRegistry } = {}) {
  const stores = options.stores ?? inMemoryStores();
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: [], workerFlows: () => flows as never });
  const lead = workerFlow("lead", installation, extras.lead?.(installation), extras.leadInternal?.(installation));
  const quiet = workerFlow("quiet", installation);
  flows = { lead, quiet };

  const hireBlocks = createWorkerHireBlocks(installation);
  const roster = defineWorkerRosterFlow(installation, {
    hire: { inputSchema: hireBlocks.hire.inputSchema, block: hireBlocks.hire },
    fire: { inputSchema: hireBlocks.fire.inputSchema, block: hireBlocks.fire }
  });
  const lab = defineFlow({ kind: "lab", actions: extras.lab(installation) } as never);

  const instances: Record<string, FlowInstance> = {
    lab: lab() as unknown as FlowInstance,
    lead: lead() as unknown as FlowInstance,
    quiet: quiet() as unknown as FlowInstance,
    roster: roster() as unknown as FlowInstance,
    ...(extras.mailbox === false ? {} : { [MAILBOX_KIND]: mailboxFlow() as unknown as FlowInstance })
  };
  const state = createFlowState({
    flows: instances,
    stores: { default: { primary: stores } },
    modelResolver: createMockModelResolver({}),
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org") ?? ORG;
      return typeof user === "string" ? { userId: user, orgId: org } : null;
    }
  } as never);
  const router = (await state.getRouter()) as any;
  const runtime = await state.getRuntime();

  type Answer = { status: number; json: any };
  const call = async (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    user: string,
    path: string[],
    body?: unknown,
    options: { org?: string; query?: string } = {}
  ): Promise<Answer> => {
    const response = await router[method](
      new Request(`http://test/api/flows/${path.join("/")}${options.query ?? ""}`, {
        method,
        headers: { "content-type": "application/json", "x-user": user, "x-org": options.org ?? ORG },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
      { params: { path } }
    );
    const text = await response.text();
    let json: unknown;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: response.status, json };
  };

  /** Create a session of `flow` as `user`, with `initial` state. Throws on a refusal. */
  const openSession = async (user: string, flow: string, initial?: unknown, org = ORG): Promise<string> => {
    const created = await tryOpenSession(user, flow, initial, org);
    if (created.status >= 400) throw new Error(`createSession ${created.status}: ${JSON.stringify(created.json)}`);
    return created.json.session.id;
  };
  const tryOpenSession = (user: string, flow: string, initial?: unknown, org = ORG) =>
    call("POST", user, [flow, "sessions"], { userId: user, ...(initial === undefined ? {} : { state: initial }) }, { org });

  /** Run an action and wait for it to settle: its status, output and error. */
  const act = async (user: string, flow: string, sessionId: string, action: string, input: unknown, org = ORG) => {
    const answer = await call("POST", user, [flow, sessionId, "actions", action], { userId: user, input }, { org });
    const requestId = answer.json?.request?.id;
    if (requestId === undefined) return { http: answer.status, settled: undefined, output: undefined, error: answer.json };
    for (let i = 0; i < 2000; i += 1) {
      const polled = await call("GET", user, [flow, "requests", requestId, "status"], undefined, { org });
      if (["completed", "errored", "failed", "cancelled"].includes(polled.json?.status)) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const { json } = await call("GET", user, ["sessions", sessionId, "requests"], undefined, {
      org,
      query: "?include_result_output=true"
    });
    const found = ((json?.requests ?? []) as Array<Record<string, any>>).find((r) => r.id === requestId) ?? {};
    return { http: answer.status, settled: found.status as string, output: found.result?.output, error: found.result?.error };
  };

  /** The output of an action that must complete. */
  const ok = async (user: string, flow: string, sessionId: string, action: string, input: unknown, org = ORG) => {
    const result = await act(user, flow, sessionId, action, input, org);
    if (result.settled !== "completed") {
      throw new Error(`${action} as ${user}: ${result.settled} ${JSON.stringify(result.error)}`);
    }
    return result.output;
  };

  /** The browser's list of a collection, through the resource route: each item's storage key and client data. */
  const listed = async (user: string, sessionId: string, ref: string, org = ORG) => {
    const answer = await call("GET", user, ["sessions", sessionId, "resources", ref], undefined, { org });
    if (answer.status !== 200) throw new Error(`list ${ref} as ${user}: ${answer.status} ${JSON.stringify(answer.json)}`);
    return (answer.json.items as Array<{ storageKey: string; clientData?: Record<string, unknown> }>).map((item) => ({
      key: item.storageKey,
      data: item.clientData ?? {}
    }));
  };

  /** Hire a worker on `flow` onto `user`'s roster, through the roster flow. */
  const hire = async (user: string, id: string, flow: string, org = ORG) => {
    const rosterSession = await openSession(user, "roster", undefined, org);
    return ok(user, "roster", rosterSession, "hire", { id, flow, description: `${user}'s ${id}` }, org);
  };

  /** A session record as stored. */
  const sessionRecord = (sessionId: string) => runtime.stores.session.get(sessionId);

  return { stores, runtime, installation, call, openSession, tryOpenSession, act, ok, listed, hire, sessionRecord };
}

export type ProjectsHost = Awaited<ReturnType<typeof bootProjectsHost>>;

/** A refusal's text, for matching its reason. */
export const refusal = (result: { settled?: string; error?: unknown }) => JSON.stringify(result.error ?? "");

/** An action entry for a block. */
export const action = (block: BlockDefinition<any, any>) => ({ block });

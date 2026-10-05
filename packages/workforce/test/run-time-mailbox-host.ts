/**
 * One host for the run-time mailbox tests: the mailbox kinds a roster builds,
 * any extra flows a case needs, the file mailboxes opened, and the doors a
 * case drives them through.
 *
 * Every door goes through a registered flow and a real `runAction`, never a
 * block called by hand, so a refusal or a write is the one an app would get.
 * Pass a second adapter over the same file as `stores` to restart on the same store.
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreAdapter, StoreRegistry } from "@flow-state-dev/engine";
import {
  MAILBOX_KIND,
  mailboxInstances,
  openMailboxes,
  type MailboxInstancesOptions,
  type MailboxManifest
} from "../src/index";

export const USER_ID = "u_runtime";
export const ORG_ID = DEFAULT_ORG_ID;

/** `openMailboxes`'s session API over one store, as the session route behaves. */
export function sessionApi(stores: StoreRegistry) {
  return {
    createSession: async (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }): Promise<unknown> => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: DEFAULT_ORG_ID,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: [],
          // Top-level, where the session route writes it and `ctx.session.metadata` reads it.
          ...(options.description === undefined ? {} : { description: options.description })
        } as never,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = (await stores.session.get(sessionId)) as Record<string, any> | undefined;
      if (found === undefined) throw Object.assign(new Error(`no session "${sessionId}"`), { status: 404 });
      return {
        flowKind: String(found.flowKind),
        flowId: found.flowId,
        userId: String(found.userId),
        state: found.state
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
}

export interface HostOptions extends MailboxInstancesOptions {
  /** The storage adapter; one over a durable file lets a second host read what the first wrote. */
  stores?: StoreAdapter;
  /** Flows registered beside the mailbox kinds, by id. */
  flows?: Record<string, FlowInstance>;
  /** The file mailboxes opened at boot. Defaults to the whole roster. */
  open?: MailboxManifest[];
  /** The model resolver the host's generators run on; a scripted one keeps a case keyless. */
  modelResolver?: unknown;
}

/** One request's action door: what `openInventory` and the run-time opener take as `run`. */
export interface RunRequest {
  action: string;
  input: unknown;
  userId: string;
  orgId: string;
  flowKind: string;
  sessionId: string;
  source?: string;
}

export async function host(roster: MailboxManifest[], options: HostOptions = {}) {
  const { stores: given, flows: extra, open, modelResolver, ...instanceOptions } = options;
  const instances = mailboxInstances(roster, instanceOptions);
  const byKind: Record<string, FlowInstance> = Object.fromEntries(instances.map((i) => [i.kind, i]));
  const state = createFlowState({
    flows: { ...byKind, ...(extra ?? {}) },
    stores: { default: { primary: given ?? inMemoryStores() } },
    ...(modelResolver === undefined ? {} : { modelResolver })
  } as never);
  const runtime = await state.getRuntime();
  const client = sessionApi(runtime.stores);
  await openMailboxes(open ?? roster, { client, userId: USER_ID });

  /** Rejects on a failed run, as the `run` contract requires. */
  const run = async (request: RunRequest): Promise<unknown> => {
    const flow = byKind[request.flowKind] ?? extra?.[request.flowKind];
    if (flow === undefined) throw new Error(`no flow registered under kind "${request.flowKind}"`);
    const result: any = await runAction({
      flow,
      actionName: request.action,
      input: request.input,
      userId: request.userId,
      orgId: request.orgId,
      sessionId: request.sessionId,
      ...(request.source === undefined ? {} : { source: request.source }),
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never);
    if (result?.error !== undefined) {
      throw result.error instanceof Error ? result.error : new Error(JSON.stringify(result.error));
    }
    return result.output;
  };

  /** One mailbox action as a client calls it: `{ output }` or `{ error }`, never a throw. */
  const act = async (sessionId: string, action: string, input: unknown, flowId: string = MAILBOX_KIND) => {
    try {
      return { output: await run({ action, input, userId: USER_ID, orgId: ORG_ID, flowKind: flowId, sessionId, source: "http" }) };
    } catch (error) {
      return { error };
    }
  };

  return {
    runtime,
    stores: runtime.stores,
    client,
    run,
    act,
    /** Open a session at `id` holding exactly `state`, as a store written before or after this change would. */
    seed: (id: string, state: Record<string, unknown>) =>
      client.createSession({ flowKind: MAILBOX_KIND, userId: USER_ID, sessionId: id, state }),
    /** A mailbox session's stored state. */
    stateOf: async (id: string) => ((await runtime.stores.session.get(id)) as { state: Record<string, unknown> } | undefined)?.state,
    /** One org-scoped row, straight out of storage. */
    row: async (key: string) =>
      (await runtime.stores.resourceState.get("org", ORG_ID, key))?.state as Record<string, unknown> | undefined,
    /** Every org-scoped key under a prefix, straight out of storage. */
    keys: async (prefix: string) =>
      Object.keys(await runtime.stores.resourceState.getByPrefix("org", ORG_ID, prefix)).sort(),
    dispose: () => state.dispose()
  };
}

/**
 * Run a flow's read (FIX-2286): a block an app runs on a session to watch a
 * view the flow computes, answered to the caller and stored nowhere.
 *
 * A read runs through the same context an action does, so it sees the
 * session, its resources and its user exactly as an action would, under the
 * same binding checks. What differs is the stores it is handed
 * ({@link readOnlyStores}): its own request record, items, traces and
 * checkpoints live in memory for the run and are dropped, and every other
 * write throws `read_only`. So "nothing stored" holds by construction, not by
 * each read's care, and a read can't take a concurrency slot, register as an
 * active request, or start a request of its own.
 */
import type { FlowInstance, ReadConfig } from "@flow-state-dev/core/types";
import { createExecutionContext } from "../context/createExecutionContext";
import { FlowError, ValidationError } from "../errors/flow-error";
import type { RuntimeConfig } from "../runtime-config";
import { createInMemoryStores } from "../stores";
import type { StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";
import { executeBlock } from "./executeBlock";
import { requestEndRegistryOf } from "./request-end-hooks";

/** What {@link runRead} needs: the flow, the read, the caller and the session. */
export type RunReadOptions = {
  flow: FlowInstance;
  readName: string;
  input: unknown;
  userId: string;
  orgId: string;
  sessionId: string;
  tenantId?: string;
  stores: StoreRegistry;
  runtimeConfig?: Pick<RuntimeConfig, "modelResolver" | "settings" | "logger" | "tracingLevel">;
  signal?: AbortSignal;
};

/** A read the flow doesn't declare. */
export class UnknownReadError extends Error {
  constructor(readonly flowId: string, readonly readName: string) {
    super(`Flow "${flowId}" has no read "${readName}"`);
    this.name = "UnknownReadError";
  }
}

/** The refusal every write inside a read throws. */
export function readOnlyRefusal(what: string): FlowError {
  return new FlowError(`A read can't ${what}: it changes nothing`, { code: "read_only", retryable: false });
}

/**
 * Store methods that only read. Every other method on a wrapped store is a
 * write, and refuses: a store method added later is refused until it is
 * named here, which fails closed.
 */
const READ_VERBS = new Set([
  "get",
  "list",
  "getAll",
  "getByPrefix",
  "countItems",
  "isAbortRequested",
  "getEvents",
  "subscribeToEvents",
  "getRunOnceResult",
  "latest",
  "listRequestIds",
  "listStale",
  "listAll",
  "listDue",
  "earliestDueAt"
]);

/** `store` with its reads passed through and every write refused. */
function refusingWrites<T extends object>(name: string, store: T): T {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      if (READ_VERBS.has(prop)) return value.bind(target);
      return () => {
        throw readOnlyRefusal(`write to the ${name} store (${prop})`);
      };
    }
  });
}

/**
 * `store`, with every call that names `requestId` as its first argument sent
 * to `own` (the read's own, in-memory record), reads of other ids passed
 * through, and writes to other ids refused.
 */
function ownRequestOnly<T extends object>(name: string, store: T, own: T, requestId: string): T {
  const refusing = refusingWrites(name, store);
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      const ownValue = Reflect.get(own, prop) as unknown;
      return (...args: unknown[]) => {
        if (args[0] === requestId && typeof ownValue === "function") return ownValue.apply(own, args);
        return (Reflect.get(refusing, prop) as (...a: unknown[]) => unknown)(...args);
      };
    }
  });
}

/**
 * `store` (a user or org store), where the first run's seed of a record the
 * store doesn't hold yet lands in `scratch` and is read back from there.
 * Session creation stores neither record, so a read on a session no action
 * has run in must seed them to run at all; the seed is dropped with the read.
 * Every other write, including one to a seeded record, refuses.
 */
function seedingInScratch<T extends { get(id: string): Promise<unknown>; set(id: string, ...rest: never[]): Promise<unknown> }>(
  name: string,
  store: T,
  scratch: T
): T {
  const refusing = refusingWrites(name, store);
  return new Proxy(refusing, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return async (id: string) => (await scratch.get(id)) ?? store.get(id);
      }
      if (prop === "set") {
        return async (id: string, ...rest: never[]) => {
          if ((await scratch.get(id)) !== undefined || (await store.get(id)) !== undefined) {
            throw readOnlyRefusal(`write to the ${name} store (set)`);
          }
          return scratch.set(id, ...rest);
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  });
}

/**
 * The stores a read runs on: `stores` for every read, and nowhere to write.
 * The read's own request record, its items and events, its traces, its
 * checkpoints, the active-request registry, and the first seed of a user or
 * org record go to a fresh in-memory registry dropped when the read ends; any
 * other write throws `read_only`.
 */
export function readOnlyStores(stores: StoreRegistry, requestId: string): StoreRegistry {
  const scratch = createInMemoryStores();
  return {
    ...stores,
    session: refusingWrites("session", stores.session),
    request: ownRequestOnly("request", stores.request, scratch.request, requestId),
    user: seedingInScratch("user", stores.user, scratch.user),
    org: seedingInScratch("org", stores.org, scratch.org),
    activeRequests: scratch.activeRequests,
    content: refusingWrites("content", stores.content),
    resourceState: refusingWrites("resource state", stores.resourceState),
    checkpoints: scratch.checkpoints,
    traces: scratch.traces,
    suspensions: refusingWrites("suspension", stores.suspensions),
    leases: refusingWrites("lease", stores.leases),
    ...(stores.wakes !== undefined ? { wakes: refusingWrites("wake", stores.wakes) } : {})
  };
}

/** Parse the read's input against its schema, as an action's is. */
function parseReadInput(read: ReadConfig, input: unknown): unknown {
  const schema = read.inputSchema ?? read.block.inputSchema;
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path?.join(".") ?? "";
  throw new ValidationError(
    `Read input validation failed${path.length > 0 ? ` at "${path}"` : ""}: ${issue?.message ?? "schema validation failed"}`,
    { scope: "request" }
  );
}

/**
 * Run read `readName` of `flow` on `sessionId` for its caller and return the
 * block's output. Throws what the block threw, `read_only` for any write it
 * tried, and the action path's binding errors for a session the caller may
 * not run in. Nothing it does reaches `stores`.
 */
export async function runRead(options: RunReadOptions): Promise<unknown> {
  const read = Object.hasOwn(options.flow.reads ?? {}, options.readName)
    ? options.flow.reads![options.readName]!
    : undefined;
  if (read === undefined) throw new UnknownReadError(options.flow.id, options.readName);
  const input = parseReadInput(read, options.input);

  const requestId = generateId("read");
  const ctx = await createExecutionContext({
    flow: options.flow,
    actionName: options.readName,
    requestId,
    userId: options.userId,
    sessionId: options.sessionId,
    orgId: options.orgId,
    tenantId: options.tenantId,
    source: "read",
    input,
    signal: options.signal,
    stores: readOnlyStores(options.stores, requestId),
    modelResolver: options.runtimeConfig?.modelResolver,
    settings: options.runtimeConfig?.settings,
    logger: options.runtimeConfig?.logger,
    tracingLevel: options.runtimeConfig?.tracingLevel,
    durabilityEnabled: false,
    // A dispatch into an existing session reaches this operation; one into a
    // child is refused earlier, at the child session's write.
    requestHost: {
      dispatchOperation: () => {
        throw readOnlyRefusal("start a request");
      }
    }
  });

  const logger = options.runtimeConfig?.logger;
  let result: Awaited<ReturnType<typeof executeBlock>> | undefined;
  try {
    result = await executeBlock({ block: read.block, input, ctx, metadata: { scope: "request" }, logger });
  } finally {
    // A read ends like any request: the hooks its block added run now, and
    // a host's shutdown stops waiting on it.
    const error = result === undefined ? new Error("the read threw") : result.error;
    await requestEndRegistryOf(ctx)?.run(
      error === undefined
        ? { status: "completed" }
        : { status: "failed", error: { message: error instanceof Error ? error.message : String(error) } },
      { requestId, logger }
    );
  }
  if (result.error !== undefined) throw result.error;
  return result.output;
}

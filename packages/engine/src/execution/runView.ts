// FIX-2623.
/**
 * The view runner: the one place a view runs, answered to its caller and
 * stored nowhere. Every view runs through {@link runView}, and a flow's
 * `reads` too until they are removed (`runRead.ts`), so "a view writes
 * nothing, calls no model, and every read it makes is recorded" holds by
 * construction, not by each view's care.
 *
 * - **Writes.** The run gets {@link readOnlyStores}: its own request record,
 *   items, traces and checkpoints live in memory for the run and are dropped,
 *   and every other write throws `read_only`. It can't take a concurrency
 *   slot, register as an active request, or start a request of its own.
 * - **Scope.** A session view runs on a session that exists, under the action
 *   path's binding checks. A user or org view runs with no session at all
 *   (`noSession`): none is loaded, made or stored, and its request record
 *   names none.
 * - **Model calls** refuse with `ViewModelCallError` (D2).
 * - **Reads** are recorded where the engine builds each block's context
 *   (`view-reads.ts`), child blocks included, and the answer carries the
 *   topics they fall under.
 *
 * A view ends like a read: its side chains drain and request-end hooks run.
 */
import type { BlockDefinition, FlowInstance, ViewDefinition, ViewScope, WireTopic } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import { createExecutionContext } from "../context/createExecutionContext";
import { NoSessionError } from "../context/no-session";
import { createReadRecorder, UnrecordedReadError, ViewModelCallError, type RecordedRead } from "../context/view-reads";
import { FlowError, ValidationError } from "../errors/flow-error";
import type { RuntimeConfig } from "../runtime-config";
import { createInMemoryStores } from "../stores";
import type { StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";
import { executeBlock } from "./executeBlock";
import { requestEndRegistryOf } from "./request-end-hooks";
import { drainRequestSideChainPool } from "./runAction";

/** What {@link runView} needs: the flow, the view, the caller, and the session for a session view. */
export type RunViewOptions = {
  flow: FlowInstance;
  viewName: string;
  input: unknown;
  userId: string;
  orgId: string;
  /** Required for a session view; refused for a user or org view. */
  sessionId?: string;
  tenantId?: string;
  stores: StoreRegistry;
  runtimeConfig?: Pick<RuntimeConfig, "settings" | "logger" | "tracingLevel">;
  signal?: AbortSignal;
};

/** A view's answer: its block's output, and the topics a change to what it read publishes on. */
export type ViewAnswer = {
  output: unknown;
  topics: WireTopic[];
  /** Every distinct read the run made, by scope and accessor. Not on the wire: for diagnostics and tests. */
  reads: readonly RecordedRead[];
};

/** A view the flow doesn't declare. */
export class UnknownViewError extends Error {
  constructor(readonly flowId: string, readonly viewName: string) {
    super(`Flow "${flowId}" has no view "${viewName}"`);
    this.name = "UnknownViewError";
  }
}

/** The refusal every write inside a view or read throws. */
function readOnlyRefusal(what: string): FlowError {
  return new FlowError(`A view can't ${what}: it changes nothing`, { code: "read_only", retryable: false });
}

/**
 * Store methods that only read. Every other method on a wrapped store is a
 * write, and refuses: a store method added later is refused until it is
 * named here, which fails closed.
 *
 * Maintenance: when a store gains a read method a view or read needs, add it
 * here. Until then it is refused as a write (`read_only`).
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
 * to `own` (the run's own, in-memory record), reads of other ids passed
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
 * Session creation stores neither record, and a user who never ran an action
 * has none, so a run must seed them to run at all; the seed is dropped with
 * the run. Every other write, including one to a seeded record, refuses.
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
 * The stores a view runs on: `stores` for every read, and nowhere to write.
 * The run's own request record, its items and events, its traces, its
 * checkpoints, the active-request registry, and the first seed of a user or
 * org record go to a fresh in-memory registry dropped when the run ends; any
 * other write throws `read_only`.
 */
function readOnlyStores(stores: StoreRegistry, requestId: string): StoreRegistry {
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

/** Parse `input` against the view's input schema, as an action's is. */
function parseInput(what: string, schema: ZodTypeAny, input: unknown): unknown {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const path = issue?.path?.join(".") ?? "";
  throw new ValidationError(
    `${what} input validation failed${path.length > 0 ? ` at "${path}"` : ""}: ${issue?.message ?? "schema validation failed"}`,
    { scope: "request" }
  );
}

/** A keyed view's answer must be a list whose rows have distinct string keys. */
function checkKeyedAnswer(viewName: string, key: (entry: never) => string, output: unknown): void {
  if (!Array.isArray(output)) {
    throw new FlowError(`View "${viewName}" declares a \`key\`, so its answer must be a list`, {
      code: "view_answer_not_keyed",
      retryable: false
    });
  }
  const seen = new Set<string>();
  for (const entry of output) {
    const id = key(entry as never);
    if (typeof id !== "string" || seen.has(id)) {
      throw new FlowError(
        `View "${viewName}"'s rows must have distinct string keys; ${typeof id === "string" ? `"${id}" repeats` : "a key is not a string"}`,
        { code: "view_answer_not_keyed", retryable: false }
      );
    }
    seen.add(id);
  }
}

/** What one read-only run needs. Shared by {@link runView} and `runRead`. */
export type ReadOnlyRun = {
  flow: FlowInstance;
  /** The view's or read's name, recorded as the run's action name. */
  name: string;
  block: BlockDefinition;
  input: unknown;
  scope: ViewScope;
  userId: string;
  orgId: string;
  sessionId?: string;
  tenantId?: string;
  stores: StoreRegistry;
  runtimeConfig?: Pick<RuntimeConfig, "settings" | "logger" | "tracingLevel">;
  signal?: AbortSignal;
  /** The run's source label. */
  source: "view" | "read";
};

/**
 * Run `block` read-only, with its reads recorded and its model calls
 * refused, and return its output and the topics of what it read. Throws what
 * the block threw, `read_only` for any write it tried, `ViewModelCallError`
 * for a model call, `NoSessionError` for a user or org view that reached for
 * a session, and the action path's binding errors for a session the caller
 * may not run in. Nothing it does reaches `stores`.
 */
export async function runReadOnly(run: ReadOnlyRun): Promise<ViewAnswer> {
  const noSession = run.scope !== "session";
  if (noSession && run.sessionId !== undefined) {
    throw new Error(`A ${run.scope} view runs with no session; "${run.name}" was handed one`);
  }
  if (!noSession && run.sessionId === undefined) {
    throw new Error(`A session view runs on a session; "${run.name}" was handed none`);
  }
  const requestId = generateId(run.source);
  const recorder = createReadRecorder();
  const ctx = await createExecutionContext({
    flow: run.flow,
    actionName: run.name,
    requestId,
    userId: run.userId,
    ...(noSession ? { noSession: true } : { sessionId: run.sessionId }),
    orgId: run.orgId,
    tenantId: run.tenantId,
    source: run.source,
    input: run.input,
    signal: run.signal,
    stores: readOnlyStores(run.stores, requestId),
    recordRead: (read) => recorder.record(read),
    refuseModelCalls: true,
    settings: run.runtimeConfig?.settings,
    logger: run.runtimeConfig?.logger,
    tracingLevel: run.runtimeConfig?.tracingLevel,
    durabilityEnabled: false,
    // A dispatch into an existing session reaches this operation; one into a
    // child is refused earlier, at the child session's write.
    requestHost: {
      dispatchOperation: () => {
        throw readOnlyRefusal("start a request");
      }
    }
  });

  const logger = run.runtimeConfig?.logger;
  let result: Awaited<ReturnType<typeof executeBlock>> | undefined;
  try {
    result = await executeBlock({ block: run.block, input: run.input, ctx, metadata: { scope: "request" }, logger });
  } finally {
    // A view ends like any request: its `.sideChain()` work settles, then the
    // hooks its blocks added run, and a host's shutdown stops waiting on it.
    await drainRequestSideChainPool(ctx);
    const error = result === undefined ? new Error(`the ${run.source} threw`) : result.error;
    await requestEndRegistryOf(ctx)?.run(
      error === undefined
        ? { status: "completed" }
        : { status: "failed", error: { message: error instanceof Error ? error.message : String(error) } },
      { requestId, logger }
    );
  }
  if (result.error !== undefined) throw viewRefusalIn(result.error) ?? result.error;
  return { output: result.output, topics: recorder.topics(), reads: recorder.reads() };
}

/**
 * The view refusal a block's failure wraps, if any. The block executor wraps
 * what a block throws; a model call or a reach for a session is the view's
 * own mistake, so it surfaces by its own name.
 */
function viewRefusalIn(error: unknown): ViewModelCallError | NoSessionError | UnrecordedReadError | undefined {
  for (let cause: unknown = error, depth = 0; cause instanceof Error && depth < 8; cause = cause.cause, depth += 1) {
    if (cause instanceof ViewModelCallError || cause instanceof NoSessionError || cause instanceof UnrecordedReadError) return cause;
  }
  return undefined;
}

/**
 * Run view `viewName` of `flow` for its caller: on `sessionId` for a session
 * view, with no session for a user or org view. Returns the output and the
 * topics a watcher listens to. See the file header for what it refuses.
 */
export async function runView(options: RunViewOptions): Promise<ViewAnswer> {
  const view: ViewDefinition | undefined = Object.hasOwn(options.flow.views ?? {}, options.viewName)
    ? options.flow.views![options.viewName]!
    : undefined;
  if (view === undefined) throw new UnknownViewError(options.flow.id, options.viewName);
  const input = parseInput("View", view.inputSchema ?? view.block.inputSchema, options.input);
  const answer = await runReadOnly({
    flow: options.flow,
    name: options.viewName,
    block: view.block,
    input,
    scope: view.scope,
    userId: options.userId,
    orgId: options.orgId,
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    stores: options.stores,
    ...(options.runtimeConfig !== undefined ? { runtimeConfig: options.runtimeConfig } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    source: "view"
  });
  if (view.key !== undefined) checkKeyedAnswer(options.viewName, view.key, answer.output);
  return answer;
}

/** Parse a read's input against its schema. Kept for `runRead` until reads are removed. */
export function parseReadInput(schema: ZodTypeAny, input: unknown): unknown {
  return parseInput("Read", schema, input);
}

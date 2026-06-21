import { AsyncLocalStorage } from "node:async_hooks";
import type {
  AnyResourceRef,
  JournalEntry,
  JournalEntryInput,
  JsonObject,
  LLMMessage,
  OrgScopeHandle,
  RequestScopeHandle,
  ResourceConfig,
  ResourceRef,
  ResourceRegistry,
  ResourceCollectionConfig,
  SessionItem,
  SessionItemViews,
  SessionMetadataInput,
  SessionScopeHandle,
  UserScopeHandle,
  TokenCounter
} from "@flow-state-dev/core/types";
import {
  getPatternPrefix,
} from "@flow-state-dev/core/types";
import type {
  ItemVisibility,
  BlockTraceItem,
  ComponentItem,
  ContainerItem,
  Content,
  ItemProvenance,
  MessageItem,
  OutputItem,
  ResourceLoadRecord,
  RouterDecisionItem,
  StateSnapshotItem,
  StatusItem
} from "@flow-state-dev/core/items";
import type { BlockValueInternal } from "@flow-state-dev/core/items/internal";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";
import type { BlockContext, BlockOutputHint, BlockResult, ExecutionParent, StateRef } from "@flow-state-dev/core/types";
import { createScopeStateOps, createStateContainer } from "../stores/state-container";
import { createScopePersist } from "../stores/scope-persist";
import type { TraceStore } from "../stores/types";
import type {
  ContentScopeType,
  OrgRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "../stores/types";
import { createModelResolver } from "@flow-state-dev/core/models";
import type { ModelResolver } from "@flow-state-dev/core";
import { logRuntimeEvent, summarizeForLog } from "../execution/logging";
import { createRequestWorkPool } from "../execution/request-work-pool";
import { resolveActionCore } from "../execution/resolve-action-core";
import { isTraceObservabilityEnabled, errorDetailsWithCause } from "@flow-state-dev/core";
import type { TracingLevel } from "@flow-state-dev/core";
import { deepEqual, getTransientKeys } from "@flow-state-dev/core/helpers";
import { AmbiguousBlockNameError } from "../errors/flow-error";
import { normalizeError, displayCause } from "../errors/normalize-error";
import {
  safeCaptureError,
  toErrorCaptureEvent,
  type ErrorCaptureBlockInfo,
  type ErrorCaptureIdentity
} from "../errors/error-capture";
import { SuspensionError, SuspensionRejectedError } from "@flow-state-dev/core";
import type { ResumeContext } from "@flow-state-dev/core/types";
import { generateId } from "../utils/generate-id";
import {
  resolveUserStorageKey,
  resolveOrgStorageKey,
  resolveResourceIsolation,
  resolveResourceScopeId,
  resolveSessionStorageKey,
  tenantMatches
} from "../stores/scope-keys";
import { resourceStorageKeys } from "../resources/storage-keys";
import type { CreateExecutionContextOptions, ExecutionContext } from "./types";
import { createInitialRequestRecord } from "./initial-request-record";
import {
  OrgBindingMismatchError,
  TenantBindingMismatchError,
  UserBindingMismatchError
} from "./binding-errors";
import {
  outputItemToSessionItem,
  createSessionItemViews,
  buildJournalEntry,
} from "./history";
import { shouldPersistScopeChange, wrapStateOpsWithEmit } from "./scope-emit";
import {
  createScopeResourceRegistry,
  normalizeScopeResources,
  normalizeScopeResourceContent,
  resolveStringContentTemplates,
  loadDeclaredScopeContent,
  loadDeclaredResourceState,
  filterFlowLevelEager,
  isCollectionConfig,
  normalizeStateDefault,
  type LazyLoadOutcome,
  type ScopeLazyLoad,
  type ResourceChangeDelta,
} from "./resource-registry";
import { createReactiveDispatcher, createCascadeController } from "./reactive-dispatch";


function ensureJournalDefaults(record: SessionRecord): void {
  if (!Array.isArray(record.journal)) {
    record.journal = [];
  }
}

function defineStateProperty<THandle extends object, TState extends object>(
  handle: THandle,
  readState: () => Readonly<TState>
): THandle & { readonly state: Readonly<TState> } {
  return Object.defineProperty(handle, "state", {
    enumerable: true,
    get: readState
  }) as THandle & { readonly state: Readonly<TState> };
}

/**
 * Set of item types that enter LLM context.
 * `tool_output` is the dedicated tool-result type.
 */
type EmissionContext = {
  requestId: string;
  response: {
    emitItemAdded(item: OutputItem | BlockTraceItem | RouterDecisionItem | StateSnapshotItem): Promise<unknown>;
    emitItemDone(item: OutputItem | BlockTraceItem | RouterDecisionItem | StateSnapshotItem): Promise<unknown>;
    emitItemUpdated?(itemId: string, patch: Record<string, unknown>): Promise<unknown>;
    emitItemOneShot?(item: OutputItem | BlockTraceItem | RouterDecisionItem | StateSnapshotItem): Promise<unknown>;
    emitContentAdded?(itemId: string, contentIndex: number, content: Content): Promise<unknown>;
    emitContentDelta?(itemId: string, contentIndex: number, delta: string): Promise<unknown>;
    emitContentDone?(itemId: string, contentIndex: number, content: Content): Promise<unknown>;
    getSequenceNumber?(): number;
  };
  provenance: () => ItemProvenance;
  nextItemIndex: () => number;
  /** Container ownership tag — set when emitting inside a container scope. */
  ownedBy?: string;
  /**
   * Task attribution (FIX-658) — id of the task this scope is running, inherited
   * from the nearest enclosing scope marked via `ctx._markTaskScope`. Stamped
   * onto every item this scope emits.
   */
  taskId?: string;
  /**
   * Agent identity that scope-emitted items inherit. Set by the owning
   * generator; undefined at the root (runtime-level emissions carry no
   * identity). Callers may override per-emission via options.
   */
  itemVisibility?: ItemVisibility;
  agentName?: string;
};

function createEmitMessage(
  emCtx: EmissionContext
): {
  (text: string, options?: { itemVisibility?: ItemVisibility; agentName?: string; transient?: boolean }): void;
  (content: Content[], options?: { itemVisibility?: ItemVisibility; agentName?: string; transient?: boolean }): void;
} {
  return function emitMessage(
    textOrContent: string | Content[],
    options?: { itemVisibility?: ItemVisibility; agentName?: string; transient?: boolean }
  ): void {
    const content: Content[] =
      typeof textOrContent === "string"
        ? [{ type: "output_text", text: textOrContent }]
        : textOrContent;

    const itemIndex = emCtx.nextItemIndex();
    const item: MessageItem = {
      id: `item_message_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "message",
      status: "completed",
      transient: options?.transient === true ? true : undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      taskId: emCtx.taskId,
      itemVisibility: options?.itemVisibility ?? emCtx.itemVisibility,
      agentName: options?.agentName ?? emCtx.agentName,
      role: "assistant",
      content
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

function createEmitComponent(
  emCtx: EmissionContext
): (
  component: string,
  data: Record<string, unknown>,
  options?: {
    key?: string;
    itemVisibility?: ItemVisibility;
    agentName?: string;
    transient?: boolean;
  },
) => void {
  return function emitComponent(
    component: string,
    data: Record<string, unknown>,
    options?: {
      key?: string;
      itemVisibility?: ItemVisibility;
      agentName?: string;
      transient?: boolean;
    },
  ): void {
    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: explicit emit calls are user-facing content, not bookkeeping.
    // Default non-transient; the block's `transient` flag governs only the
    // auto-emitted block_trace item. Per-call
    // `{ transient: true }` is the explicit opt-in (e.g. live-only progress
    // with dedup).
    // FIX-491: when a `key` is supplied, derive a deterministic item ID from
    // the key so subsequent emissions upsert in place — `itemsById` collapses
    // to one entry per `(requestId, key)`. The SSE event log still appends
    // an `item.added` + `item.done` event per emission; clients reconcile by
    // item ID and overwrite. `data` is replaced wholesale, never merged.
    const item: ComponentItem = {
      id:
        options?.key !== undefined
          ? `item_component_keyed:${options.key}`
          : `item_component_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "component",
      status: "completed",
      transient: options?.transient === true ? true : undefined,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      taskId: emCtx.taskId,
      itemVisibility: options?.itemVisibility ?? emCtx.itemVisibility,
      agentName: options?.agentName ?? emCtx.agentName,
      component,
      data,
      ...(options?.key !== undefined ? { key: options.key } : {}),
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

/**
 * Request-scoped status slot. Shared across every `createEmitStatus` call
 * within a single request so nested scopes see the same "current message"
 * value — implements the single-slot semantics from FIX-387.
 */
type StatusSlot = { message: string };

function createEmitStatus(
  emCtx: EmissionContext,
  slot: StatusSlot
): (message: string | undefined, options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }) => void {
  return function emitStatus(
    message: string | undefined,
    options?: { blocked?: boolean; backgroundTasks?: number; transient?: boolean }
  ): void {
    if (message !== undefined) {
      // Dedupe: skip when the proposed message matches the slot. `undefined`
      // callers fall through — they update signals only and always emit.
      if (message === slot.message) {
        return;
      }
      slot.message = message;
    }

    const itemIndex = emCtx.nextItemIndex();
    // FIX-478: status defaults to transient (live-only; statuses are
    // naturally ephemeral). Per-call `{ transient: false }` opts out for
    // symmetry with emitMessage / emitComponent. `false` produces a
    // persisted item; `undefined` keeps the field absent.
    const item: StatusItem = {
      id: `item_status_${itemIndex}_${Math.random().toString(16).slice(2)}`,
      type: "status",
      status: "completed",
      transient: options?.transient === false ? undefined : true,
      requestId: emCtx.requestId,
      itemIndex,
      provenance: emCtx.provenance(),
      ts: Date.now(),
      ownedBy: emCtx.ownedBy,
      taskId: emCtx.taskId,
      message: slot.message,
      blocked: options?.blocked,
      backgroundTasks: options?.backgroundTasks
    };

    void emCtx.response.emitItemAdded(item);
    void emCtx.response.emitItemDone(item);
  };
}

/**
 * Module-level set of deprecated alias names already warned for, debouncing
 * `console.warn` to once per process per name. The flat `ctx.emitMessage`
 * etc. methods route through this so the noise stays bounded across long
 * sessions while still nudging users toward `ctx.emit.*`.
 */
const DEPRECATED_ALIAS_WARNED = new Set<string>();

/**
 * Wraps an emission function so the first invocation per process logs a
 * single deprecation warning. The wrapper preserves the underlying
 * function's call signature exactly.
 */
function createDeprecatedAlias<TFn extends (...args: any[]) => any>(
  name: string,
  fn: TFn
): TFn {
  return function deprecatedAlias(...args: Parameters<TFn>): ReturnType<TFn> {
    if (!DEPRECATED_ALIAS_WARNED.has(name)) {
      DEPRECATED_ALIAS_WARNED.add(name);
      // eslint-disable-next-line no-console
      console.warn(
        `[flow-state-dev] ctx.${name}(...) is deprecated. Use ctx.emit.${
          name.replace(/^emit/, "").charAt(0).toLowerCase() +
          name.replace(/^emit/, "").slice(1)
        }(...) instead. Removed in next major.`
      );
    }
    return fn(...args);
  } as TFn;
}

/**
 * Build the three `ctx.emit.trace.*` impls. Each:
 *   - emits item.added then item.done via the response emitter,
 *   - fire-and-forgets a TraceStore append for both events.
 *
 * Trace types (`block_trace`, `router_decision`, `state_snapshot`) resolve
 * to `{ client: false, history: false }` by `item.type` in
 * `resolveItemVisibility` — no stamp needed.
 *
 * The TraceStore writes are best-effort: errors are swallowed (with a
 * once-per-process console.warn fallback) so trace plumbing never breaks
 * primary execution.
 */
let TRACE_STORE_WRITE_WARNED = false;
function buildTraceEmitters(
  emCtx: EmissionContext,
  traces: TraceStore | undefined,
  _getBlockIdentity?: () => {
    blockName?: string;
    blockKind?: "handler" | "generator" | "sequencer" | "router";
    blockInstanceId?: string;
    parentBlockInstanceId?: string;
    phase?: "main" | "work";
  } | undefined
): {
  blockTrace: (item: BlockTraceItem) => void;
  routerDecision: (item: RouterDecisionItem) => void;
  stateSnapshot: (item: StateSnapshotItem) => void;
} {
  const requestId = emCtx.requestId;

  function recordTrace(
    type: "trace.item.added" | "trace.item.done",
    item: BlockTraceItem | RouterDecisionItem | StateSnapshotItem
  ): void {
    if (traces === undefined) return;
    const sequenceNumber =
      typeof emCtx.response.getSequenceNumber === "function"
        ? emCtx.response.getSequenceNumber()
        : 0;
    void traces
      .appendEvent(requestId, {
        requestId,
        sequenceNumber,
        ts: Date.now(),
        type,
        item,
      })
      .catch(() => {
        if (!TRACE_STORE_WRITE_WARNED) {
          TRACE_STORE_WRITE_WARNED = true;
          // eslint-disable-next-line no-console
          console.warn("[flow-state-dev] TraceStore append failed; further errors suppressed.");
        }
      });
  }

  return {
    blockTrace(item) {
      void emCtx.response
        .emitItemAdded(item)
        .then(() => {
          recordTrace("trace.item.added", item);
          return emCtx.response.emitItemDone(item);
        })
        .then(() => recordTrace("trace.item.done", item))
        .catch(() => { /* trace emission is best-effort */ });
    },
    routerDecision(item) {
      void emCtx.response
        .emitItemAdded(item)
        .then(() => {
          recordTrace("trace.item.added", item);
          return emCtx.response.emitItemDone(item);
        })
        .then(() => recordTrace("trace.item.done", item))
        .catch(() => { /* trace emission is best-effort */ });
    },
    stateSnapshot(item) {
      void emCtx.response
        .emitItemAdded(item)
        .then(() => {
          recordTrace("trace.item.added", item);
          return emCtx.response.emitItemDone(item);
        })
        .then(() => recordTrace("trace.item.done", item))
        .catch(() => { /* trace emission is best-effort */ });
    },
  };
}

export async function createExecutionContext<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TOrgState extends JsonObject = JsonObject
>(
  options: CreateExecutionContextOptions<
    TRequestState,
    TSessionState,
    TUserState,
    TOrgState
  >
): Promise<
  ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState>
> {
  const now = Date.now();
  const {
    flow,
    stores
  } = options;
  const transientStateChanges = !shouldPersistScopeChange(flow);
  // Per-mutation budget for in-memory state writes (target / sequencer /
  // any scope without a `persist` callback). Plumbed through to every
  // ScopeStateOpsOptions so the lock branch can fire
  // ScopeMutationTimeoutError instead of hanging the request. External-
  // store scopes still receive the option but ignore it — runWithCAS
  // owns its own retry/timeout semantics.
  const resolvedMutationTimeoutMs =
    flow.request?.mutationTimeoutMs ?? 30_000;
  // FIX-435: resources live in a single flat `flow.resources` map. Each
  // entry is routed to the appropriate scope storage via its intrinsic
  // `scope`. Partition the flat map back into per-scope buckets so the
  // existing per-scope storage helpers can keep doing their job.
  const flatFlowResources = (flow.resources ?? {}) as Record<
    string,
    (ResourceConfig | ResourceCollectionConfig) & { scope: "session" | "user" | "org" }
  >;
  const sessionResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  const userResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  const orgResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig> = {};
  /**
   * accessor → scope mapping so the flat ctx.resources registry can route
   * gets/lists across all three per-scope registries below.
   */
  const accessorScope: Record<string, "session" | "user" | "org"> = {};

  for (const [accessor, def] of Object.entries(flatFlowResources)) {
    const scope = def.scope;
    if (scope === "session") sessionResourceConfigs[accessor] = def;
    else if (scope === "user") userResourceConfigs[accessor] = def;
    else if (scope === "org") orgResourceConfigs[accessor] = def;
    else throw new Error(`Resource "${accessor}" has unknown scope ${JSON.stringify(scope)}`);
    accessorScope[accessor] = scope;
  }

  resolveStringContentTemplates(sessionResourceConfigs);
  resolveStringContentTemplates(userResourceConfigs);
  resolveStringContentTemplates(orgResourceConfigs);

  if (!options.userId || options.userId.trim().length === 0) {
    throw new Error(`Flow "${flow.kind}" requires a userId`);
  }

  const userId = options.userId;
  const sessionId = options.sessionId ?? `ephemeral_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const requestId = options.requestId;

  // Tenant-namespaced session storage key (FIX-682). Bare `sessionId` for
  // single-tenant requests; `${tenantId}:${sessionId}` when a tenant is
  // present. This is the key used for the session record and the session-scoped
  // content/resource-state `scopeId`, so two tenants sharing a session id never
  // collide. The bare `sessionId` is preserved for the public identity
  // (`ctx.session.identity.id`), emitted events, and the request record's
  // (bare) `sessionId` field; request history isolates by the `tenantId` filter
  // instead of a namespaced field.
  const sessionKey = resolveSessionStorageKey(sessionId, options.tenantId);

  // Storage keys — namespaced by flowKind when the flow opts into per-flow
  // isolation for user/org scope. Bare identity ids otherwise. See
  // `packages/server/src/stores/scope-keys.ts` and FIX-431.
  const userKey = resolveUserStorageKey(userId, flow);
  const optionsOrgId = options.orgId;
  const optionsOrgKey =
    optionsOrgId !== undefined
      ? resolveOrgStorageKey(optionsOrgId, flow)
      : undefined;

  // Window the cross-turn history load to the most recent N completed
  // requests (FIX-685). This bounds the store read and the default
  // generator's in-prompt history regardless of session length; the full
  // session stays retrievable via the state endpoint. Per-call
  // history({ limit }) refines within this window — it cannot widen it.
  const historyWindowTurns = flow.session?.historyWindow?.turns ?? 50;

  // Parallelize independent store lookups — user, session, org, and request
  // records don't depend on each other for the initial load.
  const [loadedUser, loadedSession, loadedOrg, loadedRequest, priorRequests] = await Promise.all([
    stores.user.get(userKey),
    stores.session.get(sessionKey),
    optionsOrgKey !== undefined ? stores.org.get(optionsOrgKey) : undefined,
    stores.request.get(requestId),
    // The N most-recently-started completed requests — `status:"completed"`
    // excludes the current (in-progress) request and any in-flight siblings;
    // `orderBy:"startedAtMs"` makes the windowed selection robust to
    // out-of-order metadata writes. `items` reconstruct cross-turn history.
    stores.request.list({
      sessionId,
      // Always pass the tenant (possibly undefined) so history exact-matches
      // this tenant and never crosses into another tenant's requests for the
      // same bare session id (FIX-682).
      tenantId: options.tenantId,
      status: "completed",
      limit: historyWindowTurns,
      orderBy: "startedAtMs",
      withItems: true
    })
  ]);

  // The windowed list already filters to completed requests at the store;
  // exclude only the current request (defends a retry that reuses an id),
  // then sort ascending for stable history ordering. Reused by all()/client()
  // (via priorItems) and history() (via loadLLMHistory).
  const completedPriorRequests = priorRequests
    .filter((r) => r.id !== requestId)
    .sort((a, b) => a.startedAtMs - b.startedAtMs);

  // Build prior items from completed request records. This replaces the
  // deprecated SessionRecord.items field — items are canonical on request records.
  const priorItems: SessionItem[] = [];
  for (const req of completedPriorRequests) {
    if (req.items === undefined) {
      continue;
    }
    for (const item of req.items) {
      priorItems.push(outputItemToSessionItem(item));
    }
  }
  // Sort by timestamp then index for stable ordering
  priorItems.sort((a, b) => {
    const tsDiff = (a.ts ?? 0) - (b.ts ?? 0);
    return tsDiff !== 0 ? tsDiff : a.itemIndex - b.itemIndex;
  });

  let userRecord = loadedUser;
  if (userRecord === undefined) {
    // `id` is the storage key (namespaced when isolated); `userId` stays as
    // the bare identity so listing and cross-reference by userId work across
    // isolated and shared records alike.
    userRecord = {
      id: userKey,
      userId,
      state: (options.userState ?? {}) as TUserState,
      resources: normalizeScopeResources(userResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.user.set(userRecord.id, userRecord, "any");
  }

  let sessionRecord = loadedSession;
  if (sessionRecord === undefined) {
    sessionRecord = {
      id: sessionKey,
      flowKind: flow.kind,
      userId,
      orgId: options.orgId,
      tenantId: options.tenantId,
      state: (options.sessionState ?? {}) as TSessionState,
      resources: normalizeScopeResources(sessionResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    };
    await stores.session.set(sessionRecord.id, sessionRecord, "any");
  } else {
    ensureJournalDefaults(sessionRecord);

    // userId mismatch — closes a long-standing gap. The loaded session record's
    // userId is authoritative; a request claiming a different identity would
    // route this user's actions against another user's data.
    if (sessionRecord.userId !== userId) {
      throw new UserBindingMismatchError(sessionId, sessionRecord.userId, userId);
    }

    // Tenant binding (FIX-682). The session storage key is
    // `${tenantId}:${sessionId}`, which is ambiguous when the caller controls
    // `sessionId`: omitting the tenant header while passing
    // `sessionId = "${otherTenant}:${id}"` resolves to another tenant's key.
    // The loaded record's stored `tenantId` is authoritative — reject when it
    // differs from this request's tenant so a key collision can never read or
    // mutate across the tenant boundary.
    if (!tenantMatches(sessionRecord.tenantId, options.tenantId)) {
      throw new TenantBindingMismatchError(
        sessionId,
        sessionRecord.tenantId,
        options.tenantId
      );
    }
  }

  // orgId immutability. Org binding is fixed for the lifetime of a session;
  // a request that claims a different orgId — including binding an
  // unbound session — is rejected. Apps that need to "move" a session
  // create a new one. The previous code (`optionsOrgId ?? sessionRecord?.orgId`)
  // silently let the request override the session's stored value, vacating
  // the immutability guarantee FIX-428 promises.
  const sessionOrgId = sessionRecord.orgId;
  if (optionsOrgId !== undefined && optionsOrgId !== sessionOrgId) {
    throw new OrgBindingMismatchError(sessionId, sessionOrgId ?? "<unbound>", optionsOrgId);
  }

  const resolvedOrgId = sessionOrgId;
  const resolvedOrgKey =
    resolvedOrgId !== undefined
      ? resolveOrgStorageKey(resolvedOrgId, flow)
      : undefined;
  let orgRecord: OrgRecord | undefined = loadedOrg;
  if (
    orgRecord === undefined &&
    resolvedOrgKey !== undefined &&
    resolvedOrgKey !== optionsOrgKey
  ) {
    orgRecord = await stores.org.get(resolvedOrgKey);
  }
  if (resolvedOrgId !== undefined && resolvedOrgKey !== undefined && orgRecord === undefined) {
    orgRecord = {
      id: resolvedOrgKey,
      orgId: resolvedOrgId,
      userId,
      state: (options.orgState ?? {}) as TOrgState,
      resources: normalizeScopeResources(orgResourceConfigs, undefined),
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    await stores.org.set(orgRecord.id, orgRecord, "any");
  }

  // FIX-701: per-block resource-load tracing. Records, per block dispatch,
  // which resource loads fired (store fetch vs in-memory cache hit), how long
  // each took, and which wave/accessor triggered it — drained onto the block's
  // `block_trace` item for DevTool observability. All recording is gated by
  // `isTraceObservabilityEnabled()` so it adds zero work when observability is
  // off. Attribution is concurrency-safe via an AsyncLocalStorage carrying the
  // dispatching block's instance id: wave-3 eager preloads and lazy reads fire
  // inside the block's `.run()` ALS frame and attribute to it; waves 1 & 2 run
  // before any block and land in the orphan bucket, flushed onto the request's
  // entry block.
  const loadAttributionStorage = new AsyncLocalStorage<string>();
  const ORPHAN_BUCKET = "__request__";
  const resourceLoadBuffer = new Map<string, ResourceLoadRecord[]>();
  // Per-target dedupe index for cache-hit collapsing: target → `source|key|
  // accessor` → the record to bump. Keeps a wide read loop O(N), not O(N²).
  const cacheHitIndex = new Map<string, Map<string, ResourceLoadRecord>>();
  // Which wave fetched a given collection prefix / single key, keyed by the
  // single-flight token (`${scope}:prefix:${p}` | `${scope}:key:${k}`). Read by
  // `resolveEagerSource` so an eager cache-hit read can tag the wave that paid
  // for the prefetch.
  const loadSourceByToken = new Map<string, ResourceLoadRecord["source"]>();
  // The request's entry block, captured at its first `added` trace phase
  // (depth-first dispatch makes the first block the top-most one). The orphan
  // bucket flushes onto it at its `output` phase. Captured here as a closure
  // `let` because `onBlockTraceCapture` (defined far below) sets it.
  let rootBlockInstanceId: string | undefined;

  /**
   * Push one resource-load record, routed to the current attribution target
   * (the dispatching block, or the orphan bucket for pre-block waves). Cache
   * hits of the same (source, storageKey, accessor) collapse in place so a
   * tight read loop is a single aggregated row. The dedupe uses a per-target
   * index keyed by that tuple, so a block reading N distinct keys stays O(N),
   * not O(N²). Never throws — recording must never fail a load.
   */
  const recordResourceLoad = (rec: Omit<ResourceLoadRecord, "count">): void => {
    if (!isTraceObservabilityEnabled()) return; // zero overhead when off
    const target = loadAttributionStorage.getStore() ?? ORPHAN_BUCKET;
    let list = resourceLoadBuffer.get(target);
    if (list === undefined) {
      list = [];
      resourceLoadBuffer.set(target, list);
    }
    if (rec.cacheHit) {
      let index = cacheHitIndex.get(target);
      if (index === undefined) {
        index = new Map();
        cacheHitIndex.set(target, index);
      }
      const dedupeKey = `${rec.source}|${rec.storageKey}|${rec.accessor ?? ""}`;
      const hit = index.get(dedupeKey);
      if (hit !== undefined) {
        hit.count += 1;
        hit.durationMs += rec.durationMs;
        return;
      }
      const record: ResourceLoadRecord = { ...rec, count: 1 };
      index.set(dedupeKey, record);
      list.push(record);
      return;
    }
    list.push({ ...rec, count: 1 });
  };

  /**
   * Resolve the `source` for an eager collection cache-hit read. Callers pass
   * the collection's pattern prefix (all instances of a collection share the
   * wave that loaded the prefix), so an exact token lookup suffices. Defaults
   * to `action-eager` when the origin is unknown (FIX-701 §11 Q3).
   */
  const resolveEagerSource = (
    scope: ContentScopeType,
    keyOrPrefix: string
  ): ResourceLoadRecord["source"] =>
    loadSourceByToken.get(`${scope}:prefix:${keyOrPrefix}`) ??
    loadSourceByToken.get(`${scope}:key:${keyOrPrefix}`) ??
    "action-eager";

  /**
   * Record one fetch record per declared config in a bulk preload wave. Waves
   * 1 & 2 batch their store reads in parallel, so per-key wall time isn't
   * available; the caller passes a per-record share of the measured batch time
   * (`perRecordDurationMs`) so the records sum to the real wall time without
   * inflating it. Also stamps `loadSourceByToken` so later eager reads of these
   * collections resolve the right wave. No-op when observability is off or
   * nothing was declared.
   */
  const recordWavePreload = (
    scope: ContentScopeType,
    configs: Record<string, ResourceConfig | ResourceCollectionConfig>,
    source: ResourceLoadRecord["source"],
    perRecordDurationMs: number
  ): void => {
    if (!isTraceObservabilityEnabled()) return;
    const entries = Object.entries(configs);
    if (entries.length === 0) return;
    const storageKeyMap = resourceStorageKeys(configs);
    for (const [accessor, config] of entries) {
      let storageKey: string;
      if (isCollectionConfig(config)) {
        const prefix = getPatternPrefix(config.pattern);
        storageKey = prefix === "" ? "" : `${prefix}/`;
        loadSourceByToken.set(`${scope}:prefix:${storageKey}`, source);
      } else {
        storageKey = storageKeyMap[accessor] ?? accessor;
        loadSourceByToken.set(`${scope}:key:${storageKey}`, source);
      }
      recordResourceLoad({ storageKey, scope, source, durationMs: perRecordDurationMs, cacheHit: false });
    }
  };

  // Content lives in ContentStore exclusively (FIX-347). Load only the
  // content this flow declares (FIX-685) — fixed resources by key,
  // collections by pattern prefix — so reads during the run are synchronous
  // against the in-memory cache without over-fetching the whole scope. The
  // full-scope view stays available via the state endpoint.
  // FIX-688 Wave 1: load only the flow-level eager resources at request start.
  // Action-tree and lazy resources load later (Waves 2 & 3) via
  // `_loadDeclaredResources`. `flowLevelResourceKeys` is the set of accessors
  // declared in the flow's own `resources` map (pre bubble-up); a flow without
  // it falls back to "every accessor", reproducing the prior behaviour.
  const flowLevelResourceKeys: ReadonlySet<string> =
    flow.flowLevelResourceKeys ?? new Set(Object.keys(flatFlowResources));
  const sessionFlowLevelConfigs = filterFlowLevelEager(sessionResourceConfigs, flowLevelResourceKeys);
  const userFlowLevelConfigs = filterFlowLevelEager(userResourceConfigs, flowLevelResourceKeys);
  const orgFlowLevelConfigs = filterFlowLevelEager(orgResourceConfigs, flowLevelResourceKeys);

  // FIX-735: per-resource isolation. Resource storage (resourceState +
  // content) keys per resource — bare identity id when shared
  // (`flowIsolation` false), `${id}:${flowKind}` when isolated — instead of
  // collapsing the whole scope onto one flow-wide key. The scope *record*
  // (`stores.user`/`stores.org`, holding `ctx.user.state`) still keys on the
  // flow-level `isolateUserState`/`isolateOrgState` flag via `userKey` /
  // `resolvedOrgKey` above; only resources go per-bucket.
  //
  // Canonical storage keys are resolved from each scope's FULL config map: an
  // unaliased single resource canonicalizes to its first accessor (FIX-591),
  // so a subset load must resolve keys against the whole map.
  const scopeStorageKeyMaps: Record<ContentScopeType, Record<string, string>> = {
    session: resourceStorageKeys(sessionResourceConfigs),
    user: resourceStorageKeys(userResourceConfigs),
    org: resourceStorageKeys(orgResourceConfigs)
  };

  // Bare identity id for a scope (not the storage key) — used to derive the
  // per-resource bucket. `undefined` when the scope is absent this request
  // (org with no orgId).
  const scopeIdentityId = (scope: ContentScopeType): string | undefined =>
    scope === "session" ? sessionKey : scope === "user" ? userId : resolvedOrgId;

  // Per scope: which storage keys (singles) and collection prefixes are
  // isolated. Built once from the full config maps so any read/write can map a
  // key to its bucket. Session never isolates, so only user/org are tracked.
  type IsolationBuckets = {
    singles: Map<string, boolean>;
    prefixes: Array<{ prefix: string; isolated: boolean }>;
  };
  const buildIsolationBuckets = (scope: "user" | "org"): IsolationBuckets => {
    const configs = scope === "user" ? userResourceConfigs : orgResourceConfigs;
    const keys = scopeStorageKeyMaps[scope];
    const singles = new Map<string, boolean>();
    const prefixes: Array<{ prefix: string; isolated: boolean }> = [];
    // FIX-735: collection storage is keyed by pattern prefix (load waves,
    // `getByPrefix`, single-flight tokens, and the loaded-prefix cache all key
    // on it). Two collections that share a prefix therefore share one storage
    // slot and MUST share an isolation bucket — otherwise one would silently
    // shadow the other's loads/writes. Patterns whose first segment is a
    // parameter/wildcard collapse to the empty prefix (whole-scope scan), so
    // this most often bites two parameterized collections at one scope. Reject
    // the conflict loudly at setup rather than mis-route data.
    const prefixIsolation = new Map<string, boolean>();
    for (const [accessor, config] of Object.entries(configs)) {
      const isolated = resolveResourceIsolation(
        (config as { flowIsolation?: boolean }).flowIsolation,
        flow,
        scope
      );
      if (isCollectionConfig(config)) {
        const rawPrefix = getPatternPrefix(config.pattern);
        const keyPrefix = rawPrefix === "" ? "" : `${rawPrefix}/`;
        const existing = prefixIsolation.get(keyPrefix);
        if (existing !== undefined && existing !== isolated) {
          throw new Error(
            `Flow "${flow.kind}": ${scope}-scoped collections sharing storage prefix ` +
              `"${keyPrefix || "(whole scope)"}" declare conflicting flowIsolation. ` +
              `Collections that share a storage prefix must share an isolation bucket — ` +
              `give them distinct static prefixes or matching flowIsolation (FIX-735).`
          );
        }
        prefixIsolation.set(keyPrefix, isolated);
        prefixes.push({ prefix: keyPrefix, isolated });
      } else {
        singles.set(keys[accessor] ?? accessor, isolated);
      }
    }
    return { singles, prefixes };
  };
  const isolationBuckets: Record<"user" | "org", IsolationBuckets> = {
    user: buildIsolationBuckets("user"),
    org: buildIsolationBuckets("org")
  };

  // Resolve the per-resource storage `scopeId` from a (scope, config). Used by
  // the eager load waves and persist paths, which hold the config and so can
  // read its `flowIsolation` directly (correct for collections, whose accessor
  // is not a key prefix). `undefined` when the scope is absent this request.
  const resolveConfigScopeId = (
    scope: ContentScopeType,
    config: ResourceConfig | ResourceCollectionConfig
  ): string | undefined => {
    if (scope === "session") return sessionKey;
    const identityId = scopeIdentityId(scope);
    if (identityId === undefined) return undefined;
    const isolated = resolveResourceIsolation(
      (config as { flowIsolation?: boolean }).flowIsolation,
      flow,
      scope
    );
    return resolveResourceScopeId(identityId, flow.kind, isolated);
  };

  // Resolve the per-resource storage `scopeId` from a (scope, storageKey). Used
  // by the lazy loaders and per-key persist loops, which only hold a storage
  // key (a single's canonical key or a collection *instance* key like
  // `prefix/id`). Singles match exactly; collection instances match the
  // *longest* declared prefix that owns them, so nested prefixes (e.g. `a/` and
  // `a/b/`) route to the right collection rather than the first one declared;
  // an undeclared key falls back to the flow-flag bucket.
  const resolveResourceStorageScopeId = (
    scope: ContentScopeType,
    storageKey: string
  ): string | undefined => {
    if (scope === "session") return sessionKey;
    const identityId = scopeIdentityId(scope);
    if (identityId === undefined) return undefined;
    const buckets = isolationBuckets[scope];
    let isolated = buckets.singles.get(storageKey);
    if (isolated === undefined) {
      let bestLen = -1;
      for (const p of buckets.prefixes) {
        const matches = p.prefix === "" || storageKey.startsWith(p.prefix);
        if (matches && p.prefix.length > bestLen) {
          bestLen = p.prefix.length;
          isolated = p.isolated;
        }
      }
    }
    if (isolated === undefined) {
      isolated = scope === "user" ? flow.isolateUserState : flow.isolateOrgState;
    }
    return resolveResourceScopeId(identityId, flow.kind, isolated);
  };

  // Group a per-scope config subset by the storage scopeId each entry resolves
  // to (at most two groups: shared + isolated). Lets the eager load waves issue
  // one store read per bucket and merge. Empty when the scope is absent.
  const partitionConfigsByScopeId = (
    scope: "user" | "org",
    configs: Record<string, ResourceConfig | ResourceCollectionConfig>
  ): Map<string, Record<string, ResourceConfig | ResourceCollectionConfig>> => {
    const groups = new Map<string, Record<string, ResourceConfig | ResourceCollectionConfig>>();
    for (const [accessor, config] of Object.entries(configs)) {
      const scopeId = resolveConfigScopeId(scope, config);
      if (scopeId === undefined) continue;
      const group = groups.get(scopeId) ?? {};
      group[accessor] = config;
      groups.set(scopeId, group);
    }
    return groups;
  };

  const loadScopeStateByBuckets = async (
    scope: "user" | "org",
    configs: Record<string, ResourceConfig | ResourceCollectionConfig>
  ): Promise<Record<string, JsonObject>> => {
    const groups = partitionConfigsByScopeId(scope, configs);
    const results = await Promise.all(
      [...groups].map(([scopeId, sub]) =>
        loadDeclaredResourceState(stores.resourceState, scope, scopeId, sub)
      )
    );
    return Object.assign({}, ...results) as Record<string, JsonObject>;
  };

  const loadScopeContentByBuckets = async (
    scope: "user" | "org",
    configs: Record<string, ResourceConfig | ResourceCollectionConfig>
  ): Promise<Record<string, string>> => {
    const groups = partitionConfigsByScopeId(scope, configs);
    const results = await Promise.all(
      [...groups].map(([scopeId, sub]) =>
        loadDeclaredScopeContent(stores.content, scope, scopeId, sub)
      )
    );
    return Object.assign({}, ...results) as Record<string, string>;
  };

  const wave1Start = Date.now();
  const [sessionContentFromStore, userContentFromStore, orgContentFromStore] = await Promise.all([
    loadDeclaredScopeContent(stores.content, "session", sessionKey, sessionFlowLevelConfigs),
    loadScopeContentByBuckets("user", userFlowLevelConfigs),
    resolvedOrgId !== undefined
      ? loadScopeContentByBuckets("org", orgFlowLevelConfigs)
      : Promise.resolve<Record<string, string>>({})
  ]);

  const initialSessionContent = normalizeScopeResourceContent(
    sessionFlowLevelConfigs,
    sessionContentFromStore
  );
  const initialUserContent = normalizeScopeResourceContent(
    userFlowLevelConfigs,
    userContentFromStore
  );
  const initialOrgContent = normalizeScopeResourceContent(
    orgFlowLevelConfigs,
    resolvedOrgId !== undefined ? orgContentFromStore : undefined
  );

  // Resource state lives in ResourceStateStore exclusively (FIX-689), the
  // state-layer twin of the content load above. Load only the state this flow
  // declares — single resources by key, collections by pattern prefix — into
  // per-scope caches; in-execution reads/writes hit the cache and persist
  // per-key, never rewriting the whole scope record.
  const [sessionStateFromStore, userStateFromStore, orgStateFromStore] = await Promise.all([
    loadDeclaredResourceState(stores.resourceState, "session", sessionKey, sessionFlowLevelConfigs),
    loadScopeStateByBuckets("user", userFlowLevelConfigs),
    resolvedOrgId !== undefined
      ? loadScopeStateByBuckets("org", orgFlowLevelConfigs)
      : Promise.resolve<Record<string, JsonObject>>({})
  ]);

  const initialSessionState = normalizeScopeResources(sessionFlowLevelConfigs, sessionStateFromStore);
  const initialUserState = normalizeScopeResources(userFlowLevelConfigs, userStateFromStore);
  const initialOrgState = normalizeScopeResources(
    orgFlowLevelConfigs,
    resolvedOrgId !== undefined ? orgStateFromStore : undefined
  );

  // FIX-701 Wave 1: record the flow-eager preloads (content + state loaded in
  // the two parallel bursts above). These run before any block dispatch, so
  // they land in the orphan bucket and are flushed onto the entry block. The
  // whole burst loads in parallel, so split the one measured wall time across
  // every flow-level record (all scopes) — the records then sum to the real
  // wave-1 cost rather than triple-counting it once per scope.
  const wave1Duration = Date.now() - wave1Start;
  const wave1Entries =
    Object.keys(sessionFlowLevelConfigs).length +
    Object.keys(userFlowLevelConfigs).length +
    (resolvedOrgKey !== undefined ? Object.keys(orgFlowLevelConfigs).length : 0);
  const wave1PerRecord = wave1Entries > 0 ? wave1Duration / wave1Entries : 0;
  recordWavePreload("session", sessionFlowLevelConfigs, "flow-eager", wave1PerRecord);
  recordWavePreload("user", userFlowLevelConfigs, "flow-eager", wave1PerRecord);
  if (resolvedOrgKey !== undefined) {
    recordWavePreload("org", orgFlowLevelConfigs, "flow-eager", wave1PerRecord);
  }

  let requestRecord = loadedRequest;
  if (requestRecord === undefined) {
    // Bare session id (not the namespaced session key) — request history
    // isolates by the `tenantId` field, and recovery re-derives the key from
    // (bare sessionId + tenantId). See FIX-682. Shared with the enqueue-time
    // materialization in `createInboundTransportHost` so the host stub and the
    // worker-built record are identical by construction (FIX-828).
    requestRecord = createInitialRequestRecord<TRequestState>(
      {
        requestId,
        flowKind: flow.kind,
        actionName: options.actionName,
        userId,
        sessionId,
        tenantId: options.tenantId,
        orgId: orgRecord?.orgId,
        source: options.source,
        metadata: options.metadata,
        input: options.input,
        requestState: options.requestState
      },
      now
    );
    await stores.request.set(requestRecord.id, requestRecord, "any");
  } else if (requestRecord.source === undefined) {
    // Pre-FIX-438 records read from a store that hasn't been migrated
    // default to the HTTP source. New writes always carry the field.
    requestRecord = { ...requestRecord, source: "http" };
  }

  if (requestRecord === undefined) {
    throw new Error(`Request "${requestId}" could not be initialized`);
  }

  const requestRef: { current: RequestRecord } = {
    current: requestRecord
  };
  const userRef: { current: UserRecord } = {
    current: userRecord
  };
  const sessionRef: { current: SessionRecord } = {
    current: sessionRecord
  };
  const orgRef: { current: OrgRecord | undefined } = {
    current: orgRecord
  };

  // State refs: eagerly loaded from ResourceStateStore at initialization
  // (FIX-689), mirroring the content refs below. All reads during execution
  // use the in-memory cache (synchronous); writes update the cache and persist
  // to ResourceStateStore (async, per-key). The scope record's `.resources`
  // field is no longer read or written by this path.
  const sessionStateRef = { current: initialSessionState };
  const userStateRef = { current: initialUserState };
  const orgStateRef = { current: initialOrgState };

  const readSessionResources = (): Record<string, JsonObject> =>
    sessionStateRef.current;

  // Content refs: eagerly loaded from ContentStore at initialization.
  // All reads during execution use the in-memory cache (synchronous).
  // Writes update the cache and persist to ContentStore (async, per-key).
  const sessionContentRef = { current: initialSessionContent };
  const userContentRef = { current: initialUserContent };
  const orgContentRef = { current: initialOrgContent };

  // FIX-688 Waves 2 & 3: top up the per-scope caches above with resources
  // declared inside the dispatched action's block tree, on demand. Wave 1
  // (request start) already loaded the flow-level eager subset; everything
  // else loads at action dispatch (`runAction`) and per-block dispatch (the
  // block runtime's `run`) through `_loadDeclaredResources` below.
  //
  // `loadedCollectionPrefixes` records which collection pattern-prefixes have
  // been bulk-loaded so a re-dispatch never re-scans; it is seeded with the
  // flow-level collections Wave 1 already loaded. Single resources are tracked
  // implicitly by presence in the state cache. `inflightLoads` single-flights
  // concurrent loads of the same key/prefix across parallel block dispatch
  // (e.g. a sequencer's `.work()` fan-out), and clears entries in `finally`
  // so a failed load retries on the next attempt instead of poisoning the map.
  const loadedCollectionPrefixes: Record<ContentScopeType, Set<string>> = {
    session: new Set<string>(),
    user: new Set<string>(),
    org: new Set<string>()
  };
  // Negative cache for lazy single-row reads: a key confirmed absent by a
  // `resourceState.get` returning undefined. Caps each missing key at one store
  // round-trip per request instead of re-reading on every `get`/`getOptional`.
  // The existence check (`storageKey in stateRef.current`) is always consulted
  // first, so a later create/upsert that writes the key wins over a stale entry
  // here — no active invalidation needed.
  const missingResourceKeys: Record<ContentScopeType, Set<string>> = {
    session: new Set<string>(),
    user: new Set<string>(),
    org: new Set<string>()
  };
  // A cache miss is *authoritative* (no store read needed) when the key falls
  // under a prefix already bulk-loaded via `getByPrefix` — the whole prefix is
  // materialized, so an absent key is definitively absent. Prefixes end in `/`
  // (or are `""`, the whole-scope load), so `startsWith` is the coverage test.
  const isMissAuthoritative = (scope: ContentScopeType, storageKey: string): boolean => {
    for (const prefix of loadedCollectionPrefixes[scope]) {
      if (storageKey.startsWith(prefix)) return true;
    }
    return false;
  };
  const seedLoadedPrefixes = (
    scope: ContentScopeType,
    configs: Record<string, ResourceConfig | ResourceCollectionConfig>
  ): void => {
    for (const config of Object.values(configs)) {
      if (!isCollectionConfig(config)) continue;
      const prefix = getPatternPrefix(config.pattern);
      loadedCollectionPrefixes[scope].add(prefix === "" ? "" : `${prefix}/`);
    }
  };
  seedLoadedPrefixes("session", sessionFlowLevelConfigs);
  seedLoadedPrefixes("user", userFlowLevelConfigs);
  seedLoadedPrefixes("org", orgFlowLevelConfigs);

  const inflightLoads = new Map<string, Promise<void>>();
  const runSingleFlight = (token: string, fn: () => Promise<void>): Promise<void> => {
    const existing = inflightLoads.get(token);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      try {
        await fn();
      } finally {
        inflightLoads.delete(token);
      }
    })();
    inflightLoads.set(token, promise);
    return promise;
  };

  const scopeStateRef = (scope: ContentScopeType): { current: Record<string, JsonObject> } =>
    scope === "session" ? sessionStateRef : scope === "user" ? userStateRef : orgStateRef;
  const scopeContentRef = (scope: ContentScopeType): { current: Record<string, string> } =>
    scope === "session" ? sessionContentRef : scope === "user" ? userContentRef : orgContentRef;

  // FIX-688 Slice 3: per-scope on-demand loaders backing lazy collection
  // accessors. Reuses the same single-flight map and `loadedCollectionPrefixes`
  // as the eager waves, so a key fetched here and one fetched by a wave dedupe.
  const makeLazyLoad = (scope: ContentScopeType): ScopeLazyLoad | undefined => {
    if (scopeIdentityId(scope) === undefined) return undefined; // scope absent this request (org)
    const stateRef = scopeStateRef(scope);
    const contentRef = scopeContentRef(scope);
    return {
      async getInstance(storageKey: string): Promise<LazyLoadOutcome> {
        if (storageKey in stateRef.current) return { fetched: false, durationMs: 0 }; // already loaded
        // A miss under an already-bulk-loaded prefix is authoritative, and a
        // key confirmed absent earlier this request stays absent — skip the
        // store round-trip in both cases.
        if (isMissAuthoritative(scope, storageKey)) return { fetched: false, durationMs: 0 };
        if (missingResourceKeys[scope].has(storageKey)) return { fetched: false, durationMs: 0 };
        // FIX-735: route to this key's isolation bucket (bare vs namespaced).
        const scopeId = resolveResourceStorageScopeId(scope, storageKey)!;
        let fetched = false;
        let durationMs = 0;
        await runSingleFlight(`${scope}:key:${storageKey}`, async () => {
          if (storageKey in stateRef.current) return;
          const started = Date.now();
          const [state, content] = await Promise.all([
            stores.resourceState.get(scope, scopeId, storageKey),
            stores.content.get(scope, scopeId, storageKey)
          ]);
          durationMs = Date.now() - started;
          fetched = true;
          if (state !== undefined) {
            stateRef.current = { [storageKey]: state, ...stateRef.current };
          } else {
            // Negatively cache: one round-trip caps repeated reads of an absent key.
            missingResourceKeys[scope].add(storageKey);
          }
          if (typeof content === "string") {
            contentRef.current = { [storageKey]: content, ...contentRef.current };
          }
        });
        return { fetched, durationMs };
      },
      async getByPrefix(keyPrefix: string): Promise<LazyLoadOutcome> {
        if (loadedCollectionPrefixes[scope].has(keyPrefix)) return { fetched: false, durationMs: 0 };
        // FIX-735: the collection's prefix resolves to its isolation bucket.
        const scopeId = resolveResourceStorageScopeId(scope, keyPrefix)!;
        let fetched = false;
        let durationMs = 0;
        await runSingleFlight(`${scope}:prefix:${keyPrefix}`, async () => {
          if (loadedCollectionPrefixes[scope].has(keyPrefix)) return;
          const started = Date.now();
          const [state, content] = await Promise.all([
            stores.resourceState.getByPrefix(scope, scopeId, keyPrefix),
            stores.content.getByPrefix(scope, scopeId, keyPrefix)
          ]);
          durationMs = Date.now() - started;
          fetched = true;
          stateRef.current = { ...state, ...stateRef.current };
          contentRef.current = { ...content, ...contentRef.current };
          loadedCollectionPrefixes[scope].add(keyPrefix);
        });
        return { fetched, durationMs };
      }
    };
  };
  const sessionLazyLoad = makeLazyLoad("session");
  const userLazyLoad = makeLazyLoad("user");
  const orgLazyLoad = makeLazyLoad("org");

  /**
   * FIX-688 Waves 2 & 3 loader. Loads the eager, not-yet-cached entries from a
   * declared-resources map into the per-scope caches. With `loadLazySingles`
   * it also loads `prefetchMode: 'lazy'` single resources (block dispatch).
   * Lazy collections are always skipped — the async accessor fetches them.
   * Cache wins over the store snapshot on conflict, so a concurrent mutation
   * is never clobbered by an in-flight read.
   *
   * FIX-701: each entry records a resource-load — `cacheHit: true` when the
   * key/prefix is already cached (a benign cross-wave dedupe), `cacheHit:
   * false` timed around the store round-trip otherwise. The load source is
   * derived from `loadLazySingles`: the action-dispatch caller (Wave 2) passes
   * `false` → `action-eager`; the per-block dispatch caller (Wave 3, via
   * `_loadDeclaredResources`) passes `true` → `block-eager`.
   */
  const loadDeclaredResourcesIntoCache = async (
    declared: Record<string, ResourceConfig | ResourceCollectionConfig> | undefined,
    loadOptions: { loadLazySingles: boolean }
  ): Promise<void> => {
    if (declared === undefined) return;
    const source: ResourceLoadRecord["source"] = loadOptions.loadLazySingles
      ? "block-eager"
      : "action-eager";
    const tasks: Array<Promise<void>> = [];

    for (const [accessor, config] of Object.entries(declared)) {
      const scope = (config as { scope?: ContentScopeType }).scope;
      if (scope !== "session" && scope !== "user" && scope !== "org") continue;
      // FIX-735: route to this resource's isolation bucket from its config.
      const scopeId = resolveConfigScopeId(scope, config);
      if (scopeId === undefined) continue; // org scope not present this request
      const mode = (config as { prefetchMode?: string }).prefetchMode ?? "eager";
      const stateRef = scopeStateRef(scope);
      const contentRef = scopeContentRef(scope);
      // Key the load by the canonical storage key (from the full-map resolution
      // above), so aliased single resources load under the same slot the
      // registry reads. Collections canonicalize to their accessor, so this is
      // a no-op for them.
      const storageKey = scopeStorageKeyMaps[scope][accessor] ?? accessor;
      const subConfig = { [storageKey]: config };

      const applyLoad = async (): Promise<void> => {
        const [stateSeed, contentSeed] = await Promise.all([
          loadDeclaredResourceState(stores.resourceState, scope, scopeId, subConfig),
          loadDeclaredScopeContent(stores.content, scope, scopeId, subConfig)
        ]);
        stateRef.current = {
          ...normalizeScopeResources(subConfig, stateSeed),
          ...stateRef.current
        };
        contentRef.current = {
          ...normalizeScopeResourceContent(subConfig, contentSeed),
          ...contentRef.current
        };
      };

      if (isCollectionConfig(config)) {
        if (mode === "lazy") continue; // lazy collections fetch via async accessor
        const prefix = getPatternPrefix(config.pattern);
        const keyPrefix = prefix === "" ? "" : `${prefix}/`;
        if (loadedCollectionPrefixes[scope].has(keyPrefix)) {
          recordResourceLoad({ storageKey: keyPrefix, scope, source, durationMs: 0, cacheHit: true });
          continue;
        }
        tasks.push(
          runSingleFlight(`${scope}:prefix:${keyPrefix}`, async () => {
            if (loadedCollectionPrefixes[scope].has(keyPrefix)) {
              recordResourceLoad({ storageKey: keyPrefix, scope, source, durationMs: 0, cacheHit: true });
              return;
            }
            const started = Date.now();
            await applyLoad();
            loadedCollectionPrefixes[scope].add(keyPrefix);
            loadSourceByToken.set(`${scope}:prefix:${keyPrefix}`, source);
            recordResourceLoad({
              storageKey: keyPrefix, scope, source, durationMs: Date.now() - started, cacheHit: false
            });
          })
        );
      } else {
        if (mode === "lazy" && !loadOptions.loadLazySingles) continue; // deferred to block dispatch
        if (storageKey in stateRef.current) {
          recordResourceLoad({ storageKey, scope, source, durationMs: 0, cacheHit: true });
          continue; // already loaded
        }
        tasks.push(
          runSingleFlight(`${scope}:key:${storageKey}`, async () => {
            if (storageKey in stateRef.current) {
              recordResourceLoad({ storageKey, scope, source, durationMs: 0, cacheHit: true });
              return;
            }
            const started = Date.now();
            await applyLoad();
            loadSourceByToken.set(`${scope}:key:${storageKey}`, source);
            recordResourceLoad({
              storageKey, scope, source, durationMs: Date.now() - started, cacheHit: false
            });
          })
        );
      }
    }

    await Promise.all(tasks);
  };

  // FIX-688 Wave 2: a context is bound to exactly one action, so load that
  // action's eager resource footprint — its block tree's bubble-up
  // (`action.block.declaredResources`) — now, in one parallel burst. Only the
  // dispatched action's resources load; sibling actions' declarations stay
  // unloaded until their own request. Lazy single resources defer to per-block
  // dispatch (Wave 3); lazy collections fetch on demand via their async
  // accessor. The flow-level subset loaded at Wave 1 is skipped here (already
  // cached / prefix-seeded).
  // Form-aware: a webhook dispatch's handler lives on `flow.webhooks`, not
  // `flow.actions`, so resolve through the shared seam (keyed on
  // `metadata.webhook`) rather than indexing `flow.actions` directly.
  const dispatchedActionBlock = resolveActionCore(flow, options.actionName, options.metadata)
    ?.block as
    | { declaredResources?: Record<string, ResourceConfig | ResourceCollectionConfig> }
    | undefined;
  if (dispatchedActionBlock?.declaredResources !== undefined) {
    await loadDeclaredResourcesIntoCache(dispatchedActionBlock.declaredResources, {
      loadLazySingles: false
    });
  }

  const readSessionResourceContent = (): Record<string, string> =>
    sessionContentRef.current;

  const readUserResources = (): Record<string, JsonObject> =>
    userStateRef.current;

  const readUserResourceContent = (): Record<string, string> =>
    userContentRef.current;

  const readProjectResources = (): Record<string, JsonObject> =>
    orgStateRef.current;

  const readProjectResourceContent = (): Record<string, string> =>
    orgContentRef.current;

  // FIX-744: single-key resource persistence. Each write/delete commits one
  // key to the durable store, then mutates the live per-scope cache IN PLACE
  // at that key (`ref.current[key] = value`) rather than snapshotting and
  // replacing the whole map. Distinct keys are independent, so concurrent
  // distinct-key writes from `.parallel` / `.forEach` branches — which all
  // share one `ctx` — can no longer clobber each other in the in-memory view
  // a convergence read sees. Mirrors the per-field commutative path the
  // scope-state container already uses. Same-key concurrent writes resolve
  // last-writer-wins (accepted, matching commutative state semantics).
  //
  // FIX-735: the durable store id is resolved PER KEY via
  // `resolveResourceStorageScopeId(scope, key)` (each resource persists to its
  // own isolation bucket); the in-memory cache stays keyed by the resource key
  // regardless of which bucket backs it.
  const makeKeyPersisters = (scope: ContentScopeType) => {
    const stateRef = scopeStateRef(scope);
    const contentRef = scopeContentRef(scope);
    return {
      persistResourceKey: async (key: string, value: JsonObject): Promise<void> => {
        const scopeId = resolveResourceStorageScopeId(scope, key);
        if (scopeId === undefined) return;
        if (deepEqual(stateRef.current[key], value)) return;
        await stores.resourceState.set(scope, scopeId, key, value);
        stateRef.current[key] = value;
      },
      deleteResourceKey: async (key: string): Promise<void> => {
        const scopeId = resolveResourceStorageScopeId(scope, key);
        // `!(key in stateRef.current)` is a load-state check, not a
        // correctness guarantee: it scopes the delete to keys present in the
        // cache, matching the prior whole-map reconciliation (which only ever
        // diffed cached keys). Eager scopes hold the full set, so this is
        // exact; for a `prefetchMode: 'lazy'` instance never loaded this
        // request the store row is left untouched — a pre-existing gap, not
        // introduced by the per-key path.
        if (scopeId === undefined || !(key in stateRef.current)) return;
        await stores.resourceState.delete(scope, scopeId, key);
        delete stateRef.current[key];
      },
      persistResourceContentKey: async (key: string, content: string): Promise<void> => {
        const scopeId = resolveResourceStorageScopeId(scope, key);
        if (scopeId === undefined) return;
        if (contentRef.current[key] === content) return;
        await stores.content.set(scope, scopeId, key, content);
        contentRef.current[key] = content;
      },
      deleteResourceContentKey: async (key: string): Promise<void> => {
        const scopeId = resolveResourceStorageScopeId(scope, key);
        // Load-state check, as in `deleteResourceKey` above.
        if (scopeId === undefined || !(key in contentRef.current)) return;
        await stores.content.delete(scope, scopeId, key);
        delete contentRef.current[key];
      }
    };
  };

  const sessionKeyPersisters = makeKeyPersisters("session");
  const userKeyPersisters = makeKeyPersisters("user");
  const orgKeyPersisters = makeKeyPersisters("org");

  const requestContainer = createStateContainer<TRequestState>(
    requestRef.current.state as TRequestState,
    requestRef.current.version
  );
  const userContainer = createStateContainer<TUserState>(
    userRef.current.state as TUserState,
    userRef.current.version
  );
  const sessionContainer = createStateContainer<TSessionState>(
    sessionRef.current.state as TSessionState,
    sessionRef.current.version
  );
  const orgContainer =
    orgRef.current === undefined
      ? undefined
      : createStateContainer<TOrgState>(
          orgRef.current.state as TOrgState,
          orgRef.current.version
        );

  // Hoisted so scope-handle ops can close over these refs and emit
  // `state_change` items on mutation (FIX-576). `responseRef.current` is
  // assigned once `response` is constructed below; until then no scope op
  // can run.
  const responseRef: { current: unknown } = { current: undefined };
  // Per-run item-index counter. Seeded from the response emitter's current
  // count so a same-request continuation (FIX-811) continues after the prior
  // persisted log instead of restarting at 0 — the emitter carries the prior
  // log's length as its `baseItemIndex`, and is empty at context construction,
  // so this reads back exactly that base (0 on a fresh run). Both block-emitted
  // items and runtime items reserved via `_reserveItemIndex` draw from this one
  // counter so their indices stay distinct and monotonic across the resume.
  let emittedItemCount =
    typeof options.response?.getItemCount === "function"
      ? options.response.getItemCount()
      : 0;

  const requestOps = createScopeStateOps(requestContainer, {
    persist: createScopePersist<TRequestState, RequestRecord>(
      requestRef,
      stores.request,
      (expectedVersion, state) => ({
        ...requestRef.current,
        state: state as TRequestState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  const userOps = createScopeStateOps(userContainer, {
    cas: flow.user?.cas,
    persist: createScopePersist<TUserState, UserRecord>(
      userRef,
      stores.user,
      (expectedVersion, state) => ({
        ...userRef.current,
        state: state as TUserState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  const sessionOps = createScopeStateOps(sessionContainer, {
    cas: flow.session?.cas,
    persist: createScopePersist<TSessionState, SessionRecord>(
      sessionRef,
      stores.session,
      (expectedVersion, state) => ({
        ...sessionRef.current,
        state: state as TSessionState,
        version: expectedVersion + 1,
        updatedAt: Date.now()
      })
    )
  });

  const orgOps = (():
    | ReturnType<typeof createScopeStateOps<TOrgState>>
    | undefined => {
    if (orgRef.current === undefined || orgContainer === undefined) {
      return undefined;
    }
    // Build the standard persist callback once, then wrap it with an
    // "Org removed mid-execution" guard. The guard short-circuits before the
    // inner callback touches `orgRef.current.id`, which would throw if the
    // org went away mid-request.
    const inner = createScopePersist<TOrgState, OrgRecord>(
      orgRef as { current: OrgRecord },
      stores.org,
      (ev, st) => ({
        ...(orgRef.current as OrgRecord),
        state: st as TOrgState,
        version: ev + 1,
        updatedAt: Date.now()
      })
    );
    return createScopeStateOps(orgContainer, {
      cas: flow.org?.cas,
      persist: async (state, expectedVersion, hint) => {
        if (orgRef.current === undefined) {
          return { ok: true, version: expectedVersion + 1 };
        }
        return inner(state, expectedVersion, hint);
      }
    });
  })();

  // Resource change emitter — pushes transient resource_change items via SSE
  // so clients can refresh clientData without waiting for request completion.
  const rawResponse = options.response as unknown as Record<string, unknown> | undefined;
  const emitter = rawResponse && typeof rawResponse.emitResourceChange === "function"
    ? (rawResponse as unknown as { emitResourceChange: (opts: { scope: string; resourcePath: string; changeType: string; transient?: boolean; delta?: unknown }) => Promise<unknown> })
    : undefined;

  // FIX-751: shared per-request cascade budget and a late-bound ctx ref. The
  // reactive dispatcher needs the live ExecutionContext to run blocks in-session
  // via `executeBlock`, but the root context isn't built until the end of this
  // function — so the dispatchers close over `reactiveCtxRef`, populated below.
  const cascadeController = createCascadeController();
  const reactiveCtxRef: { current: ExecutionContext | undefined } = { current: undefined };

  function makeResourceChangeHandler(scope: "session" | "user" | "org") {
    const scopeConfigs =
      scope === "session" ? sessionResourceConfigs : scope === "user" ? userResourceConfigs : orgResourceConfigs;
    const hasReactive = Object.values(scopeConfigs).some((c) => c.reactTo !== undefined);

    // Only wire a handler when there is something to do: a live emitter
    // (FIX-739 streaming) and/or a `reactTo` binding (FIX-751). Reactive-only
    // resources still dispatch even with no emitter present.
    if (!emitter && !hasReactive) return undefined;

    const dispatchReactive = hasReactive
      ? createReactiveDispatcher({
          configs: scopeConfigs,
          ctxRef: reactiveCtxRef,
          controller: cascadeController,
          // The attribution ALS holds the executing block's instance id, so the
          // reactive block parents under whichever block performed the mutation.
          getTriggerInstanceId: () => loadAttributionStorage.getStore(),
          runAttributed: (instanceId, fn) => loadAttributionStorage.run(instanceId, fn),
        })
      : undefined;

    // FIX-739 streams resource_change for client-visible changes: all collections
    // (delta only when live) and live single resources. A single resource that
    // fires the seam only because it declares `reactTo` (FIX-751, non-live) must
    // NOT emit — that would leak a client item for a resource with no client
    // projection. Precompute those storage keys once and skip the emit for them.
    const scopeStorageKeys = resourceStorageKeys(scopeConfigs);
    const nonStreamingSingleKeys = new Set<string>();
    for (const [accessor, cfg] of Object.entries(scopeConfigs)) {
      if (!isCollectionConfig(cfg) && cfg.client?.live !== true) {
        nonStreamingSingleKeys.add(scopeStorageKeys[accessor] ?? accessor);
      }
    }

    return async (
      resourcePath: string,
      changeType: "created" | "updated" | "deleted",
      projection?: { delta: unknown },
      change?: ResourceChangeDelta
    ): Promise<void> => {
      // FIX-739 streaming emit stays fire-and-forget: `projection` is present
      // only for `client.live: true` resources and fills the resource_change
      // item's `delta` slot so the client merges without a refetch. Absent →
      // batched-refetch path unchanged. Skip non-live singles (reactive-only).
      if (emitter !== undefined && !nonStreamingSingleKeys.has(resourcePath)) {
        void emitter.emitResourceChange({
          scope,
          resourcePath,
          changeType,
          transient: true,
          delta: projection?.delta
        });
      }
      // FIX-751 reactive dispatch is awaited inline — it runs the bound block
      // as part of the mutating turn, and a block failure propagates out.
      if (dispatchReactive !== undefined) {
        await dispatchReactive(resourcePath, changeType, change);
      }
    };
  }

  // Mutable-ref template resolver for contentTemplateRef. Populated after all
  // three scope registries are constructed, so readContent() closures can
  // resolve a template resource's raw content across scopes.
  const templateResolverRef: { current: ((ref: string) => string | null) | null } = { current: null };

  const userResources = createScopeResourceRegistry({
    scope: "user",
    scopeId: userId,
    configs: userResourceConfigs,
    readResources: readUserResources,
    readResourceContent: readUserResourceContent,
    ...userKeyPersisters,
    onResourceChanged: makeResourceChangeHandler("user"),
    lazyLoad: userLazyLoad,
    recordResourceLoad,
    resolveEagerSource: (keyOrPrefix) => resolveEagerSource("user", keyOrPrefix),
    templateResolverRef,
  });

  const sessionResources = createScopeResourceRegistry({
    scope: "session",
    scopeId: sessionKey,
    configs: sessionResourceConfigs,
    readResources: readSessionResources,
    readResourceContent: readSessionResourceContent,
    ...sessionKeyPersisters,
    onResourceChanged: makeResourceChangeHandler("session"),
    lazyLoad: sessionLazyLoad,
    recordResourceLoad,
    resolveEagerSource: (keyOrPrefix) => resolveEagerSource("session", keyOrPrefix),
    templateResolverRef,
  });

  const orgResources =
    orgRef.current === undefined
      ? undefined
      : createScopeResourceRegistry({
          scope: "org",
          scopeId: orgRef.current!.orgId,
          configs: orgResourceConfigs,
          readResources: readProjectResources,
          readResourceContent: readProjectResourceContent,
          ...orgKeyPersisters,
          onResourceChanged: makeResourceChangeHandler("org"),
          lazyLoad: orgLazyLoad,
          recordResourceLoad,
          resolveEagerSource: (keyOrPrefix) => resolveEagerSource("org", keyOrPrefix),
          templateResolverRef,
        });

  // Populate the template resolver now that all registries exist.
  templateResolverRef.current = (ref: string): string | null => {
    for (const contentFn of [readSessionResourceContent, readUserResourceContent, readProjectResourceContent]) {
      const content = contentFn()[ref];
      if (typeof content === "string") return content;
    }
    return null;
  };



  const modelResolver = options.modelResolver ?? createModelResolver();
  const tokenCounter: TokenCounter = flow.tokenCounter ?? {
    async count(text: string): Promise<number> {
      return Math.ceil(text.length / 4);
    },
    async countMessages(messages: LLMMessage[]): Promise<number> {
      const total = messages.reduce((acc, message) => acc + JSON.stringify(message.content).length, 0);
      return Math.ceil(total / 4);
    }
  };
  const resolvedModelStorage = new AsyncLocalStorage<string>();
  const resolveModel = ((modelId: string, blockName?: string) => {
    resolvedModelStorage.enterWith(modelId);
    return modelResolver(modelId, blockName);
  }) as ModelResolver;
  resolveModel.resolveId = (modelId: string) => modelResolver.resolveId(modelId);

  const readLiveItems = (): Array<OutputItem | BlockTraceItem> => {
    const typedResponse = responseRef.current as { getItems?: () => Array<OutputItem | BlockTraceItem> };
    if (typeof typedResponse.getItems === "function") {
      return typedResponse.getItems();
    }
    return requestRef.current.items ?? [];
  };

  const computeTokenUsage = () => {
    const byModel: Record<string, { prompt: number; completion: number; total: number; cacheReadTokens: number; cacheCreationTokens: number }> = {};
    for (const item of readLiveItems()) {
      if (item.type !== "block_trace") {
        continue;
      }
      const modelUsage = item.modelUsage;
      if (modelUsage === undefined) {
        continue;
      }
      const existing = byModel[modelUsage.model] ?? {
        prompt: 0,
        completion: 0,
        total: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0
      };
      existing.prompt += Number(modelUsage.promptTokens ?? 0);
      existing.completion += Number(modelUsage.completionTokens ?? 0);
      existing.total += Number(modelUsage.totalTokens ?? 0);
      existing.cacheReadTokens += Number(modelUsage.cacheReadTokens ?? 0);
      existing.cacheCreationTokens += Number(modelUsage.cacheCreationTokens ?? 0);
      byModel[modelUsage.model] = existing;
    }

    const totalConsumed = Object.values(byModel).reduce((acc, model) => acc + model.total, 0);
    const maxBudget = resolveActionCore(flow, options.actionName, options.metadata)?.tokenBudget
      ?.maxTotalTokens;

    return {
      totalConsumed,
      byModel,
      remaining: typeof maxBudget === "number" ? Math.max(0, maxBudget - totalConsumed) : Number.POSITIVE_INFINITY
    };
  };

  const computeCostEstimate = () => {
    const estimator = flow.costEstimator;
    const usage = computeTokenUsage();
    const byModel: Record<string, number> = {};

    for (const [model, entry] of Object.entries(usage.byModel)) {
      byModel[model] = estimator?.estimate(entry, model) ?? 0;
    }

    const totalUSD = Object.values(byModel).reduce((acc, value) => acc + value, 0);
    return { totalUSD, byModel };
  };

  function emitWrap<TState extends JsonObject>(
    scope: "request" | "session" | "user" | "org",
    baseOps: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">,
    container: ReturnType<typeof createStateContainer<TState>>
  ) {
    return wrapStateOpsWithEmit({
      scope,
      baseOps,
      container,
      getResponse: () => responseRef.current,
      requestId: requestRef.current.id,
      nextItemIndex: () => emittedItemCount++,
      provenance: () => ({
        blockName: "runtime",
        blockInstanceId: "runtime",
        phase: "main" as const
      }),
      transient: transientStateChanges
    });
  }

  const requestOpsEmitting = emitWrap("request", requestOps, requestContainer);
  const requestHandle = defineStateProperty(
    {
      identity: {
        type: "request" as const,
        id: requestRef.current.id,
        userId,
        orgId: orgRef.current?.orgId,
        tenantId: options.tenantId
      },
      get tokenUsage() {
        return computeTokenUsage();
      },
      get costEstimate() {
        return computeCostEstimate();
      },
      ...requestOpsEmitting
    },
    () => requestContainer.read()
  ) as RequestScopeHandle<TRequestState>;

  const userOpsEmitting = emitWrap("user", userOps, userContainer);
  const userHandle = defineStateProperty(
    {
      identity: {
        type: "user" as const,
        id: userRef.current.id,
        userId: userRef.current.userId,
        tenantId: options.tenantId
      },
      ...userOpsEmitting
    },
    () => userContainer.read()
  ) as UserScopeHandle<TUserState>;

  const sessionOpsEmitting = emitWrap("session", sessionOps, sessionContainer);
  const sessionHandle = defineStateProperty(
    {
      identity: {
        type: "session" as const,
        // Bare session id — `sessionRef.current.id` is the tenant-namespaced
        // storage key (FIX-682); handlers and clients see the id they passed in.
        id: sessionId,
        userId: sessionRef.current.userId,
        orgId: sessionRef.current.orgId,
        tenantId: options.tenantId
      },
      get metadata() {
        const s = sessionRef.current;
        return {
          ...(s.title !== undefined ? { title: s.title } : {}),
          ...(s.description !== undefined ? { description: s.description } : {}),
          ...(s.tags !== undefined ? { tags: s.tags } : {})
        };
      },
      items: createSessionItemViews(priorItems, completedPriorRequests, {
        tokenCounter,
        readLiveItems,
        resolveModelId: () => {
          const active = resolvedModelStorage.getStore();
          if (typeof active === "string") {
            return active;
          }

          const items = readLiveItems();
          for (let index = items.length - 1; index >= 0; index -= 1) {
            const item = items[index];
            if (item?.type === "block_trace" && item.modelUsage !== undefined) {
              return item.modelUsage.model;
            }
          }

          return "gpt-4o-mini";
        }
      }),
      appendJournal: async (entry: JournalEntryInput): Promise<void> => {
        const journalEntry = buildJournalEntry(entry);
        sessionRef.current = {
          ...sessionRef.current,
          journal: [...sessionRef.current.journal, journalEntry],
          updatedAt: Date.now()
        };
        // Journal is append-only and not part of the state CAS path.
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current,
          "any"
        );
      },
      getJournal: async (query?: {
        limit?: number;
        offset?: number;
      }): Promise<JournalEntry[]> => {
        const offset = Math.max(0, query?.offset ?? 0);
        const start = offset;
        const list = sessionRef.current.journal.slice(start);

        if (query?.limit === undefined) {
          return [...list];
        }

        return list.slice(0, Math.max(0, query.limit));
      },
      setMetadata: async (input: SessionMetadataInput): Promise<void> => {
        const now = Date.now();
        sessionRef.current = {
          ...sessionRef.current,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.metadata !== undefined
            ? { metadata: { ...sessionRef.current.metadata, ...input.metadata } }
            : {}),
          updatedAt: now
        };
        // Session metadata (title/description/tags/metadata) is non-CAS today.
        await stores.session.set(
          sessionRef.current.id,
          sessionRef.current,
          "any"
        );

        await response.emit({
          type: "session.metadata.changed",
          // Bare session id, not the namespaced storage key (FIX-682).
          sessionId,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {})
        });
      },
      ...sessionOpsEmitting
    },
    () => sessionContainer.read()
  ) as SessionScopeHandle<TSessionState>;

  const orgOpsEmitting =
    orgOps === undefined || orgContainer === undefined
      ? undefined
      : emitWrap("org", orgOps, orgContainer);
  const orgHandle =
    orgRef.current === undefined || orgOpsEmitting === undefined || orgContainer === undefined
      ? undefined
      : (defineStateProperty(
          {
            identity: {
              type: "org" as const,
              id: orgRef.current.id,
              userId: orgRef.current.userId,
              orgId: orgRef.current.orgId,
              tenantId: options.tenantId
            },
            ...orgOpsEmitting
          },
          () => orgContainer.read()
        ) as OrgScopeHandle<TOrgState>);

  // FIX-435: build the flat ctx.resources registry by merging the per-scope
  // registries. A resource's accessor key routes to the registry that owns
  // its intrinsic scope. `get()` and `list()` mirror the merged surface.
  const flatResourcesHandles: Record<string, AnyResourceRef> = {};
  for (const [accessor, scope] of Object.entries(accessorScope)) {
    let registry: ResourceRegistry<Record<string, AnyResourceRef>> | undefined;
    if (scope === "session") registry = sessionResources as ResourceRegistry<Record<string, AnyResourceRef>>;
    else if (scope === "user") registry = userResources as ResourceRegistry<Record<string, AnyResourceRef>>;
    else registry = orgResources as ResourceRegistry<Record<string, AnyResourceRef>> | undefined;
    if (registry === undefined) continue;
    const handle = (registry as Record<string, AnyResourceRef>)[accessor];
    if (handle !== undefined) flatResourcesHandles[accessor] = handle;
  }
  const flatResourcesRegistry: ResourceRegistry<Record<string, AnyResourceRef>> = {
    ...flatResourcesHandles,
    get(name: string) {
      const handle = flatResourcesHandles[String(name)];
      if (handle === undefined) {
        throw new Error(`Resource "${String(name)}" is not registered`);
      }
      return handle;
    },
    list() {
      return Object.values(flatResourcesHandles);
    }
  } as ResourceRegistry<Record<string, AnyResourceRef>>;

  // FIX-573: per-block lifecycle trace items are now driven by
  // `onBlockTraceCapture` phases (added → input → generator → output).
  // The unified hook constructs/patches the row in the per-request
  // blockTraceMap; this section previously held a fire-and-forget
  // single-emission helper that's no longer needed.

  type ExecutionParentNode = {
    parent: ExecutionParent;
    parentStateContainer?: ReturnType<typeof createStateContainer<JsonObject>>;
    result: { status: "not_started" | "running" | "completed" | "failed"; output?: unknown; error?: Error };
    previous?: ExecutionParentNode;
    /**
     * Task id marked on this scope via `ctx._markTaskScope`. Descendant scopes
     * walk `previous` to find the nearest marked ancestor and inherit it as
     * `emCtx.taskId` / `_blockIdentity.taskId`, which emit sites stamp onto
     * items. Mutable: a worker body marks its enclosing sequencer node at
     * runtime, before constructing the child scopes that do the work.
     */
    scopeTaskId?: string;
  };
  type SiblingRegistryEntry = {
    parent: ExecutionParent;
    parentStateContainer?: ReturnType<typeof createStateContainer<JsonObject>>;
    result: {
      status: "not_started" | "running" | "completed" | "failed";
      output?: unknown;
      error?: Error;
      /**
       * Set true when this block threw and a `.rescue()` handler recovered the
       * error during its run. Stamped from the child context's `_didRescue` in
       * `_withExecutionScope`'s success branch; read by `wasRescued`.
       */
      rescued?: boolean;
    };
  };
  const response = options.response ?? {
    emit: async () => undefined
  };
  responseRef.current = response;

  // Emission context used by emitMessage/emitComponent/emitStatus.
  // Duck-type the response: if it has emitItemAdded/emitItemDone, use those;
  // otherwise fall back to the generic emit() method via a thin adapter.

  // Per-request background work pool. Sequencer DSL pushes `.work()` /
  // `.workIf()` / `.forEachBackground()` tasks here; runActionInternal
  // drains the pool exactly once on the success path. Replaces the legacy
  // per-sequencer auto-await scoping.
  const requestWorkPool = createRequestWorkPool();

  // Request-scoped status slot — shared across every scope's createEmitStatus.
  // Terminates naturally when this context is discarded at request end.
  const statusSlot: StatusSlot = { message: "" };
  const typedResponse = response as unknown as Record<string, unknown>;
  const hasTypedEmitter =
    typeof typedResponse.emitItemAdded === "function" &&
    typeof typedResponse.emitItemDone === "function";

  const emissionResponse: EmissionContext["response"] = hasTypedEmitter
    ? (response as unknown as EmissionContext["response"])
    : {
        async emitItemAdded(item: OutputItem) {
          await response.emit({ type: "item.added", item });
        },
        async emitItemDone(item: OutputItem) {
          await response.emit({ type: "item.done", item });
        },
        async emitItemUpdated(itemId: string, patch: Record<string, unknown>) {
          await response.emit({ type: "item.updated", id: itemId, patch });
        }
      };

  const emCtx: EmissionContext = {
    requestId: requestRef.current.id,
    response: emissionResponse,
    provenance: () => ({
      blockName: "runtime",
      blockInstanceId: "runtime",
      phase: "main" as const
    }),
    nextItemIndex: () => emittedItemCount++,
  };

  // Request-level trace emitters used by `_runtimeHooks` (router decisions,
  // etc.) where there's no per-block ctx to delegate to. Per-context trace
  // emitters with provenance overrides are built inside `createContext`.
  const requestTraceEmitters = buildTraceEmitters(emCtx, stores.traces);

  const logger = options.logger;
  const baseLogContext = {
    requestId: requestRef.current.id,
    actionName: options.actionName,
    flowKind: flow.kind
  };

  // FIX-724: opt-in error-capture sink. A per-request dedup set plus a capture
  // closure shared by `_runtimeHooks.onBlockError` (nested leaves) and
  // `ctx._captureError` (the root action block, fired from executeBlock's
  // catch). Dedup keys on the raw thrown value — core re-throws it unchanged up
  // the block tree, so the deepest (leaf) capture wins and the ancestor / root
  // captures of the same throw are suppressed. A `Set` (not `WeakSet`) so that
  // primitive throws (`throw "x"`, `throw null`) dedup by value too; it is
  // scoped to this request's closure and discarded with it.
  const errorCapture = options.errorCapture;
  const captureIdentity: ErrorCaptureIdentity = {
    requestId: requestRef.current.id,
    flowKind: flow.kind,
    actionName: options.actionName,
    userId,
    sessionId,
    orgId: orgRecord?.orgId
  };
  const capturedErrors = new Set<unknown>();
  const captureError = (error: unknown, block?: ErrorCaptureBlockInfo): void => {
    if (errorCapture === undefined) return;
    if (capturedErrors.has(error)) return;
    capturedErrors.add(error);
    // `normalizeError` treats `blockName: undefined` as absent, so this is safe
    // whether or not the caller resolved a block name.
    const normalized = normalizeError(error, {
      blockName: block?.blockName,
      scope: block?.scope
    });
    void safeCaptureError(
      errorCapture,
      toErrorCaptureEvent(normalized, captureIdentity, block),
      logger
    );
  };

  const _runtimeHooks: ExecutionContext["_runtimeHooks"] = {
    onBlockStart: logger
      ? (blockName, blockKind, input, transient) => {
          // Transient blocks (e.g. task-board's poll loop) fire hundreds
          // of times per second; the runtime debug log floods stderr
          // without adding operator value. The block_trace lifecycle is
          // still emitted; this only suppresses the human-readable line.
          if (transient === true) return;
          logRuntimeEvent(logger, "debug", "[flow-state] nested block started", {
            ...baseLogContext,
            blockName,
            blockKind,
            input: summarizeForLog(input)
          });
        }
      : undefined,
    onBlockComplete: logger
      ? (blockName, blockKind, output, durationMs, transient) => {
          if (transient === true) return;
          logRuntimeEvent(logger, "debug", "[flow-state] nested block completed", {
            ...baseLogContext,
            blockName,
            blockKind,
            durationMs,
            output: summarizeForLog(output)
          });
        }
      : undefined,
    onBlockError: (logger !== undefined || errorCapture !== undefined)
      ? (blockName, blockKind, error, durationMs, transient, firingCtx) => {
          // Errors keep logging even for transient blocks — a failing
          // poll loop is exactly the kind of thing operators need to see.
          if (logger !== undefined) {
            logRuntimeEvent(logger, "error", "[flow-state] nested block failed", {
              ...baseLogContext,
              blockName,
              blockKind,
              durationMs,
              error: summarizeForLog(error)
            });
          }
          // FIX-724: route the leaf failure to the operator sink with its own
          // identity, read from the firing block's `_blockIdentity`.
          if (errorCapture !== undefined) {
            const identity = firingCtx?._blockIdentity;
            captureError(error, {
              blockName,
              blockKind: blockKind as ErrorCaptureBlockInfo["blockKind"],
              blockInstanceId: identity?.blockInstanceId,
              blockPath: identity?.blockPath,
              attempt: identity?.attempt,
              transient,
              scope: "block"
            });
          }
        }
      : undefined,
    onRouteSelected: (routerName, selectedBlockName, routerInstanceId) => {
      if (logger) {
        logRuntimeEvent(logger, "debug", "[flow-state] router selected route", {
          ...baseLogContext,
          routerName,
          selectedRoute: selectedBlockName
        });
      }

      // Emit router_decision trace item — fire-and-forget to avoid blocking routing.
      const itemIndex = emittedItemCount++;
      const decisionItem: RouterDecisionItem = {
        id: `item_router_${itemIndex}_${Math.random().toString(16).slice(2)}`,
        type: "router_decision",
        status: "completed",
        requestId: requestRef.current.id,
        itemIndex,
        provenance: {
          blockName: routerName,
          blockInstanceId: routerInstanceId ?? `${routerName}_${requestRef.current.id}`,
          phase: "main"
        },
        ts: Date.now(),
        routerName,
        selectedRoute: selectedBlockName
      };
      requestTraceEmitters.routerDecision(decisionItem);
    },
    // FIX-573: unified block-trace lifecycle hook. Maintains one
    // block_trace item per block instance, stamped on `added` and patched
    // in place on `input` / `generator` / `output` phases. Item.added fires
    // immediately at `added`; subsequent phases emit item.updated; the
    // `output` phase additionally emits item.done.
    onBlockTraceCapture: isTraceObservabilityEnabled()
      ? (payload, firingCtx) => {
          const identity = firingCtx._blockIdentity;
          if (identity === undefined) return;
          const instanceId = identity.blockInstanceId;
          if (payload.phase === "added") {
            // FIX-701: the first block to reach `added` is the request's entry
            // block (dispatch is depth-first). It absorbs the orphan bucket
            // (wave-1/wave-2 loads with no owning block) at its `output` phase.
            if (rootBlockInstanceId === undefined) rootBlockInstanceId = instanceId;
            // Construct + emit. Store on the per-request trace map so later
            // phases can find and patch the row.
            const startedAt = payload.data.startedAt ?? Date.now();
            const itemIndex = emittedItemCount++;
            // FIX-586 restores the FIX-478 contract: auto-emitted block_trace
            // items inherit the originating block's `transient` flag. Traces
            // from `transient: true` blocks (e.g. Task Board's `claim-task` /
            // `check-board` poll loops) stream live to active SSE consumers
            // but are not retained in the persisted items log. Non-transient
            // blocks (the default) keep the canonical retained-trace behavior.
            const item: BlockTraceItem = {
              id: `item_block_trace_${itemIndex}_${Math.random().toString(16).slice(2)}`,
              type: "block_trace",
              status: payload.data.status ?? "in_progress",
              transient: identity.transient === true ? true : undefined,
              requestId: requestRef.current.id,
              itemIndex,
              provenance: {
                blockName: identity.blockName,
                blockInstanceId: instanceId,
                parentBlockInstanceId: identity.parentBlockInstanceId,
                phase: identity.phase ?? "main",
              },
              ts: startedAt,
              ownedBy: identity.ownedBy,
              blockName: identity.blockName,
              blockKind: (identity.blockKind ?? "handler") as BlockTraceItem["blockKind"],
              blockInstanceId: instanceId,
              input: payload.data.input,
              // FIX-701: the block's own declared accessor keys, stamped here
              // so the DevTool can show "declared but not loaded".
              declaredResources:
                payload.data.declaredResources !== undefined &&
                payload.data.declaredResources.length > 0
                  ? payload.data.declaredResources
                  : undefined,
              startedAt,
            };
            blockTraceMap.set(instanceId, item);
            void emissionResponse.emitItemAdded(item).catch(() => { /* best-effort */ });
            return;
          }
          const existing = blockTraceMap.get(instanceId);
          if (existing === undefined) return;
          // Apply phase patch in-place. Last-write-wins on chained calls
          // (multi-step tool loops): the most recent `generator` capture
          // overwrites prior model/prompt fields, matching how the model
          // re-resolves between turns. The wire patch mirrors the in-memory
          // mutation so subscribers don't have to diff the whole row.
          const patch: Record<string, unknown> = {};
          const data = payload.data as Record<string, unknown>;
          const target = existing as Record<string, unknown>;
          for (const key of Object.keys(data)) {
            const value = data[key];
            if (value === undefined) continue;
            target[key] = value;
            patch[key] = value;
          }
          // Emit item.updated for in-flight phases. The FIX-572 dedicated
          // channel is used when available; the duck-typed fallback adapter
          // synthesizes an `item.updated` event via the generic `emit()`.
          if (emissionResponse.emitItemUpdated !== undefined) {
            void emissionResponse
              .emitItemUpdated(existing.id, patch)
              .catch(() => { /* best-effort */ });
          }
          if (payload.phase === "output") {
            // FIX-701: drain this block's recorded resource loads onto the row
            // before the terminal emission. The request's entry block also
            // absorbs the orphan bucket (wave-1/wave-2 loads that fired before
            // any block ran). Fires on both the success and error output paths,
            // so a failed block's loads are not lost.
            const own = resourceLoadBuffer.get(instanceId);
            if (own !== undefined && own.length > 0) {
              existing.resourceLoads = own;
            }
            resourceLoadBuffer.delete(instanceId);
            cacheHitIndex.delete(instanceId);
            if (instanceId === rootBlockInstanceId) {
              const orphan = resourceLoadBuffer.get(ORPHAN_BUCKET);
              if (orphan !== undefined && orphan.length > 0) {
                existing.resourceLoads = [...(existing.resourceLoads ?? []), ...orphan];
              }
              resourceLoadBuffer.delete(ORPHAN_BUCKET);
              cacheHitIndex.delete(ORPHAN_BUCKET);
            }
            // Final emission: emit done so consumers know the row is settled.
            void emissionResponse
              .emitItemDone(existing)
              .catch(() => { /* best-effort */ });
            blockTraceMap.delete(instanceId);
          }
        }
      : undefined,
  };

  // Per-request trace map. Keyed by blockInstanceId; entries are removed
  // when the `output` phase fires. Lives in createExecutionContext closure
  // because every nested ctx shares the same `_runtimeHooks` reference.
  const blockTraceMap = new Map<string, BlockTraceItem>();

  // Run-scoped guard for the legacy resume fallback (FIX-811). When a bare
  // `resumeContext` (no `pendingBlockLogicalId`) is threaded — the pre-Step-3
  // two-request / direct-`runAction` path — the payload must be consumed at the
  // FIRST gate reached and re-suspend at every later gate. Without this shared
  // flag a multi-gate legacy resume would re-inject the same approval at every
  // gate and skip required approvals. Lives in the outer closure so all
  // per-scope `suspend` closures (each built by `createContext`) share it. The
  // Step-3 same-request path sets `pendingBlockLogicalId` and never touches it.
  let legacyResumeConsumed = false;

  // FIX-402: in-process inflight map for ctx.runOnce. Two concurrent calls
  // with the same key share a single fn() invocation. Sits in front of the
  // RequestStore so the wrapped side effect cannot fire twice in a race
  // (the store is the durable backstop across retries).
  // In-process memo of completed runOnce results. Populated synchronously
  // the instant `fn()` resolves — before the store write — so a store
  // failure cannot cause `fn()` to re-execute on a subsequent retry within
  // the same request process. Store persistence is treated as best-effort
  // bookkeeping for cross-process durability.
  const runOnceMemo = new Map<string, unknown>();
  const runOnceInflight = new Map<string, Promise<unknown>>();
  const runOnce = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (typeof key !== "string" || key.length === 0) {
      return Promise.reject(
        new Error("ctx.runOnce(key, fn): `key` must be a non-empty string")
      );
    }
    // Fast path: memo hit (a prior call in this process already completed).
    if (runOnceMemo.has(key)) {
      return Promise.resolve(runOnceMemo.get(key) as T);
    }
    // Claim the inflight slot synchronously before awaiting the store —
    // otherwise concurrent calls with the same key all see an empty
    // inflight map and each spawn their own fn() invocation.
    const existing = runOnceInflight.get(key);
    if (existing !== undefined) return existing as Promise<T>;

    const requestId = requestRef.current.id;
    const promise = (async (): Promise<T> => {
      // Durable lookup. Catches block-retry resumes that lost the
      // in-process memo (none today; future-proofs for durable execution).
      const stored = await stores.request.getRunOnceResult(requestId, key);
      if (stored.found) {
        runOnceMemo.set(key, stored.value);
        return stored.value as T;
      }
      const value = await fn();
      // Memoize BEFORE the store write so a store failure cannot cause
      // re-execution on the next retry within this process.
      runOnceMemo.set(key, value);
      try {
        await stores.request.setRunOnceResult(requestId, key, value);
      } catch (err) {
        // Persistence failure is non-fatal: the side effect already fired
        // and the in-process memo carries de-dup for the rest of this
        // request. Cross-process durability is degraded but we do not
        // amplify a store outage into a double-charge by re-running fn().
        console.warn(
          `[flow-state] runOnce persistence failed for key "${key}" (request ${requestId}); ` +
            `in-process dedup remains in effect`,
          err
        );
      }
      return value;
    })();
    runOnceInflight.set(key, promise as Promise<unknown>);
    promise.finally(() => {
      runOnceInflight.delete(key);
    });
    return promise;
  };

  const createContext = (
    parentChain: ExecutionParentNode | undefined,
    siblingRegistry: SiblingRegistryEntry[] | undefined,
    siblingSearchLimit: number | undefined,
    scopeEmCtx?: EmissionContext,
    // FIX-663: when provided, sets this scope's `ctx.signal` instead of the
    // closure-captured `options.signal`. `_withExecutionScope` threads the
    // current parent ctx's signal here so child scopes inherit the parent's
    // signal (which may be the background signal inside a `.work()` tree)
    // rather than the root request signal via closure capture.
    signalOverride?: AbortSignal
  ): ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState> => {
    const activeEmCtx = scopeEmCtx ?? emCtx;
    const childSiblingRegistry: SiblingRegistryEntry[] = [];
    const context: ExecutionContext<TRequestState, TSessionState, TUserState, TOrgState> = {
      flow,
      actionName: options.actionName,
      requestRuntime: {
        requestId: requestRef.current.id,
        actionName: requestRef.current.actionName,
        status: requestRef.current.status,
        startedAtMs: requestRef.current.startedAtMs,
        completedAtMs: requestRef.current.completedAtMs,
        failedAtMs: requestRef.current.failedAtMs,
        metadata: requestRef.current.metadata
      },
      stores,
      settings: options.settings ?? {},
      request: requestHandle,
      session: sessionHandle,
      user: userHandle,
      org: orgHandle,
      resources: flatResourcesRegistry,
      response: responseRef.current as ExecutionContext["response"],
      signal: signalOverride ?? options.signal ?? new AbortController().signal,
      resolveModel,
      targets: new Proxy({}, {
        get(_target, prop) {
          if (typeof prop !== "string") {
            return undefined;
          }

          return context.getTarget(prop);
        },
        ownKeys() {
          return [];
        },
        getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
        }
      }) as BlockContext["targets"],
      getTarget: <TState extends object = Record<string, unknown>>(name: string): StateRef<TState> | undefined => {
        const toTargetRef = (
          matched: Pick<SiblingRegistryEntry, "parent" | "parentStateContainer">
        ): StateRef<TState> => {
          const container = matched.parentStateContainer;
          const noState = async (): Promise<never> => {
            throw new Error(
              `Target "${matched.parent.name}" does not expose instance state operations.`
            );
          };
          const ops: Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState"> =
            container === undefined
              ? {
                  patchState: noState,
                  setState: noState,
                  incState: noState,
                  pushState: noState,
                  setStateRecord: noState,
                  deleteStateRecord: noState,
                  atomicState: noState
                }
              : (wrapStateOpsWithEmit({
                  scope: "block_instance",
                  baseOps: createScopeStateOps(container, {
                    mutationTimeoutMs: resolvedMutationTimeoutMs
                  }),
                  container,
                  getResponse: () => responseRef.current,
                  requestId: requestRef.current.id,
                  nextItemIndex: () => emittedItemCount++,
                  provenance: () => ({
                    blockName: matched.parent.name,
                    blockInstanceId: matched.parent.instanceId,
                    phase: matched.parent.phase ?? "main"
                  }),
                  blockInstanceId: matched.parent.instanceId,
                  transient: transientStateChanges,
                  transientKeys: getTransientKeys(matched.parent.stateSchema)
                }) as unknown as Pick<StateRef<TState>, "patchState" | "setState" | "incState" | "pushState" | "setStateRecord" | "deleteStateRecord" | "atomicState">);

          return defineStateProperty(
            {
              name: matched.parent.name,
              instanceId: matched.parent.instanceId,
              input: matched.parent.input,
              ...ops
            },
            () => (container?.read() ?? {}) as TState
          ) as unknown as StateRef<TState>;
        };

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name === name) {
              return toTargetRef(sibling);
            }
          }
        }

        const matches: ExecutionParentNode[] = [];
        for (let cursor = parentChain; cursor !== undefined; cursor = cursor.previous) {
          if (cursor.parent.name === name) {
            matches.push(cursor);
          }
        }

        if (matches.length === 0) {
          return undefined;
        }

        if (matches.length > 1) {
          const nearest = matches[0]!.parent;
          const ambiguous = matches.map((entry) => entry.parent.instanceId).join(", ");
          throw new AmbiguousBlockNameError(
            `getTarget("${name}") is ambiguous from block instance "${nearest.instanceId}". Matching instances: ${ambiguous}`
          );
        }

        return toTargetRef(matches[0]!);
      },

      getBlockOutput: (block) => {
        const name = block.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name === name && sibling.result.status === "completed") {
              return sibling.result.output as never;
            }
          }
        }

        return undefined;
      },
      getBlockResult: (block): BlockResult<never> => {
        const name = block.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name !== name) {
              continue;
            }

            if (sibling.result.status === "completed") {
              return { status: "completed", output: sibling.result.output } as BlockResult<never>;
            }

            if (sibling.result.status === "failed") {
              return {
                status: "failed",
                error: sibling.result.error ?? new Error(`Block "${name}" failed.`)
              } as BlockResult<never>;
            }

            return { status: sibling.result.status } as BlockResult<never>;
          }
        }

        return { status: "not_started" } as BlockResult<never>;
      },
      wasRescued: (target) => {
        const name = typeof target === "string" ? target : target.name;

        if (siblingRegistry !== undefined && siblingRegistry.length > 0) {
          const searchFrom = Math.min(
            siblingSearchLimit ?? siblingRegistry.length - 1,
            siblingRegistry.length - 1
          );
          for (let index = searchFrom; index >= 0; index -= 1) {
            const sibling = siblingRegistry[index];
            if (sibling?.parent.name !== name) {
              continue;
            }
            // Most-recent matching sibling wins (per-iteration correct under
            // `.loopBack`), mirroring `getBlockResult`'s resolution.
            return sibling.result.rescued === true;
          }
        }

        return false;
      },
      // Populated immediately after this object literal closes so the
      // deprecated aliases share the underlying impls with `ctx.emit.*`
      // and the trace.blockDebug emitter can read this context's
      // `_blockIdentity` (set later by `_withExecutionScope`).
      emitMessage: undefined as unknown as BlockContext["emitMessage"],
      emitComponent: undefined as unknown as BlockContext["emitComponent"],
      emitStatus: undefined as unknown as BlockContext["emitStatus"],
      emit: undefined as unknown as BlockContext["emit"],
      _peekStatus: undefined as unknown as BlockContext["_peekStatus"],
      // ctx.cap is populated per-block in executeBlock (see buildCapObject below).
      cap: {} as any,
      // FIX-402: idempotency primitives. `idempotencyKey` is populated per
      // block by executeBlock (it depends on the current blockPath, which is
      // only known at execution time); `runOnce` closes over the request's
      // store ref so it works across every scoped child context.
      idempotencyKey: undefined,
      runOnce,
      // Shares the per-run synchronous item-index counter with block-emitted
      // items so runtime items (e.g. runAction's `suspension_resume`) get a
      // distinct, monotonic index that continues the prior log on resume.
      _reserveItemIndex: () => emittedItemCount++,
      suspend: async (suspendOpts) => {
        const resumeCtx = options.metadata?.resumeContext as ResumeContext | undefined;
        // The suspending block's logical id is the attempt-independent prefix
        // of its blockInstanceId — `${requestId}:${path}`. `parentChain.parent`
        // is the scope this `suspend` was created for (the calling block). The
        // root context has no parentChain; default its path to ROOT_BLOCK_PATH
        // ("root") so a `ctx.suspend()` reached on the root context still
        // produces a defined logical id that matches the `pendingBlockLogicalId`
        // a same-request replay threads (which is `${requestId}:root` for a
        // root-level gate). Without this default the root gate's id was
        // undefined and the resolving gate never matched, so the run re-suspended
        // forever (FIX-811).
        const callerPath = parentChain?.parent?.path ?? "root";
        const callerLogicalId = `${requestRef.current.id}:${callerPath}`;

        if (resumeCtx !== undefined) {
          // Per-gate matching (FIX-811): only the gate whose logical id matches
          // the suspension being resolved returns the resume payload. Every
          // other gate reached during the same replay falls through and
          // re-suspends, which is what makes multi-gate and loop-iteration
          // flows resume one gate at a time without a shared "consumed" flag.
          const isResolvingGate =
            resumeCtx.pendingBlockLogicalId !== undefined &&
            resumeCtx.pendingBlockLogicalId === callerLogicalId;

          // Legacy fallback: the old two-request resume path threaded a
          // resumeContext without `pendingBlockLogicalId`. Preserve its
          // first-reached-gate-consumes behavior there — but ONLY once per run,
          // via the shared `legacyResumeConsumed` flag, so a multi-gate legacy
          // resume re-suspends at later gates instead of re-injecting the same
          // payload and skipping their approvals (FIX-811). The Step-3
          // same-request continuation always sets `pendingBlockLogicalId` (see
          // runAction), so this branch is dead on that path — it exists only for
          // callers that pass a bare resumeContext directly to runAction.
          const isLegacyFirstGate =
            resumeCtx.pendingBlockLogicalId === undefined && !legacyResumeConsumed;

          if (isResolvingGate || isLegacyFirstGate) {
            // Mark the legacy payload consumed so later gates re-suspend.
            if (isLegacyFirstGate) legacyResumeConsumed = true;
            if (resumeCtx.action === "reject") {
              throw new SuspensionRejectedError(resumeCtx.suspensionId, resumeCtx.resumedBy, resumeCtx.data);
            }
            return resumeCtx.data;
          }
        }
        if (!options.durabilityEnabled) {
          throw new Error(
            "ctx.suspend() requires a DurabilityProvider. Configure one in your server options."
          );
        }
        const suspensionId = generateId("susp");
        throw new SuspensionError({ ...suspendOpts, suspensionId });
      },
      saveCheckpoint: undefined,
      // Task attribution (FIX-658): mark the nearest enclosing sequencer scope
      // as running `taskId`. The task-board worker body calls this once per
      // claimed task; child scopes constructed afterward inherit it (see the
      // `scopeTaskId` walk in `_withExecutionScope`). Writing to the shared
      // node object means a later sibling step sees the mark even though the
      // marking step has already returned. Each `.loopBack` turn runs in a
      // fresh node, so sequential tasks of one worker stay separated even when
      // their execution paths are identical.
      _markTaskScope: (taskId: string | null): void => {
        for (
          let node: ExecutionParentNode | undefined = parentChain;
          node !== undefined;
          node = node.previous
        ) {
          if (node.parent.kind === "sequencer") {
            node.scopeTaskId = taskId ?? undefined;
            return;
          }
        }
      },
      // Defined below via Object.defineProperty to close over parentChain.
      parent: undefined,
      _runtimeHooks,
      // FIX-724: root-block / fallback capture entrypoint. `undefined` when no
      // `errorCapture` handler is configured so callers incur zero overhead.
      _captureError: errorCapture !== undefined ? captureError : undefined,
      _loadDeclaredResources: loadDeclaredResourcesIntoCache,
      // Resume replay (FIX-811): register a completed sibling entry for a block
      // the core executor short-circuited (its output came from the ReplayLog,
      // not a fresh run). The replay path returns BEFORE `_withExecutionScope`,
      // so without this a later sibling's `ctx.getBlockOutput(replayedBlock)`
      // would find no entry. This does NOT open a scope, run the body, or emit a
      // trace — the recorded trace from the prior run is canonical, and emitting
      // another would duplicate it. `parentStateContainer` is left undefined;
      // `getBlockOutput`/`getBlockResult` read only `parent` + `result.output`,
      // and `getTarget` (which would dereference the container) is never used to
      // reach a replayed leaf.
      _registerReplayedChild: (parent: ExecutionParent, output: unknown): void => {
        childSiblingRegistry.push({
          parent,
          parentStateContainer: undefined,
          result: { status: "completed", output }
        });
      },
      _withExecutionScope: async <TValue>(parent: ExecutionParent, execute: (ctx: BlockContext) => Promise<TValue>, signalOverride?: AbortSignal) => {
        const resolvedParent: ExecutionParent = {
          ...parent,
          parentInstanceId: parent.parentInstanceId ?? parentChain?.parent.instanceId,
          phase: parent.phase ?? parentChain?.parent.phase,
          path: parent.path ?? parentChain?.parent.path
        };

        const parentStateContainer =
          resolvedParent.kind === "sequencer" && resolvedParent.stateSchema !== undefined
            ? createStateContainer<JsonObject>(
                normalizeStateDefault(resolvedParent.stateSchema)
              )
            : undefined;

        // Container lifecycle (FIX-574): emit `item.added` with
        // `status: "in_progress"` on scope entry; defer the terminal patch +
        // `item.done` until the child execute resolves or throws (see the
        // try/catch below). Captured here so both lifecycle branches reach it.
        let containerItem: ContainerItem | undefined;
        let containerResponse:
          | {
              emitItemAdded: (item: OutputItem) => Promise<unknown>;
              emitItemDone: (item: OutputItem) => Promise<unknown>;
              emitItemUpdated?: (itemId: string, patch: Record<string, unknown>) => Promise<unknown>;
            }
          | undefined;
        let containerStartedAt = 0;
        if (resolvedParent.container !== undefined) {
          const typed = responseRef.current as {
            emitItemAdded?: (item: OutputItem) => Promise<unknown>;
            emitItemDone?: (item: OutputItem) => Promise<unknown>;
            emitItemUpdated?: (itemId: string, patch: Record<string, unknown>) => Promise<unknown>;
          };
          if (
            typeof typed.emitItemAdded === "function" &&
            typeof typed.emitItemDone === "function"
          ) {
            const itemIndex = emittedItemCount++;
            containerStartedAt = Date.now();
            containerItem = {
              id: `item_container_${itemIndex}_${Math.random().toString(16).slice(2)}`,
              type: "container",
              status: "in_progress",
              transient: resolvedParent.transient || undefined,
              requestId: requestRef.current.id,
              itemIndex,
              provenance: {
                blockName: resolvedParent.name,
                blockInstanceId: resolvedParent.instanceId,
                parentBlockInstanceId: resolvedParent.parentInstanceId,
                phase: resolvedParent.phase ?? "main"
              },
              ts: containerStartedAt,
              ownedBy: activeEmCtx.ownedBy,
              taskId: activeEmCtx.taskId,
              blockName: resolvedParent.name,
              component: resolvedParent.container.component,
              label: resolvedParent.container.label,
              metadata: resolvedParent.container.metadata,
              startedAt: containerStartedAt
            };
            // Hold the response itself so method calls preserve `this`
            // binding when we close out the lifecycle below.
            containerResponse = typed as Required<typeof typed>;
            await typed.emitItemAdded(containerItem);
          }
        }

        const siblingEntry: SiblingRegistryEntry = {
          parent: resolvedParent,
          parentStateContainer,
          result: { status: "running" }
        };
        childSiblingRegistry.push(siblingEntry);

        const childChain: ExecutionParentNode = {
          parent: resolvedParent,
          parentStateContainer,
          result: siblingEntry.result,
          previous: parentChain
        };
        // Task attribution (FIX-658): inherit the nearest enclosing scope's
        // marked task id. Resolved at construction — a worker body marks its
        // enclosing sequencer node before constructing the steps that emit, so
        // those steps' chains see the mark here. Re-resolved per scope (not
        // copied from the parent emCtx) because the mark lands after the
        // parent scope's emCtx was built.
        let resolvedTaskId: string | undefined;
        for (let node: ExecutionParentNode | undefined = childChain; node !== undefined; node = node.previous) {
          if (node.scopeTaskId !== undefined) {
            resolvedTaskId = node.scopeTaskId;
            break;
          }
        }
        const childPhase = resolvedParent.phase ?? "main";
        // Each scope starts with no identity. Generators that declare
        // `itemVisibility` stamp it directly on the items they emit; other
        // blocks inherit nothing — they emit structural items (status,
        // component, container) whose visibility comes from the type
        // defaults in `resolveItemVisibility()`.
        const childEmCtx: EmissionContext = {
          requestId: requestRef.current.id,
          response: emissionResponse,
          provenance: () => ({
            blockName: resolvedParent.name,
            blockInstanceId: resolvedParent.instanceId,
            parentBlockInstanceId: resolvedParent.parentInstanceId,
            phase: childPhase
          }),
          nextItemIndex: () => emittedItemCount++,
          ownedBy: resolvedParent.container !== undefined
            ? resolvedParent.instanceId
            : activeEmCtx.ownedBy,
          taskId: resolvedTaskId,
        };
        // FIX-663: propagate the signal down the scope chain. An explicit
        // `signalOverride` (threaded by `.work()` dispatch) wins; otherwise
        // inherit the *current* parent ctx's signal so descendant scopes of
        // a `.work()` task tree keep seeing the background signal. Reading
        // `context.signal` (not the closure-captured `options.signal`) is
        // what makes the override propagate beyond one level.
        const childSignal = signalOverride ?? context.signal;
        const childContext = createContext(
          childChain,
          childSiblingRegistry,
          childSiblingRegistry.length - 1,
          childEmCtx,
          childSignal
        );

        (childContext as { _blockIdentity?: unknown })._blockIdentity = {
          blockName: resolvedParent.name,
          blockKind: resolvedParent.kind,
          blockInstanceId: resolvedParent.instanceId,
          parentBlockInstanceId: resolvedParent.parentInstanceId,
          ownedBy: childEmCtx.ownedBy,
          taskId: childEmCtx.taskId,
          phase: resolvedParent.phase ?? "main",
          blockPath: resolvedParent.path,
          transient: resolvedParent.transient
        };

        // Propagate the request-scoped work pool through every nested scope
        // so `.work()` calls in inner sequencers reach the same pool the
        // request executor drains. See `request-work-pool.ts`.
        (childContext as { _requestWorkPool?: unknown })._requestWorkPool = requestWorkPool;
        // FIX-663: re-attach the background signal on every scope so nested
        // `.work()` dispatches can read it (the dispatch site reads
        // `ctx._requestBackgroundSignal`, not `ctx.signal`).
        (childContext as { _requestBackgroundSignal?: AbortSignal })._requestBackgroundSignal = options.backgroundSignal;
        // FIX-406 6H: propagate the request's tracing level so sequencers in
        // any nested scope gate observability snapshots consistently.
        (childContext as { _tracingLevel?: TracingLevel })._tracingLevel = options.tracingLevel;
        // Resume replay (FIX-811): propagate the ReplayLog down every nested
        // scope so the core `executeBlock` replay short-circuit fires for blocks
        // anywhere in the tree, not just direct children of the root sequencer.
        // Read from the parent `context` (set by runAction on the root ctx) so a
        // late assignment still reaches descendants. `_resumeState` is
        // deliberately NOT propagated — it carries the root sequencer's restored
        // checkpoint state only; nested-sequencer state restore is a follow-up.
        const inheritedReplayLog = (context as { _replayLog?: unknown })._replayLog;
        if (inheritedReplayLog !== undefined) {
          (childContext as { _replayLog?: unknown })._replayLog = inheritedReplayLog;
        }
        // Propagate `_resumeState` (the restored checkpoint state) to the ROOT
        // block's scope only — `parentChain === undefined` marks the root-level
        // dispatch. The root durable sequencer reads it to `setState` before
        // running children. Deeper scopes do NOT inherit it, so a nested durable
        // sequencer isn't wrongly seeded with the root's state (nested-sequencer
        // accumulator restore is a documented follow-up, FIX-811).
        if (parentChain === undefined) {
          const inheritedResumeState = (context as { _resumeState?: unknown })._resumeState;
          if (inheritedResumeState !== undefined) {
            (childContext as { _resumeState?: unknown })._resumeState = inheritedResumeState;
          }
        }

        // Capture start time before execution — this is the only trace cost paid
        // unconditionally. Item construction and emission happen post-execution.
        const traceStartedAt = Date.now();

        try {
          // FIX-701: run the block's dispatch inside its load-attribution ALS
          // frame, keyed by this scope's instance id. Wave-3 eager preloads
          // (fired at the top of build-block `run()`) and lazy reads inside
          // `execute()` fall in this frame and attribute to this block. ALS
          // isolates concurrent scopes, so parallel branches never cross-talk;
          // nested scopes establish their own frame and override the parent's.
          const output = await loadAttributionStorage.run(
            resolvedParent.instanceId,
            () => execute(childContext)
          );
          siblingEntry.result.status = "completed";
          siblingEntry.result.output = output;
          siblingEntry.result.error = undefined;
          // Carry the child's out-of-band rescue flag onto its sibling entry so
          // a downstream sibling can read it via `ctx.wasRescued(...)`. Written
          // by the sequencer runtime's rescue catch (see `_didRescue`).
          siblingEntry.result.rescued =
            (childContext as { _didRescue?: boolean })._didRescue === true;

          // Harvest the BlockValue hint set by the child's execute (if any)
          // so the block_trace `output` patch carries a ref/structure rather
          // than duplicating content (FIX-413).
          const capturedHint = (childContext as { _blockOutputHint?: BlockOutputHint })._blockOutputHint;
          if (capturedHint !== undefined) {
            (childContext as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = undefined;
          }

          // FIX-573: fire the `output` phase trace capture. The block_trace
          // is emitted for every block — even tool calls — because Path A
          // emits `tool_output` separately and the called block's trace
          // refs it via `_blockOutputHint` (see generator.ts).
          {
            const completedAt = Date.now();
            // Flatten-at-emit (FIX-413): if the hint refs an item whose own
            // output is itself a ref, take the inner sourceItemId so emitted
            // refs always point one hop to a content-bearing item.
            let flattenedHint = capturedHint;
            if (capturedHint !== undefined && capturedHint.kind === "ref") {
              const typed = responseRef.current as unknown as { getItems?: () => Array<OutputItem | BlockTraceItem> };
              if (typeof typed.getItems === "function") {
                const allItems = typed.getItems();
                for (let i = allItems.length - 1; i >= 0; i -= 1) {
                  const it = allItems[i] as BlockTraceItem;
                  if (it.id === capturedHint.sourceItemId && it.output !== undefined && it.output.kind === "ref") {
                    flattenedHint = { kind: "ref", sourceItemId: it.output.sourceItemId };
                    break;
                  }
                }
              }
            }
            const blockValue: BlockValueInternal<unknown> =
              flattenedHint === undefined || flattenedHint.kind === "inline"
                ? { kind: "inline", value: output }
                : flattenedHint.kind === "structure"
                  ? { kind: "structure", shape: flattenedHint.shape }
                  : { kind: "ref", sourceItemId: flattenedHint.sourceItemId };
            const generatorModelUsage = (childContext as { _generatorModelUsage?: BlockTraceItem["modelUsage"] })._generatorModelUsage;
            if (generatorModelUsage !== undefined) {
              (childContext as { _generatorModelUsage?: unknown })._generatorModelUsage = undefined;
            }
            const generatorModelIdentity = (childContext as { _generatorModelIdentity?: BlockTraceItem["model"] })._generatorModelIdentity;
            if (generatorModelIdentity !== undefined) {
              (childContext as { _generatorModelIdentity?: unknown })._generatorModelIdentity = undefined;
            }
            childContext._runtimeHooks?.onBlockTraceCapture?.(
              {
                phase: "output",
                data: {
                  status: "completed",
                  output: blockValue,
                  completedAt,
                  duration: completedAt - traceStartedAt,
                  modelUsage: generatorModelUsage,
                  model: generatorModelIdentity,
                },
              },
              childContext
            );
            if (parentChain === undefined && capturedHint !== undefined) {
              // Root block case: server's executeBlock reads the hint off
              // the outer (non-scoped) ctx. Forward the child's hint so the
              // root's block_trace can be emitted as ref/structure (FIX-413).
              (context as { _blockOutputHint?: BlockOutputHint })._blockOutputHint = capturedHint;
            }
          }

          if (containerItem !== undefined && containerResponse !== undefined) {
            const completedAt = Date.now();
            const duration = completedAt - containerStartedAt;
            const patch = {
              status: "completed" as const,
              completedAt,
              duration
            };
            // Clear the handle before emitting so a throw from emitItemUpdated
            // or emitItemDone can't re-enter the failure-path close in the
            // catch and produce a contradictory `completed → failed` sequence.
            const closing = containerItem;
            containerItem = undefined;
            if (containerResponse.emitItemUpdated !== undefined) {
              await containerResponse.emitItemUpdated(closing.id, patch);
            }
            const finalItem: ContainerItem = { ...closing, ...patch };
            await containerResponse.emitItemDone(finalItem);
          }

          return output;
        } catch (error) {
          // SuspensionError is control flow, not a failure: the block paused at
          // a `ctx.suspend()` gate awaiting external input. Propagate it without
          // marking the block/sequencer "failed" — runAction catches it, writes
          // the suspension record, and sets the request status to "suspended".
          // The block trace is left at its "in_progress" (paused) state rather
          // than emitting a misleading "failed" terminal; resume runs as a fresh
          // request rebuilt from the checkpoint, so this run's bookkeeping is
          // discarded anyway.
          if (error instanceof SuspensionError) {
            // FIX-811: stamp the suspending block's instance id at the innermost
            // scope to see the error (where identity is known). The first
            // (innermost) writer wins; outer scopes must not overwrite it. This
            // is the reliable source for the suspension record/item identity —
            // the outer request ctx usually has no `_blockIdentity` for a nested
            // suspension.
            if (error._blockInstanceId === undefined) {
              error._blockInstanceId = resolvedParent.instanceId;
            }
            throw error;
          }
          siblingEntry.result.status = "failed";
          siblingEntry.result.error = error instanceof Error ? error : new Error(String(error));
          siblingEntry.result.output = undefined;
          const normalized = normalizeError(error, {
            blockName: resolvedParent.name,
            scope: "block"
          });

          {
            const completedAt = Date.now();
            const generatorModelUsage = (childContext as { _generatorModelUsage?: BlockTraceItem["modelUsage"] })._generatorModelUsage;
            if (generatorModelUsage !== undefined) {
              (childContext as { _generatorModelUsage?: unknown })._generatorModelUsage = undefined;
            }
            const generatorModelIdentity = (childContext as { _generatorModelIdentity?: BlockTraceItem["model"] })._generatorModelIdentity;
            if (generatorModelIdentity !== undefined) {
              (childContext as { _generatorModelIdentity?: unknown })._generatorModelIdentity = undefined;
            }
            // Fold the error cause chain into details so intermediate
            // failures aren't swallowed on the failed block_trace. `displayCause`
            // unwraps the synthetic layer normalizeError adds for plain throws,
            // so this matches the tool-output seam for the same failure.
            const blockTraceErrorDetails = errorDetailsWithCause({
              details: normalized.details,
              cause: displayCause(normalized),
            });
            childContext._runtimeHooks?.onBlockTraceCapture?.(
              {
                phase: "output",
                data: {
                  status: "failed",
                  output: { kind: "inline", value: undefined },
                  completedAt,
                  duration: completedAt - traceStartedAt,
                  error: {
                    message: normalized.message,
                    code: normalized.code,
                    ...(blockTraceErrorDetails ? { details: blockTraceErrorDetails } : {}),
                  },
                  modelUsage: generatorModelUsage,
                  model: generatorModelIdentity,
                },
              },
              childContext
            );
          }

          if (containerItem !== undefined && containerResponse !== undefined) {
            const completedAt = Date.now();
            const duration = completedAt - containerStartedAt;
            const patch = {
              status: "failed" as const,
              completedAt,
              duration,
              error: { message: normalized.message }
            };
            if (containerResponse.emitItemUpdated !== undefined) {
              await containerResponse.emitItemUpdated(containerItem.id, patch);
            }
            const finalItem: ContainerItem = { ...containerItem, ...patch };
            await containerResponse.emitItemDone(finalItem);
          }

          throw error;
        }
      }
    };

    // Wire emission methods. The flat `emitMessage`/`emitComponent`/
    // `emitStatus` are deprecated aliases that warn once per process;
    // both the aliases and `ctx.emit.{message,component,status}` share
    // the same underlying impls. `ctx.emit.trace.*` uses the active
    // emission context plus this context's `_blockIdentity` (set by
    // `_withExecutionScope` on child scopes) so trace items carry the
    // firing block's identity.
    const emitMessageImpl = createEmitMessage(activeEmCtx);
    const emitComponentImpl = createEmitComponent(activeEmCtx);
    const emitStatusImpl = createEmitStatus(activeEmCtx, statusSlot);
    const traceEmitters = buildTraceEmitters(
      activeEmCtx,
      stores.traces,
      () => (context as { _blockIdentity?: {
        blockName?: string;
        blockKind?: "handler" | "generator" | "sequencer" | "router";
        blockInstanceId?: string;
        parentBlockInstanceId?: string;
        phase?: "main" | "work";
      } })._blockIdentity
    );
    context.emitMessage = createDeprecatedAlias("emitMessage", emitMessageImpl) as BlockContext["emitMessage"];
    context.emitComponent = createDeprecatedAlias("emitComponent", emitComponentImpl) as BlockContext["emitComponent"];
    context.emitStatus = createDeprecatedAlias("emitStatus", emitStatusImpl) as BlockContext["emitStatus"];
    context.emit = {
      message: emitMessageImpl,
      component: emitComponentImpl,
      status: emitStatusImpl,
      trace: traceEmitters,
    };
    // Read the request-scoped status slot. Internal — used by the generator's
    // tool-call dispatch to snapshot/restore the slot around a parallel tool
    // round so a tool's `activeStatusMessage` does not linger past the
    // tool's lifetime.
    context._peekStatus = (): string => statusSlot.message;

    Object.defineProperty(context, "sequencer", {
      enumerable: true,
      get() {
        let cursor = parentChain;
        while (cursor !== undefined) {
          if (
            cursor.parent.kind === "sequencer" &&
            cursor.parentStateContainer !== undefined
          ) {
            return context.getTarget(cursor.parent.name);
          }

          cursor = cursor.previous;
        }

        return undefined;
      }
    });

    Object.defineProperty(context, "parent", {
      enumerable: true,
      get() {
        if (parentChain?.previous === undefined) {
          return undefined;
        }

        const p = parentChain.previous.parent;
        return { name: p.name, kind: p.kind, input: p.input };
      }
    });

    Object.defineProperty(context, "response", {
      get() {
        return responseRef.current as ExecutionContext["response"];
      },
      set(value: unknown) {
        responseRef.current = value;
      },
      enumerable: true,
      configurable: true
    });

    return context;
  };

  const rootContext = createContext(undefined, undefined, undefined);
  // Attach the per-request background work pool so sequencer DSL can push
  // `.work()` / `.workIf()` / `.forEachBackground()` tasks. Each child
  // context constructed by `_withExecutionScope` re-attaches the same pool
  // explicitly (see the assignment alongside `_blockIdentity` there) — pool
  // identity is preserved across the entire request scope.
  (rootContext as { _requestWorkPool?: unknown })._requestWorkPool = requestWorkPool;
  // FIX-751: bind the live context so reactive dispatchers can run blocks
  // in-session via `executeBlock`. Set after construction since the handlers
  // (wired into the registries above) close over `reactiveCtxRef`.
  reactiveCtxRef.current = rootContext as unknown as ExecutionContext;
  // FIX-663: attach the background signal to the root context. Child scopes
  // re-attach it in `_withExecutionScope` (alongside the work pool).
  (rootContext as { _requestBackgroundSignal?: AbortSignal })._requestBackgroundSignal = options.backgroundSignal;
  // FIX-406 6H: stamp the tracing level on the root context too, for symmetry
  // with child scopes — keeps observability gating correct if a sequencer ever
  // executes directly on the root context.
  (rootContext as { _tracingLevel?: TracingLevel })._tracingLevel = options.tracingLevel;
  return rootContext;
}

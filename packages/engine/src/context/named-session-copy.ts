/**
 * A run's reach into another session's copy, `ctx.resources.at({ session })`:
 * the admission of each named session, re-checked on every later verb, and
 * the registry over its copy that reads and writes it by this flow's
 * definitions, owing the wake a write starts before the write.
 *
 * Built once per run by `createExecutionContext`, which hands it the run's
 * identity and principal, its session-scoped declarations, and the code that
 * serves the run's own copies (the lazy loaders, the per-key persisters and
 * the change handler), so a named copy is loaded and written as the run's own
 * is. The admission itself is `./named-session`.
 */
import type { JsonObject, ProjectedResourceContext, ResourceCollectionConfig, ResourceCollectionRef, ResourceConfig, ResourceRegistry, AnyResourceRef } from "@flow-state-dev/core/types";
import { isProjectedResourceCollection, matchesPattern } from "@flow-state-dev/core/types";
import { readDeliveryOrigin } from "../execution/delivery-origin";
import { noteWakeOwed } from "../durability/request-wakes";
import type { FlowRegistry } from "../registry/flow-registry";
import { isCollectionConfig } from "../resources/is-collection-config";
import { resolveOwnershipFlag, type OwnershipBuckets } from "../resources/lineage-scope";
import { ownKeyRecord } from "../resources/own-key-record";
import { DEFAULT_STALE_SWEEP_THRESHOLD_MS } from "../runtime-config";
import { resolveLineageId, resolveSessionStorageKey, sessionIncarnation } from "../stores/scope-keys";
import type { ContentScopeType, SessionRecord, StorageScopeType, StoreRegistry } from "../stores/types";
import { admitNamedSession, fenceNamedReach, SessionNotFoundError } from "./named-session";
import type { Principal } from "./principal";
import { resolveRecordOwner } from "./record-owner";
import { createScopeResourceRegistry, type ScopeLazyLoad } from "./resource-registry";
import type { CreateExecutionContextOptions } from "./types";

/**
 * How long a wake a write from another session owes waits before its turn
 * runs: the writes that land within it fold into that one turn. The same
 * spacing a board's notice gives its filer.
 */
const NAMED_WRITE_WAKE_DUE_MS = 2_000;

/** Whether a session-scoped declaration can be reached in another session (`ctx.resources.at`): a stored collection. */
function isNamedReachable(config: ResourceConfig | ResourceCollectionConfig): config is ResourceCollectionConfig {
  return isCollectionConfig(config) && !isProjectedResourceCollection(config);
}

/** The session whose copy a change handler serves, when it isn't the run's own. */
export type NamedCopyTarget = {
  /** The session written, by its id. */
  readonly sessionId: string;
  /** Its owner, for a lineage-shared key's user-topic notice. */
  readonly ownerUserId: string;
};

/**
 * Whether two reads of one session id are the same birth: by the token each
 * birth mints when both carry one, else (a record from before the token) by
 * birth time and lineage.
 */
function sameSessionIncarnation(now: SessionRecord, admitted: SessionRecord): boolean {
  if (now.incarnationToken != null && admitted.incarnationToken != null) return now.incarnationToken === admitted.incarnationToken;
  return sessionIncarnation(now) === sessionIncarnation(admitted);
}

/** Whether `now` is still the session record `admitted` was: the same incarnation, owner, org and tenant. */
function isSameSessionRecord(now: SessionRecord, admitted: SessionRecord): boolean {
  return (
    sameSessionIncarnation(now, admitted) &&
    now.userId === admitted.userId &&
    (now.orgId ?? undefined) === (admitted.orgId ?? undefined) &&
    (now.tenantId ?? undefined) === (admitted.tenantId ?? undefined)
  );
}

/**
 * One copy's cache and address: what the lazy loaders and the per-key
 * writers in `createExecutionContext` read and write. A run holds its own
 * session's, user's and org's (`ownCell` there), and one per session a block
 * names (`ctx.resources.at`), so a named session's copy is loaded and written
 * by the same code as the run's own.
 */
export type CopyCell = {
  readonly scope: ContentScopeType;
  /** Namespaces the single-flight tokens, so two copies' loads never share one. */
  readonly token: string;
  readonly stateRef: { current: Record<string, JsonObject> };
  readonly contentRef: { current: Record<string, string> };
  readonly versionRef: { current: Record<string, number> };
  readonly loadedPrefixes: Set<string>;
  readonly missing: Set<string>;
  readonly deletedState: Set<string>;
  readonly deletedContent: Set<string>;
  /** The storage `scopeId` a key routes to, by the ownership rule. */
  scopeIdOf(storageKey: string): string | undefined;
  /** The scope kind a resolved address stores under. */
  storageScopeOf(scopeId: string): StorageScopeType;
};

/** The options `createScopeResourceRegistry` takes, which a named copy's registry is built with. */
type ScopeRegistryOptions = Parameters<typeof createScopeResourceRegistry>[0];

/** What a run's named reach is built from: every field from the run itself, never a payload. */
export type NamedSessionAtInputs = {
  readonly options: Pick<CreateExecutionContextOptions, "tenantId" | "source" | "metadata" | "requestHost" | "effectiveRuntimeConfig">;
  readonly stores: Pick<StoreRegistry, "session" | "request" | "wakes">;
  /** The run's user and resolved organization. */
  readonly userId: string;
  readonly resolvedOrgId: string;
  /** The run's own session (`""` when it has none). */
  readonly sessionId: string;
  readonly noSession: boolean;
  /** The run's principal kind and resolver identity, as its door set them. */
  readonly runKind: Principal["kind"];
  readonly runResolvedBy: string | undefined;
  /** This flow's session-scoped declarations, by accessor, and every accessor's scope. */
  readonly sessionResourceConfigs: Record<string, ResourceConfig | ResourceCollectionConfig>;
  readonly accessorScope: Record<string, "session" | "user" | "org">;
  /** The ownership buckets a session key routes by. */
  readonly scopeBuckets: Pick<Record<ContentScopeType, OwnershipBuckets>, "session">;
  /** Whether the run is a view, which reaches no other session. */
  readonly inView: boolean;
  /** The run's own `ctx.resources`, which naming its own session answers with. */
  readonly flatResourcesRegistry: ResourceRegistry<Record<string, AnyResourceRef>>;
  /** The code that serves the run's own copies, handed a named copy's cell. */
  readonly makeKeyPersisters: (
    cell: CopyCell
  ) => Pick<ScopeRegistryOptions, "mutateResourceKey" | "deleteResourceKey" | "persistResourceContentKey" | "deleteResourceContentKey">;
  readonly makeLazyLoad: (cell: CopyCell) => ScopeLazyLoad | undefined;
  readonly makeResourceChangeHandler: (scope: "session", named: NamedCopyTarget) => ScopeRegistryOptions["onResourceChanged"];
  readonly recordResourceLoad: NonNullable<ScopeRegistryOptions["recordResourceLoad"]>;
  readonly templateResolverRef: NonNullable<ScopeRegistryOptions["templateResolverRef"]>;
  readonly buildProjectedResourceContext: (scope: "session", scopeId: string) => ProjectedResourceContext;
};

/**
 * `ctx.resources.at({ session })`: another session's copy of this flow's
 * session-scoped collections, by this flow's definitions. Each verb waits
 * on one admission per named session per run: the fence (`fenceNamedReach`),
 * then the routes' own admission fed this run's principal
 * (`admitNamedSession`). A refusal and an id no one holds answer every verb
 * alike, with {@link SessionNotFoundError}. Every later verb re-reads the
 * session record first: one deleted and taken again (another incarnation,
 * or another owner) is admitted again from scratch, never written under the
 * admission the first one earned.
 *
 * The admitted copy is loaded and written by the code that serves the run's
 * own (`CopyCell`): its own cache, lazily filled, and versioned writes, so
 * two sessions writing one copy conflict as two local writers do. A write
 * publishes on the named session's topics and, for a collection with a
 * `wakeEntry`, owes a wake on that session's entry before it is written.
 */
export function createNamedSessionAt(
  inputs: NamedSessionAtInputs
): (target: { readonly session: string }) => ResourceRegistry<Record<string, AnyResourceRef>> {
  const {
    options,
    stores,
    userId,
    resolvedOrgId,
    sessionId,
    noSession,
    runKind,
    runResolvedBy,
    sessionResourceConfigs,
    accessorScope,
    scopeBuckets,
    flatResourcesRegistry,
    makeKeyPersisters,
    makeLazyLoad,
    makeResourceChangeHandler,
    recordResourceLoad,
    templateResolverRef,
    buildProjectedResourceContext
  } = inputs;
  const namedPrincipal: Principal = {
    userId,
    orgId: resolvedOrgId,
    ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    kind: runKind,
    ...(runResolvedBy !== undefined ? { resolvedBy: runResolvedBy } : {})
  };
  const namedFence = { origin: readDeliveryOrigin(options.source, options.metadata), sessionId };
  type NamedCopy = { readonly record: SessionRecord; readonly registry: ResourceRegistry<Record<string, AnyResourceRef>> };
  const namedCopies = new Map<string, Promise<NamedCopy | undefined>>();
  /** Admit `target` from scratch, and keep the answer for this run's later verbs. */
  const admitCopy = (target: string): Promise<NamedCopy | undefined> => {
    const copy = (async (): Promise<NamedCopy | undefined> => {
      const flows = options.requestHost?.flows;
      if (flows === undefined || noSession) return undefined;
      const record = await admitNamedSession(
        { stores, registry: flows, hostResolver: options.effectiveRuntimeConfig?.hostResolver, principal: namedPrincipal, sessionId },
        target
      );
      return record === undefined ? undefined : { record, registry: buildNamedCopy(target, record, flows) };
    })();
    namedCopies.set(target, copy);
    return copy;
  };
  const namedCopy = async (target: string): Promise<ResourceRegistry<Record<string, AnyResourceRef>> | undefined> => {
    const kept = namedCopies.get(target);
    if (kept === undefined) return (await admitCopy(target))?.registry;
    const admitted = await kept;
    if (admitted === undefined) return undefined;
    // The record as it stands now: still the one admitted, or admitted again.
    const now = await stores.session.get(resolveSessionStorageKey(target, options.tenantId));
    if (now !== undefined && isSameSessionRecord(now, admitted.record)) return admitted.registry;
    return (await admitCopy(target))?.registry;
  };
  /** The registry over `target`'s copy, admitted as `record`, whose owning flow `flows` resolves. */
  const buildNamedCopy = (
    target: string,
    record: SessionRecord,
    flows: Pick<FlowRegistry, "get" | "list">
  ): ResourceRegistry<Record<string, AnyResourceRef>> => {
    const key = resolveSessionStorageKey(target, options.tenantId);
    const lineage = resolveLineageId({ id: key, lineageId: record.lineageId });
    const cell: CopyCell = {
      scope: "session",
      token: `session@${key}`,
      stateRef: { current: ownKeyRecord<JsonObject>() },
      contentRef: { current: ownKeyRecord<string>() },
      versionRef: { current: ownKeyRecord<number>() },
      loadedPrefixes: new Set(),
      missing: new Set(),
      deletedState: new Set(),
      deletedContent: new Set(),
      scopeIdOf: (storageKey) => (resolveOwnershipFlag(scopeBuckets.session, storageKey) === true ? lineage : key),
      storageScopeOf: (scopeId) => (scopeId === lineage ? "lineage" : "session")
    };
    // Every collection reads through the lazy loaders: nothing of this copy
    // was loaded when the run started.
    const configs = ownKeyRecord<ResourceConfig | ResourceCollectionConfig>();
    for (const [accessor, config] of Object.entries(sessionResourceConfigs)) {
      if (isNamedReachable(config)) configs[accessor] = { ...config, prefetchMode: "lazy" };
    }
    // Validated at definition: no two of these overlap with different entries.
    const wakingConfigOf = (storageKey: string): (ResourceCollectionConfig & { wakeEntry: string }) | undefined =>
      Object.values(configs).find(
        (config): config is ResourceCollectionConfig & { wakeEntry: string } =>
          isCollectionConfig(config) && config.wakeEntry !== undefined && matchesPattern(config.pattern, storageKey)
      );
    const owner = resolveRecordOwner(flows, record);
    const wakes = options.requestHost?.wakes !== undefined ? stores.wakes : undefined;
    const fenceMs = options.requestHost?.staleThresholdMs ?? DEFAULT_STALE_SWEEP_THRESHOLD_MS;
    /**
     * The turn a write at `storageKey` starts there, owed before the write, so
     * no crash or store error between the two can lose it. Its `landBy` is
     * this request's lease, as every wake a request owes: a turn that runs
     * before then and finds nothing new holds the wake there in case the write
     * is still landing. An owe that fails throws, and the write never runs. A
     * write that fails after its owe leaves a turn that reads nothing new.
     *
     * @throws When the session's flow declares no internal entry by the
     *   collection's `wakeEntry`: such a wake could never be paid.
     */
    const oweTurnBeforeWrite = async (storageKey: string): Promise<void> => {
      const config = wakingConfigOf(storageKey);
      if (config === undefined) return;
      const entry = config.wakeEntry;
      if (!owner.ok || owner.flow.internal?.actions?.[entry] === undefined) {
        throw new Error(
          `Collection "${config.pattern}" wakes "${entry}" in the session it writes, but that session's flow ` +
            `"${record.flowId ?? record.flowKind}" declares no internal entry "${entry}". Declare it there, or drop the collection's wakeEntry.`
        );
      }
      if (wakes === undefined) return;
      const now = Date.now();
      const owed = await wakes.owe({
        ...(options.tenantId !== undefined && options.tenantId.length > 0 ? { tenantId: options.tenantId } : {}),
        sessionId: target,
        entry,
        flowKind: record.flowId ?? record.flowKind,
        userId: record.userId,
        orgId: record.orgId ?? resolvedOrgId,
        dueAt: now + NAMED_WRITE_WAKE_DUE_MS,
        landBy: now + fenceMs,
        ...(runResolvedBy !== undefined ? { resolvedBy: runResolvedBy } : {})
      });
      noteWakeOwed(wakes, owed.dueAt);
    };
    const persisters = makeKeyPersisters(cell);
    /**
     * Entries whose state a delete just removed and whose content it removes
     * next: a collection entry's delete is two rows, and the one debt owed
     * before the first covers both. A second owe that failed between them
     * would leave the delete half done.
     */
    const contentDeletesOwed = new Set<string>();
    return createScopeResourceRegistry({
      orgId: resolvedOrgId,
      scope: "session",
      scopeId: key,
      cellOf: (storageKey) => cell.scopeIdOf(storageKey)!,
      configs,
      readResources: () => cell.stateRef.current,
      readResourceContent: () => cell.contentRef.current,
      ...persisters,
      mutateResourceKey: async (storageKey, mutator, opts) => {
        await oweTurnBeforeWrite(storageKey);
        return persisters.mutateResourceKey(storageKey, mutator, opts);
      },
      deleteResourceKey: async (storageKey) => {
        await oweTurnBeforeWrite(storageKey);
        const deleted = await persisters.deleteResourceKey(storageKey);
        // The registry deletes the entry's content next, when it holds some.
        if (deleted && storageKey in cell.contentRef.current) contentDeletesOwed.add(storageKey);
        return deleted;
      },
      persistResourceContentKey: async (storageKey, content) => {
        await oweTurnBeforeWrite(storageKey);
        return persisters.persistResourceContentKey(storageKey, content);
      },
      deleteResourceContentKey: async (storageKey) => {
        if (!contentDeletesOwed.delete(storageKey)) await oweTurnBeforeWrite(storageKey);
        return persisters.deleteResourceContentKey(storageKey);
      },
      onResourceChanged: makeResourceChangeHandler("session", { sessionId: target, ownerUserId: record.userId }),
      lazyLoad: makeLazyLoad(cell),
      recordResourceLoad,
      templateResolverRef,
      projectedResourceContext: buildProjectedResourceContext("session", target),
      actorUserId: userId
    });
  };
  const atSession = (target: { readonly session: string }): ResourceRegistry<Record<string, AnyResourceRef>> => {
    const named = target?.session;
    if (inputs.inView) {
      throw new Error("A view reads its own copies: `ctx.resources.at` is not available in a view.");
    }
    // The run's own session is its own copy, through the one cache it already holds.
    if (named === sessionId) return flatResourcesRegistry;
    /** The named copy, or the refusal every verb shares. */
    const open = async (): Promise<ResourceRegistry<Record<string, AnyResourceRef>>> => {
      fenceNamedReach(namedFence, named);
      const copy = typeof named === "string" ? await namedCopy(named) : undefined;
      if (copy === undefined) throw new SessionNotFoundError();
      return copy;
    };
    const handles: Record<string, AnyResourceRef> = Object.create(null);
    for (const [accessor, config] of Object.entries(sessionResourceConfigs)) {
      if (accessorScope[accessor] !== "session" || !isNamedReachable(config)) continue;
      const via = async (): Promise<ResourceCollectionRef<JsonObject>> =>
        (await open())[accessor] as ResourceCollectionRef<JsonObject>;
      handles[accessor] = {
        pattern: config.pattern,
        scope: "session",
        config,
        get: async (key) => (await via()).get(key),
        getOptional: async (key) => (await via()).getOptional(key),
        create: async (key, initial, createOptions) => (await via()).create(key, initial, createOptions),
        getOrCreate: async (key, initial) => (await via()).getOrCreate(key, initial),
        upsert: async (key, update, createOnly) => (await via()).upsert(key, update, createOnly),
        list: async (prefix) => (await via()).list(prefix),
        findBy: async (index, value) => (await via()).findBy(index, value),
        delete: async (key) => (await via()).delete(key),
        count: async () => (await via()).count()
      } satisfies ResourceCollectionRef<JsonObject>;
    }
    const resolve = (name: string): AnyResourceRef => {
      const handle = handles[name];
      if (handle !== undefined) return handle;
      if (accessorScope[name] === undefined) throw new Error(`Resource "${name}" is not registered`);
      throw new Error(
        `Resource "${name}" can't be reached in another session: \`ctx.resources.at\` reaches the session-scoped, stored collections`
      );
    };
    const copy = {
      ...handles,
      get: (name: string) => resolve(String(name)),
      list: () => Object.values(handles),
      at: atSession
    };
    // Any other accessor this flow declares refuses by property, as it does by name.
    for (const accessor of Object.keys(accessorScope)) {
      if (accessor in copy) continue;
      Object.defineProperty(copy, accessor, { enumerable: false, get: () => resolve(accessor) });
    }
    return copy as unknown as ResourceRegistry<Record<string, AnyResourceRef>>;
  };
  return atSession;
}

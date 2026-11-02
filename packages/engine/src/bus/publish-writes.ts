/**
 * The one publish point (FIX-2426): every write to the request and session
 * stores publishes a notice on its session's topic, once the write can be
 * read.
 *
 * `withChangeBus` is applied wherever a registry enters the engine:
 * `resolveStores` (so `createFlowState` and the router), `runAction`, BullMQ's
 * job processor, and `fsdev run` and `chat`. A writer handed a raw registry
 * would otherwise write unheard, and a view on a bus that crosses processes
 * would never see the change.
 *
 * ## One wrapper per store, and idempotent
 *
 * A store is wrapped once, and every entry that wraps it gets that same
 * wrapper back. The engine keys per-store bookkeeping by store identity (live
 * request attempts, interrupted endings), so two wrappers of one store, one
 * per entry, would split it in two. Wrapping a wrapper returns it; wrapping a
 * store for a second bus adds that bus to the ones its wrapper publishes to.
 * A write made on the raw store, past every entry, publishes nothing.
 *
 * ## What publishes what
 *
 * | Write | Notice |
 * |---|---|
 * | a request's items land (`persistItems`, after its batch) | `items` on the request's session |
 * | any other request write | `request` on its session, and `run` on that session's parent |
 * | any session write | `run` on the session, and on its parent |
 *
 * Not `persistEvents`, which feeds the request's own stream. A write that did
 * not land (a version conflict, a status predicate that failed) publishes
 * nothing. A failed publish never fails the write. Notices for one topic and
 * kind raised in the same microtask turn go out as one.
 */
import { createInMemoryBus } from "./in-memory-bus";
import type { BusTopic, ChangeBus, ChangeNotice } from "./types";
import type { ChangeKind } from "@flow-state-dev/core";
import type { RequestRecord, RequestStore, SessionRecord, SessionStore, StoreRegistry } from "../stores/types";
import { resolveSessionStorageKey, toBareSessionId } from "../stores/scope-keys";

type Wrapping = {
  /** Raw store → its one wrapper. */
  wrappers: WeakMap<object, object>;
  /** Wrapper → the buses it publishes to. */
  buses: WeakMap<object, ChangeBus[]>;
};

/**
 * Process-wide, under `Symbol.for`, so two copies of the engine in one
 * process (a host adapter's and the app's) share one wrapper per store.
 */
const WRAPPING: Wrapping = (() => {
  const key = Symbol.for("@flow-state-dev/engine.change-bus.wrapping");
  const holder = globalThis as { [key]?: Wrapping };
  return (holder[key] ??= { wrappers: new WeakMap(), buses: new WeakMap() });
})();

/** Wrapper → the store it wraps. */
const RAW: WeakMap<object, object> = (() => {
  const key = Symbol.for("@flow-state-dev/engine.change-bus.raw");
  const holder = globalThis as { [key]?: WeakMap<object, object> };
  return (holder[key] ??= new WeakMap());
})();

/**
 * The store a wrapper wraps, or `store` itself. Per-store bookkeeping keyed by
 * identity keys by this, so the raw store and its wrapper count as one store
 * whichever a caller holds.
 */
export function storeIdentity(store: object): object {
  return RAW.get(store) ?? store;
}

/** The buses a store's wrapper publishes to: the store's own, or its wrapper's. */
function busesOf(store: object): ChangeBus[] | undefined {
  const wrapper = WRAPPING.wrappers.get(store) ?? store;
  return WRAPPING.buses.get(wrapper);
}

/**
 * Give `stores` its bus and make its request and session writes publish to
 * it. The bus is the registry's own `bus`; else the one its stores already
 * publish to; else a new in-memory bus. Idempotent: a registry this returned
 * comes back unchanged.
 *
 * @returns The registry with `bus` set and its `request` and `session` stores
 *   wrapped: `stores` itself when nothing changed, otherwise a copy.
 */
export function withChangeBus<T extends StoreRegistry>(stores: T): T & { bus: ChangeBus } {
  const bus =
    stores.bus ?? busesOf(stores.request)?.[0] ?? busesOf(stores.session)?.[0] ?? createInMemoryBus();
  const identities = new Identities(stores.session, stores.request);
  const session = wrap(stores.session, bus, (buses) => sessionWrites(stores.session, buses, identities));
  const request = wrap(stores.request, bus, (buses) => requestWrites(stores.request, buses, identities));
  if (stores.bus === bus && session === stores.session && request === stores.request) {
    return stores as T & { bus: ChangeBus };
  }
  return { ...stores, session, request, bus };
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

let warnedPublishFailure = false;

/** Notices waiting for the end of this microtask turn, per bus, folded by topic and kind. */
const pending = new WeakMap<ChangeBus, Map<string, ChangeNotice>>();

function noticeKey(notice: ChangeNotice): string {
  const { scope, tenantId, id, resource } = notice.topic;
  return `${scope}\u0000${tenantId}\u0000${id}\u0000${resource ?? ""}\u0000${notice.kind}`;
}

/** Queue `notices` for every bus in `buses`. Never throws. */
function publish(buses: readonly ChangeBus[], notices: readonly ChangeNotice[]): void {
  for (const bus of buses) {
    let queued = pending.get(bus);
    const first = queued === undefined;
    if (queued === undefined) pending.set(bus, (queued = new Map()));
    for (const notice of notices) queued.set(noticeKey(notice), notice);
    if (!first) continue;
    queueMicrotask(() => {
      const batch = pending.get(bus);
      pending.delete(bus);
      for (const notice of batch?.values() ?? []) {
        // Best effort (epic ER-6): a notice that fails to go out costs a view
        // its wake, never the write its change.
        void Promise.resolve()
          .then(() => bus.publish(notice))
          .catch((error: unknown) => {
            if (warnedPublishFailure) return;
            warnedPublishFailure = true;
            console.warn("[flow-state] a change notice failed to publish; later failures are not logged.", error);
          });
      }
    });
  }
}

/** A session's topic under its tenant. */
function sessionTopic(id: string, tenantId: string | undefined): BusTopic {
  return { scope: "session", id, tenantId: tenantId ?? "" };
}

function notice(topic: BusTopic, kind: ChangeKind): ChangeNotice {
  return { topic, kind };
}

// ---------------------------------------------------------------------------
// Whose session a write is under
// ---------------------------------------------------------------------------

/** What a session write needs to name its topics. */
type SessionIdentity = { id: string; tenantId: string | undefined; parentSessionId: string | undefined };
/** What a request write needs to name its topic. */
type RequestIdentity = { sessionId: string | undefined; tenantId: string | undefined };

/** Most identities a store keeps before it forgets the oldest. */
const IDENTITY_CACHE_LIMIT = 10_000;

const sessionIdentities = new WeakMap<object, Map<string, SessionIdentity>>();
const requestIdentities = new WeakMap<object, Map<string, RequestIdentity>>();

function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > IDENTITY_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

function cacheOf<V>(caches: WeakMap<object, Map<string, V>>, store: object): Map<string, V> {
  let cache = caches.get(store);
  if (cache === undefined) caches.set(store, (cache = new Map()));
  return cache;
}

/**
 * Which session a stored record is under, learned from the writes that carry
 * whole records and read from the store when a write names only an id. A
 * record's session never changes under one id, so each is read at most once
 * per process while it stays cached.
 */
class Identities {
  constructor(
    private readonly sessions: SessionStore,
    private readonly requests: RequestStore
  ) {}

  rememberSession(storageKey: string, record: SessionRecord): SessionIdentity {
    const identity: SessionIdentity = {
      id: toBareSessionId(storageKey, record.tenantId),
      tenantId: record.tenantId,
      parentSessionId: record.parentSessionId ?? undefined
    };
    remember(cacheOf(sessionIdentities, this.sessions), storageKey, identity);
    return identity;
  }

  forgetSession(storageKey: string): void {
    cacheOf(sessionIdentities, this.sessions).delete(storageKey);
  }

  async session(storageKey: string): Promise<SessionIdentity | undefined> {
    const cached = cacheOf(sessionIdentities, this.sessions).get(storageKey);
    if (cached !== undefined) return cached;
    const record = await this.sessions.get(storageKey).catch(() => undefined);
    return record === undefined ? undefined : this.rememberSession(storageKey, record);
  }

  rememberRequest(id: string, record: RequestRecord): RequestIdentity {
    const identity: RequestIdentity = { sessionId: record.sessionId ?? undefined, tenantId: record.tenantId ?? undefined };
    remember(cacheOf(requestIdentities, this.requests), id, identity);
    return identity;
  }

  forgetRequest(id: string): void {
    cacheOf(requestIdentities, this.requests).delete(id);
  }

  async request(id: string): Promise<RequestIdentity | undefined> {
    const cached = cacheOf(requestIdentities, this.requests).get(id);
    if (cached !== undefined) return cached;
    const record = await this.requests.get(id).catch(() => undefined);
    return record === undefined ? undefined : this.rememberRequest(id, record);
  }

  /** A session's topic, and its parent's when it is a run, each with `kind`. */
  sessionNotices(identity: SessionIdentity, kind: ChangeKind): ChangeNotice[] {
    const notices = [notice(sessionTopic(identity.id, identity.tenantId), kind)];
    if (identity.parentSessionId !== undefined) {
      notices.push(notice(sessionTopic(identity.parentSessionId, identity.tenantId), "run"));
    }
    return notices;
  }

  /**
   * A request write's notices: `kind` on its session, and `run` on that
   * session's parent when the session is a run (the parent's view lists its
   * runs by their requests' status). `items` skip the parent: they move no
   * run's status.
   */
  async requestNotices(identity: RequestIdentity | undefined, kind: ChangeKind): Promise<ChangeNotice[]> {
    if (identity?.sessionId === undefined) return [];
    const notices = [notice(sessionTopic(identity.sessionId, identity.tenantId), kind)];
    if (kind === "items") return notices;
    const session = await this.session(resolveSessionStorageKey(identity.sessionId, identity.tenantId));
    if (session?.parentSessionId !== undefined) {
      notices.push(notice(sessionTopic(session.parentSessionId, identity.tenantId), "run"));
    }
    return notices;
  }
}

// ---------------------------------------------------------------------------
// Wrapping the stores
// ---------------------------------------------------------------------------

type AnyMethod = (...args: any[]) => any;
type Writes = Record<string, AnyMethod>;

/**
 * `store`'s one wrapper, publishing to `bus` among others: made on the first
 * call from `writes`, the methods it replaces; every other property reads
 * through to the store.
 */
function wrap<S extends object>(store: S, bus: ChangeBus, writes: (buses: ChangeBus[]) => Writes): S {
  const known = WRAPPING.buses.has(store) ? store : (WRAPPING.wrappers.get(store) as S | undefined);
  if (known !== undefined) {
    const buses = WRAPPING.buses.get(known)!;
    if (!buses.includes(bus)) buses.push(bus);
    return known;
  }
  const buses = [bus];
  const replaced = writes(buses);
  const isReplaced = (key: string | symbol): key is string =>
    typeof key === "string" && Object.prototype.hasOwnProperty.call(replaced, key);
  // A method assigned on the wrapper (an instrumented call, a test's race)
  // stands in for the wrapper's own, which it may call; assigned on the store
  // it would be what the wrapper's own calls, and calling that back would
  // never end.
  const assigned: Record<string, unknown> = {};
  const wrapper = new Proxy(store, {
    get(target, key) {
      if (isReplaced(key)) return Object.prototype.hasOwnProperty.call(assigned, key) ? assigned[key] : replaced[key];
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? (value as AnyMethod).bind(target) : value;
    },
    set(target, key, value) {
      if (!isReplaced(key)) return Reflect.set(target, key, value, target);
      if (value === replaced[key]) delete assigned[key];
      else assigned[key] = value;
      return true;
    }
  });
  WRAPPING.wrappers.set(store, wrapper);
  WRAPPING.buses.set(wrapper, buses);
  RAW.set(wrapper, store);
  return wrapper;
}

/**
 * `writes`, keeping only the methods `store` has. Each calls the store's
 * method as it is at call time, not as it was when wrapped, so a method the
 * store's owner replaces later (a test's spy, an instrumented adapter) still
 * runs.
 */
function present(store: object, writes: Record<string, (original: AnyMethod) => AnyMethod>): Writes {
  const out: Writes = {};
  for (const [name, build] of Object.entries(writes)) {
    if (typeof (store as Record<string, unknown>)[name] !== "function") continue;
    out[name] = build((...args: unknown[]) => ((store as Record<string, AnyMethod>)[name] as AnyMethod).apply(store, args));
  }
  return out;
}

const DELTA_METHODS = ["patchField", "incField", "pushToArray", "deleteField"] as const;

function sessionWrites(store: SessionStore, buses: ChangeBus[], identities: Identities): Writes {
  const delta = (original: AnyMethod) => async (id: string, ...rest: unknown[]) => {
    const result = await original(id, ...rest);
    if (result?.ok !== true) return result;
    const identity =
      result.record !== undefined ? identities.rememberSession(id, result.record) : await identities.session(id);
    if (identity !== undefined) publish(buses, identities.sessionNotices(identity, "run"));
    return result;
  };

  return present(store, {
    set: (original) => async (id: string, value: SessionRecord, expected: unknown) => {
      const result = await original(id, value, expected);
      if (result?.ok === true) publish(buses, identities.sessionNotices(identities.rememberSession(id, value), "run"));
      return result;
    },
    delete: (original) => async (id: string) => {
      const identity = await identities.session(id);
      await original(id);
      identities.forgetSession(id);
      if (identity !== undefined) publish(buses, identities.sessionNotices(identity, "run"));
    },
    ...Object.fromEntries(DELTA_METHODS.map((name) => [name, delta]))
  });
}

function requestWrites(store: RequestStore, buses: ChangeBus[], identities: Identities): Writes {
  const after = (identity: RequestIdentity | undefined, kind: ChangeKind): void => {
    void identities
      .requestNotices(identity, kind)
      .then((notices) => publish(buses, notices))
      .catch(() => {});
  };
  const delta = (original: AnyMethod) => async (id: string, ...rest: unknown[]) => {
    const result = await original(id, ...rest);
    if (result?.ok !== true) return result;
    after(result.record !== undefined ? identities.rememberRequest(id, result.record) : await identities.request(id), "request");
    return result;
  };
  const flushItems = (requestId: string): Promise<void> => store.flushItems(requestId);

  return present(store, {
    set: (original) => async (id: string, value: RequestRecord, expected: unknown) => {
      const result = await original(id, value, expected);
      if (result?.ok === true) after(identities.rememberRequest(id, value), "request");
      return result;
    },
    delete: (original) => async (id: string) => {
      const identity = await identities.request(id);
      await original(id);
      identities.forgetRequest(id);
      after(identity, "request");
    },
    deleteIfStatus: (original) => async (id: string, ...rest: unknown[]) => {
      const identity = await identities.request(id);
      const result = await original(id, ...rest);
      if (result?.applied === true) {
        identities.forgetRequest(id);
        after(identity, "request");
      }
      return result;
    },
    setFieldsIfStatus: (original) => async (id: string, ...rest: unknown[]) => {
      const result = await original(id, ...rest);
      if (result?.applied === true) after(await identities.request(id), "request");
      return result;
    },
    ...Object.fromEntries(DELTA_METHODS.map((name) => [name, delta])),
    // Buffered: the notice waits for the batch these items join to land, so a
    // view it wakes reads them. A batch that fails to land publishes nothing.
    persistItems: (original) => (requestId: string, items: unknown[]) => {
      original(requestId, items);
      void flushItems(requestId)
        .then(() => identities.request(requestId))
        .then((identity: RequestIdentity | undefined) => after(identity, "items"))
        .catch(() => {});
    }
  });
}

// FIX-2426.
/**
 * The one publish point: every write to the request and session
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
 * per entry, would split it in two. Wrapping a wrapper returns it. A wrapped
 * store publishes to one bus: an entry that brings a different bus for it is
 * refused, since the views on one of the two would miss its writes. A write
 * made on the raw store, past every entry, publishes nothing.
 *
 * ## What publishes what
 *
 * | Write | Notice |
 * |---|---|
 * | a request's items land (`persistItems`, after its batch) | `items` on the request's session |
 * | a request's state field delta (`patchField`, `incField`, `pushToArray`, `deleteField`) | `request` on its session, and `run` on that session's parent |
 * | any other request write | the same, and `run` on its owner's user topic |
 * | a session's state field delta | `run` on the session and on its parent |
 * | any other session write | the same, and `run` on its owner's user topic |
 *
 * The user topic is what a list of the user's sessions watches: it hears a
 * session made, titled or deleted and a request's status written, not the
 * state writes a busy turn makes many of.
 *
 * A task board's change (`board`, narrowed to the board) is not a store write
 * here: orchestration names it through the board-notice seam (`board-notice.ts`).
 *
 * Not `persistEvents`, which feeds the request's own stream. A write that did
 * not land (a version conflict, a status predicate that failed) publishes
 * nothing. A failed publish never fails the write. Notices for one topic and
 * kind raised in the same microtask turn go out as one, at the end of that
 * turn: the one deferral between a write and the bus.
 */
import { createInMemoryBus } from "./in-memory-bus";
import { DEFAULT_RUNTIME_LOGGER } from "../execution/logging";
import { FlowStateConfigError } from "../errors/flow-error";
import type { BusTopic, ChangeBus, ChangeNotice } from "./types";
import { unionNoticeIds, type ChangeKind } from "@flow-state-dev/core/internal";
import type { RequestRecord, RequestStore, SessionRecord, SessionStore, StoreRegistry } from "../stores/types";
import { resolveSessionStorageKey, toBareSessionId } from "../stores/scope-keys";

type Wrapping = {
  /** Raw store → its one wrapper. */
  wrappers: WeakMap<object, object>;
  /** Wrapper → the bus it publishes to. */
  buses: WeakMap<object, ChangeBus>;
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

/** The bus a store's wrapper publishes to: the store's own, or its wrapper's. */
function busOf(store: object): ChangeBus | undefined {
  const wrapper = WRAPPING.wrappers.get(store) ?? store;
  return WRAPPING.buses.get(wrapper);
}

/**
 * Give `stores` its bus and make its request and session writes publish to
 * it. The bus is the registry's own `bus`; else the one its stores already
 * publish to; else a new in-memory bus. Idempotent: a registry this returned
 * comes back unchanged.
 *
 * @throws FlowStateConfigError when the registry's `bus` differs from the one
 *   its stores already publish to.
 * @returns The registry with `bus` set and its `request` and `session` stores
 *   wrapped: `stores` itself when nothing changed, otherwise a copy.
 */
export function withChangeBus<T extends StoreRegistry>(stores: T): T & { bus: ChangeBus } {
  const bus = stores.bus ?? busOf(stores.request) ?? busOf(stores.session) ?? createInMemoryBus();
  const identities = new Identities(stores.session, stores.request);
  const session = wrap(stores.session, bus, () => sessionWrites(stores.session, bus, identities));
  const request = wrap(stores.request, bus, () => requestWrites(stores.request, bus, identities));
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

/**
 * The fold key: topic, kind and origin. Two requests' notices stay two, so
 * each writer's view skips only its own and hears the other's.
 */
function noticeKey(notice: ChangeNotice): string {
  const { scope, tenantId, id, resource } = notice.topic;
  return `${scope}\u0000${tenantId}\u0000${id}\u0000${resource ?? ""}\u0000${notice.kind}\u0000${notice.origin?.requestId ?? ""}`;
}

// FIX-2625.
/**
 * `next` folded onto the notice `held` for the same topic, kind and origin:
 * the ids of both, unioned up to the cap, or none when either names none.
 */
function fold(held: ChangeNotice | undefined, next: ChangeNotice): ChangeNotice {
  const ids = next.ids === undefined ? undefined : unionNoticeIds(held === undefined ? [] : held.ids, next.ids);
  const { ids: _named, ...notice } = next;
  return ids === undefined ? notice : { ...notice, ids };
}

// FIX-1506.
/**
 * Queue `notices` for `bus`, to go out at the end of this microtask turn,
 * folded by topic, kind and origin, their ids unioned (`fold`). Never throws, and a failed publish never
 * fails the write that raised it. Every publisher goes through this one:
 * the request and session store wrappers here, and the run's resource and
 * scope-state seams and the client's resource routes, and the
 * board-notice seam.
 */
export function publishNotices(bus: ChangeBus, notices: readonly ChangeNotice[]): void {
  let queued = pending.get(bus);
  const first = queued === undefined;
  if (queued === undefined) pending.set(bus, (queued = new Map()));
  for (const notice of notices) {
    const key = noticeKey(notice);
    queued.set(key, fold(queued.get(key), notice));
  }
  if (!first) return;
  queueMicrotask(() => {
    const batch = pending.get(bus);
    pending.delete(bus);
    for (const notice of batch?.values() ?? []) {
      // Best effort (epic ER-6): a notice that fails to go out costs a view
      // its wake, never the write its change.
      try {
        bus.publish(notice).catch(warnPublishFailure);
      } catch (error) {
        warnPublishFailure(error);
      }
    }
  });
}

function warnPublishFailure(error: unknown): void {
  if (warnedPublishFailure) return;
  warnedPublishFailure = true;
  console.warn("[flow-state] a change notice failed to publish; later failures are not logged.", error);
}

/**
 * A notice that could not be put together (the read naming a write's session
 * failed) costs a view its wake: not worth a warning, as a failed publish is,
 * but not silent either.
 */
function debugUnassembled(error: unknown, write: { store: "request" | "session"; id: string }): void {
  DEFAULT_RUNTIME_LOGGER.debug?.("[flow-state] a change notice could not be assembled; no view hears this write.", {
    ...write,
    error
  });
}

/** A session's topic under its tenant. */
function sessionTopic(id: string, tenantId: string | undefined): BusTopic {
  return { scope: "session", id, tenantId: tenantId ?? "" };
}

/**
 * A user's topic under its tenant: a session's owner, which hears `run` for
 * every write to one of its sessions, as a parent hears its runs.
 * The id is the bare user id, as the push socket names a caller's user topic.
 */
function userTopic(userId: string, tenantId: string | undefined): BusTopic {
  return { scope: "user", id: userId, tenantId: tenantId ?? "" };
}

function notice(topic: BusTopic, kind: ChangeKind, id?: string): ChangeNotice {
  return id === undefined ? { topic, kind } : { topic, kind, ids: [id] };
}

// ---------------------------------------------------------------------------
// Whose session a write is under
// ---------------------------------------------------------------------------

/** What a session write needs to name its topics. */
type SessionIdentity = {
  id: string;
  tenantId: string | undefined;
  parentSessionId: string | undefined;
  /** The owner, whose user topic hears every change to the session. */
  userId: string | undefined;
};
/** What a request write needs to name its topics. */
type RequestIdentity = {
  requestId: string;
  sessionId: string | undefined;
  tenantId: string | undefined;
  userId: string | undefined;
};

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
      parentSessionId: record.parentSessionId ?? undefined,
      userId: record.userId ?? undefined
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
    const record = await this.sessions.get(storageKey).catch((error: unknown) => {
      debugUnassembled(error, { store: "session", id: storageKey });
      return undefined;
    });
    return record === undefined ? undefined : this.rememberSession(storageKey, record);
  }

  rememberRequest(id: string, record: RequestRecord): RequestIdentity {
    const identity: RequestIdentity = {
      requestId: id,
      sessionId: record.sessionId ?? undefined,
      tenantId: record.tenantId ?? undefined,
      userId: record.userId ?? undefined
    };
    remember(cacheOf(requestIdentities, this.requests), id, identity);
    return identity;
  }

  forgetRequest(id: string): void {
    cacheOf(requestIdentities, this.requests).delete(id);
  }

  async request(id: string): Promise<RequestIdentity | undefined> {
    const cached = cacheOf(requestIdentities, this.requests).get(id);
    if (cached !== undefined) return cached;
    const record = await this.requests.get(id).catch((error: unknown) => {
      debugUnassembled(error, { store: "request", id });
      return undefined;
    });
    return record === undefined ? undefined : this.rememberRequest(id, record);
  }

  /**
   * A session's topic, its parent's when it is a run, and its owner's user
   * topic: `kind` on the first, `run` on the others. `toOwner: false` (a
   * state field's delta) skips the user topic: it changes nothing a list of
   * sessions shows, and a busy turn writes many.
   */
  sessionNotices(identity: SessionIdentity, kind: ChangeKind, toOwner = true): ChangeNotice[] {
    // The session's own topic is that one session: it names nothing. Its
    // parent's names it (FIX-2625). Its owner's user topic names nothing: that
    // topic is the user's in every org, so an id there would reach their
    // screens in another org.
    const notices = [notice(sessionTopic(identity.id, identity.tenantId), kind)];
    if (identity.parentSessionId !== undefined) {
      notices.push(notice(sessionTopic(identity.parentSessionId, identity.tenantId), "run", identity.id));
    }
    if (toOwner && identity.userId !== undefined) notices.push(notice(userTopic(identity.userId, identity.tenantId), "run"));
    return notices;
  }

  /**
   * A request write's notices: `kind` on its session, and `run` on that
   * session's parent when the session is a run (the parent's view lists its
   * runs by their requests' status) and on the owner's user topic (a list of
   * the user's sessions shows each one's latest request). `items` skip both:
   * they move no request's status. `toOwner: false` (a state field's delta)
   * skips the user topic alone: the parent's view still hears it.
   */
  async requestNotices(
    identity: RequestIdentity | undefined,
    kind: ChangeKind,
    toOwner = true
  ): Promise<ChangeNotice[]> {
    if (identity?.sessionId === undefined) return [];
    // `items` name nothing: the session stream reads from its sequence number.
    if (kind === "items") return [notice(sessionTopic(identity.sessionId, identity.tenantId), kind)];
    // The request on its session's notice, the session on its parent's
    // (FIX-2625); nothing on its owner's user topic, which spans their orgs.
    const notices = [notice(sessionTopic(identity.sessionId, identity.tenantId), kind, identity.requestId)];
    if (toOwner && identity.userId !== undefined) notices.push(notice(userTopic(identity.userId, identity.tenantId), "run"));
    const session = await this.session(resolveSessionStorageKey(identity.sessionId, identity.tenantId));
    if (session?.parentSessionId !== undefined) {
      notices.push(notice(sessionTopic(session.parentSessionId, identity.tenantId), "run", identity.sessionId));
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
 * `store`'s one wrapper, publishing to `bus`: made on the first call from
 * `writes`, the methods it replaces; every other property reads through to
 * the store.
 */
function wrap<S extends object>(store: S, bus: ChangeBus, writes: () => Writes): S {
  const known = WRAPPING.buses.has(store) ? store : (WRAPPING.wrappers.get(store) as S | undefined);
  if (known !== undefined) {
    if (WRAPPING.buses.get(known) !== bus) {
      throw new FlowStateConfigError(
        "These stores already publish their changes to another bus. A store publishes to one bus: " +
          "resolve the stores once with the bus you want, and hand that registry to every entry."
      );
    }
    return known;
  }
  const replaced = writes();
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
  WRAPPING.buses.set(wrapper, bus);
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

function sessionWrites(store: SessionStore, bus: ChangeBus, identities: Identities): Writes {
  const delta = (original: AnyMethod) => async (id: string, ...rest: unknown[]) => {
    const result = await original(id, ...rest);
    if (result?.ok !== true) return result;
    const identity =
      result.record !== undefined ? identities.rememberSession(id, result.record) : await identities.session(id);
    if (identity !== undefined) publishNotices(bus, identities.sessionNotices(identity, "run", false));
    return result;
  };

  return present(store, {
    set: (original) => async (id: string, value: SessionRecord, expected: unknown) => {
      const result = await original(id, value, expected);
      if (result?.ok === true) publishNotices(bus, identities.sessionNotices(identities.rememberSession(id, value), "run"));
      return result;
    },
    delete: (original) => async (id: string) => {
      const identity = await identities.session(id);
      await original(id);
      identities.forgetSession(id);
      if (identity !== undefined) publishNotices(bus, identities.sessionNotices(identity, "run"));
    },
    ...Object.fromEntries(DELTA_METHODS.map((name) => [name, delta]))
  });
}

function requestWrites(store: RequestStore, bus: ChangeBus, identities: Identities): Writes {
  const after = (identity: RequestIdentity | undefined, kind: ChangeKind, toOwner = true): void => {
    void identities
      .requestNotices(identity, kind, toOwner)
      .then((notices) => publishNotices(bus, notices))
      .catch((error: unknown) => debugUnassembled(error, { store: "session", id: identity?.sessionId ?? "" }));
  };
  const delta = (original: AnyMethod) => async (id: string, ...rest: unknown[]) => {
    const result = await original(id, ...rest);
    if (result?.ok !== true) return result;
    after(
      result.record !== undefined ? identities.rememberRequest(id, result.record) : await identities.request(id),
      "request",
      false
    );
    return result;
  };
  const flushItems = (requestId: string): Promise<void> => store.flushItems(requestId);
  // The wrapper's own flush, which only times the notice, must not use up a
  // write failure the store reports once: an adapter that throws and clears
  // it (the filesystem store) would otherwise hand the next explicit flush a
  // success. The failure it hears is kept here and given to that flush.
  const background = new Map<string, Promise<boolean>>();
  const failures = new Map<string, unknown>();
  const forget = (id: string): void => {
    failures.delete(id);
  };

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
      // The store drops a failure it hasn't reported with the request; so does this.
      forget(id);
      after(identity, "request");
    },
    deleteIfStatus: (original) => async (id: string, ...rest: unknown[]) => {
      const identity = await identities.request(id);
      const result = await original(id, ...rest);
      if (result?.applied === true) {
        identities.forgetRequest(id);
        forget(id);
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
      const landed = flushItems(requestId).then(
        () => true,
        (error: unknown) => {
          failures.set(requestId, error);
          return false;
        }
      );
      background.set(requestId, landed);
      void landed.then(async (ok) => {
        if (background.get(requestId) === landed) background.delete(requestId);
        if (ok) after(await identities.request(requestId), "items");
      }).catch((error: unknown) => debugUnassembled(error, { store: "request", id: requestId }));
    },
    // A failed write rejects the flush a caller waits on, as the store's own
    // does, though the wrapper's background flush heard it first.
    flushItems: (original) => async (requestId: string) => {
      let failed: { error: unknown } | undefined;
      try {
        await original(requestId);
      } catch (error) {
        failed = { error };
      }
      await background.get(requestId);
      if (failures.has(requestId)) {
        const held = failures.get(requestId);
        failures.delete(requestId);
        failed ??= { error: held };
      }
      if (failed !== undefined) throw failed.error;
    }
  });
}

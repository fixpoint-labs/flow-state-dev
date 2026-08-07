import type {
  JournalEntry,
  RequestStatus,
  SequencerCheckpoint,
  SuspensionFilter,
  SuspensionRecord
} from "@flow-state-dev/core/types";
import type { JsonObject } from "@flow-state-dev/core/types";
import type {
  BlockTraceItem,
  OutputItem,
  RequestStreamEvent,
  RouterDecisionItem,
  StateSnapshotItem
} from "@flow-state-dev/core/items";
import type { Lease, LeaseOptions } from "../durability/types";

export type { RequestStatus };

export type ScopeRecordBase<TState extends JsonObject = JsonObject> = {
  id: string;
  state: TState;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type SessionRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  flowKind: string;
  userId: string;
  orgId?: string;
  /**
   * Bare tenant id this session belongs to (FIX-682). The session record's
   * `id` is already tenant-namespaced (`${tenantId}:${sessionId}`); this field
   * keeps the bare tenant for cross-reference and `SessionListOptions.tenantId`
   * filtering. Undefined for single-tenant sessions.
   */
  tenantId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  resources?: Record<string, JsonObject>;
  metadata?: Record<string, unknown>;
  latestRequestId?: string;
  journal: JournalEntry[];
};

export type RequestRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  flowKind: string;
  actionName: string;
  userId: string;
  sessionId?: string;
  orgId?: string;
  /**
   * Bare tenant id this request ran under (FIX-682). `sessionId` stays bare;
   * isolation of cross-turn history comes from filtering `request.list` by
   * (`sessionId`, `tenantId`) rather than from namespacing the `sessionId`
   * field — which keeps request recovery a clean pass-through. Undefined for
   * single-tenant requests.
   */
  tenantId?: string;
  /**
   * Provenance of the inbound transport that produced this request.
   * Set from `InboundRequestEnvelope.source` (FIX-438). Open string —
   * documented known-set: `http` | `mcp` | `webhook` | `scheduled` |
   * `notification`. Reads of records persisted before this field existed
   * default to `"http"` in the store implementations.
   */
  source: string;
  status: RequestStatus;
  startedAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
  input?: unknown;
  /**
   * Output items produced by this request. Adapters that store items
   * separately may leave this `undefined` on `list()` results unless
   * `RequestListOptions.withItems` is true.
   */
  items?: OutputItem[];
  interruptedAt?: number;
  abortRequested?: boolean;
  abortedAt?: number;
};

export type UserRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  userId: string;
  resources?: Record<string, JsonObject>;
};

export type OrgRecord<TState extends JsonObject = JsonObject> = ScopeRecordBase<TState> & {
  orgId: string;
  userId?: string;
  resources?: Record<string, JsonObject>;
};

export type SessionListOptions = {
  flowKind?: string;
  userId?: string;
  /**
   * Tenant filter (FIX-682). See {@link RequestListOptions.tenantId} for the
   * present-vs-absent exact-match semantics — they are identical here.
   */
  tenantId?: string;
  limit?: number;
  offset?: number;
};

export type RequestListOptions = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  /**
   * Tenant filter (FIX-682). Exact-match isolation with deliberate
   * present-vs-absent semantics, because tenant records and no-tenant records
   * can share a bare `sessionId`:
   * - When the `tenantId` key is **present on the options object** (including an
   *   explicit `undefined`), the store exact-matches it — `undefined` matches
   *   only records with no tenant. This is what isolates cross-turn history.
   * - When the key is **absent**, no tenant filtering is applied (admin/debug
   *   "list everything" callers keep working).
   *
   * `createExecutionContext` and the tenant-isolated routes always pass the key
   * (carrying the current request's tenant, possibly `undefined`).
   */
  tenantId?: string;
  status?: RequestStatus;
  limit?: number;
  offset?: number;
  /**
   * Sort key for the returned (and limited) set, descending. `"updatedAt"`
   * (default) preserves prior behavior. `"startedAtMs"` orders by request
   * start time so a `limit`-windowed read selects the most-recently-started
   * requests regardless of later out-of-order metadata writes. Adapters that
   * persist `startedAtMs` only inside the record blob order by the equivalent
   * `created_at` column (set to `startedAtMs` at creation, never mutated).
   */
  orderBy?: "startedAtMs" | "updatedAt";
  /**
   * If true, populate `record.items` for each returned record. Default
   * false. Adapters that store items separately (Postgres) avoid an
   * extra query per list when this is false; adapters that store items
   * inline ignore the flag.
   */
  withItems?: boolean;
};

export type UserListOptions = {
  limit?: number;
  offset?: number;
};

export type OrgListOptions = {
  userId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Indicates the expected pre-update version for a CAS write.
 * - A number means "only write if the current stored version equals this"
 * - "any" means "write unconditionally" (used for creates, migrations, and
 *   system writes that fall outside the CAS retry loop)
 * - "absent" means "only write if no record exists at this id" — create-if-
 *   absent. An existing record at **any** version, including `0`, is a
 *   conflict carrying that record.
 *
 * ## `"absent"` is a distinct sentinel, not a re-use of `0`
 *
 * This union is shared by two store families that mean different things by
 * `0`, so create-if-absent needs a spelling that cannot be confused with a
 * version:
 *
 *  - **Scope stores** (`SessionStore`, `RequestStore`, `UserStore`,
 *    `OrgStore`) create records **at version `0`**, so `0` is a real, live
 *    version there and a stored v0 record is live rather than absent.
 *    `expectedVersion: 0` means "the stored version is exactly 0."
 *  - **`ResourceStateStore`** starts its versions at `1`, which leaves its
 *    `0` free to mean "no live row" — create-if-absent, satisfied by a
 *    tombstone as well as a never-existed key.
 *
 * Because the scope stores' `0` is taken, create-if-absent could not be
 * ported to them as a number. `"absent"` means the same thing in both
 * families and collides with neither. `ResourceStateStore` **refuses** it
 * (`assertExpectedVersion`) rather than aliasing it onto its `0`, so
 * `"absent"` never acquires a second, verb-dependent meaning on the resource
 * side's delete predicate.
 *
 * Two consequences for anyone branching on this type:
 *  - `expectedVersion !== "any"` no longer implies `typeof === "number"`.
 *    Narrow with `typeof expectedVersion === "number"` wherever the body
 *    does arithmetic or binds the value to a SQL parameter.
 *  - The CAS delta verbs read-modify-write an existing record, so `"absent"`
 *    is meaningless there and **throws** rather than conflicting.
 */
export type ExpectedVersion = number | "any" | "absent";

/**
 * Outcome of a CAS-aware `Store.set`. Encodes conflict as data rather than
 * throwing so retry loops stay on the hot path. On conflict the store returns
 * the current value and version so the caller can refresh its cache and
 * re-apply the mutator.
 */
export type SetResult<TRecord> =
  | { ok: true; version: number; record?: TRecord }
  | {
      ok: false;
      conflict: { currentValue: TRecord | undefined; currentVersion: number };
    };

/**
 * Optional CAS-aware delta verbs adapters may implement to avoid full-record
 * UPDATEs on single-field scope-state writes. All verbs target the record's
 * `state` slice — `path` is a key sequence (`["count"]`, `["foo", "bar"]`)
 * relative to `state`, not to the record root.
 *
 * Adapters MAY implement none, some, or all of these. The CAS persist
 * callback feature-detects per call and falls back to `set` with the full
 * record when a verb is absent (capability advertisement). Once FIX-85
 * (Upstash) and FIX-83 (Mongo) ship, those adapters implement the verbs as
 * required — the optional-in-v1 stance is a migration concession to existing
 * SQLite and filesystem adapters.
 *
 * Concurrency contract is identical to `set`: the write applies only when
 * the current stored version equals `expectedVersion` (or always when
 * `"any"`). Returns the new version on success, or the current record/
 * version on conflict.
 *
 * One exception: every verb here read-modify-writes an **existing** record,
 * so `expectedVersion: "absent"` is meaningless and **throws** rather than
 * conflicting. A conflict would send the caller into a retry loop that can
 * never converge; a throw names the programming error at the call site.
 * `set(id, record, "absent")` is how a record is created.
 *
 * `updatedAt` is caller-supplied (matching `set`, where it travels inside
 * the record). Adapters MUST write it as given so the caller's local cache
 * of the record stays consistent with what's persisted.
 */
export interface DeltaStoreOps<TRecord> {
  /**
   * Replace the value at `path` inside the record's `state` slice. Equivalent
   * to a shallow merge of `{ [path[0]]: value }` into `state` for depth-1
   * paths. The remainder of the record (other state fields, metadata,
   * top-level columns) is preserved unchanged.
   */
  patchField?(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;

  /**
   * Atomically add `delta` to the numeric value at `path` inside `state`.
   * Treats a missing or non-numeric value as `0`. Other record fields are
   * preserved unchanged.
   */
  incField?(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;

  /**
   * Append `values` (in order) to the array at `path` inside `state`. Treats
   * a missing value as an empty array; throws via the adapter's normal error
   * surface if the existing value is non-array. Other record fields are
   * preserved unchanged.
   */
  pushToArray?(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;

  /**
   * Remove the value at `path` inside the record's `state` slice. For a
   * depth-2 path `["field", "key"]` this deletes `state.field.key`, leaving
   * sibling keys intact. A missing key is a no-op (version still bumps).
   */
  deleteField?(
    id: string,
    path: string[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<TRecord>>;
}

export interface SessionStore extends DeltaStoreOps<SessionRecord> {
  get(id: string): Promise<SessionRecord | undefined>;
  /**
   * Write `value` when the stored record's version matches `expectedVersion`.
   * Returns the new version on success or the current stored value/version on
   * conflict. The `version` field on `value` is the NEW version to persist.
   *
   * `expectedVersion` accepts three things, and the scope stores' reading of
   * `0` is the one that differs from `ResourceStateStore` (see
   * {@link ExpectedVersion}):
   *
   * | Value | Writes when |
   * |---|---|
   * | `"any"` | Always. Last write wins |
   * | a number | The stored version equals it. **`0` means "stored at version 0"** — scope records are *created* at `0`, so a v0 record is live, not absent |
   * | `"absent"` | No record exists at this id. An existing record at any version, `0` included, is a conflict carrying it |
   *
   * `"absent"` is how a caller wins or loses a create race rather than
   * silently overwriting: a `get`-then-`set` cannot, because nothing stops a
   * second writer between the two calls.
   *
   * `delete` is a hard delete with no tombstone, so a recreated id may reuse
   * versions. An observer holding a pre-delete version can therefore match
   * the record that replaces it — stated rather than defended, and the reason
   * this store's versions are not a substitute for identity.
   */
  set(
    id: string,
    value: SessionRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<SessionRecord>>;
  delete(id: string): Promise<void>;
  list(options?: SessionListOptions): Promise<SessionRecord[]>;
}

export interface RequestStore extends DeltaStoreOps<RequestRecord> {
  get(id: string): Promise<RequestRecord | undefined>;
  /** See `SessionStore.set` for CAS semantics. */
  set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>>;
  delete(id: string): Promise<void>;
  list(options?: RequestListOptions): Promise<RequestRecord[]>;

  /**
   * Persist the current items for an in-progress request.
   * Non-blocking from the caller's perspective — the backend handles async flushing.
   * Callers should call flushItems() before writing terminal status.
   *
   * Merge-by-id contract (FIX-811): persisting items MUST union the supplied
   * items into the stored set by `id` (last-write-wins per id), never replacing
   * the full set. Order is preserved — existing items keep their position, new
   * ids append. This lets a same-request continuation (suspend → resume under
   * the same id) persist only its post-resume items while a `get` still returns
   * the full pause→continue history. The in-memory adapter's no-op satisfies
   * this trivially (items live on the record); persistent adapters UPSERT.
   *
   * Content-update contract (FIX-839): "last-write-wins per id" is by item
   * CONTENT, not object reference. The runtime mutates a single item object in
   * place across its lifecycle (e.g. a block_trace `in_progress → completed`),
   * so an adapter that diffs incrementally by object reference would drop the
   * later write and leave stale content persisted — defeating resume
   * memoization. Re-persisting an id whose fields changed MUST write the
   * latest content. Enforced by the cross-store conformance suite.
   */
  persistItems(requestId: string, items: OutputItem[]): void;

  /**
   * Wait for all pending item persistence writes to complete.
   * Called before the terminal patchRequestRecord.
   */
  flushItems(requestId: string): Promise<void>;

  /**
   * Count the items persisted for a request without materializing them.
   * Matches what `get(id)` would surface as `items.length` — including the
   * legacy dual-read union of pre-migration blob items with child-table
   * rows — but adapters with a dedicated items table answer with an indexed
   * COUNT instead of loading item payloads (FIX-685). Returns 0 for an
   * unknown request. Reflects flushed writes only; callers that just
   * persisted items should `flushItems` first.
   */
  countItems(requestId: string): Promise<number>;

  /**
   * Persist a stream event for a request.
   * Non-blocking — the backend handles async flushing.
   * Events are stored in sequence order for cursor-based replay.
   */
  persistEvents(requestId: string, events: RequestStreamEvent[]): void;

  /**
   * Wait for all pending event persistence writes to complete.
   * Called before the terminal patchRequestRecord.
   */
  flushEvents(requestId: string): Promise<void>;

  /**
   * Retrieve persisted stream events for a request.
   * Returns events sorted by sequence_number. When `fromSequence` is
   * provided, only events with `sequence_number > fromSequence` are
   * returned; omitting it returns the full log (used by the
   * completed-request replay path).
   */
  getEvents(requestId: string, fromSequence?: number): Promise<RequestStreamEvent[]>;

  /**
   * Yields events for a request as they are persisted. Catch-up replay
   * covers events with `sequence_number > options.fromSequence`; the live
   * phase yields events as they arrive until the iterator aborts, sees a
   * terminal request status, or hits the liveness timeout. The "close"
   * path is `signal.abort()`; there is no separate `.close()` method.
   *
   * Backends without a cross-process push primitive (SQLite, filesystem,
   * Postgres-without-`liveTailPool`) poll. Memory uses an in-process bus
   * shared with the persistence path.
   */
  subscribeToEvents(
    requestId: string,
    options: SubscribeToEventsOptions
  ): AsyncIterableIterator<RequestStreamEvent>;

  /**
   * Lookup the memoized result of a `ctx.runOnce(key, fn)` call (FIX-402).
   * Returns `{ found: false }` when no record exists for this `(requestId,
   * key)` pair. The stored value is opaque JSON — the caller is responsible
   * for any type coercion. Implementations should treat misses as cheap
   * and not allocate on miss.
   */
  getRunOnceResult(
    requestId: string,
    key: string
  ): Promise<{ found: boolean; value?: unknown }>;

  /**
   * Persist the result of a `ctx.runOnce(key, fn)` call (FIX-402). The
   * value replaces any prior record for this `(requestId, key)` pair —
   * callers serialize execution per key so a late writer overwriting an
   * earlier success is benign (they computed the same fn).
   */
  setRunOnceResult(
    requestId: string,
    key: string,
    value: unknown
  ): Promise<void>;
}

/**
 * Options for `RequestStore.subscribeToEvents`. `fromSequence` is required
 * — a subscriber that has seen nothing passes `0`. Optionality would
 * invite the bug where a reconnecting client with a stale `Last-Event-ID`
 * accidentally re-receives the entire log.
 */
export interface SubscribeToEventsOptions {
  /** Subscriber's last-seen sequence number; `0` means no events seen. */
  fromSequence: number;
  /** Aborts the subscription cleanly when the SSE client disconnects. */
  signal?: AbortSignal;
  /**
   * If no events arrive in this window AND no terminal status is observed
   * in the store, the iterator yields a synthetic `request.interrupted`
   * event (not persisted) and closes. Default `30000`. Ignored for the
   * in-memory store, where there is no cross-process death scenario.
   */
  livenessTimeoutMs?: number;
  /**
   * Per-subscription bounded queue capacity. On overflow the iterator
   * throws `StoreSubscriptionError("backpressure_overflow")`. Default
   * `1000`.
   */
  maxPendingEvents?: number;
  /**
   * When `true`, a `request.suspended` event is treated as a checkpoint, not
   * a stream terminal: the iterator yields it and keeps following the request
   * (FIX-811). Set by the attach route only when a continuation lease is held,
   * so a same-request continuation (resume / crash-recovery `continue`) can be
   * streamed through to its real terminal. The true terminals
   * (`completed`/`failed`/`incomplete`/`aborted`) still end the iterator, and
   * the route closes the wire if a later suspension lands with the lease gone
   * (the continuation re-suspended). Default `false` — a paused request's
   * stream still ends at `suspended`.
   */
  followThroughSuspend?: boolean;
}

export interface UserStore extends DeltaStoreOps<UserRecord> {
  get(id: string): Promise<UserRecord | undefined>;
  /** See `SessionStore.set` for CAS semantics. */
  set(
    id: string,
    value: UserRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<UserRecord>>;
  delete(id: string): Promise<void>;
  list(options?: UserListOptions): Promise<UserRecord[]>;
}

export interface OrgStore extends DeltaStoreOps<OrgRecord> {
  get(id: string): Promise<OrgRecord | undefined>;
  /** See `SessionStore.set` for CAS semantics. */
  set(
    id: string,
    value: OrgRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<OrgRecord>>;
  delete(id: string): Promise<void>;
  list(options?: OrgListOptions): Promise<OrgRecord[]>;
}

export type ActiveRequestEntry = {
  requestId: string;
  flowKind: string;
  actionName: string;
  sessionId?: string;
  userId: string;
  orgId?: string;
  /**
   * Bare tenant id this request runs under (FIX-682). Carried so recovery can
   * re-dispatch the retry within the same tenant's session. Undefined for
   * single-tenant requests.
   */
  tenantId?: string;
  /** Inbound transport provenance — see `RequestRecord.source`. */
  source: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  startedAt: number;
  lastHeartbeatAt: number;
};

export interface ActiveRequestRegistry {
  /** Register a new in-flight request. Called at the start of runAction. */
  register(entry: ActiveRequestEntry): Promise<void>;

  /** Update the heartbeat timestamp. Called on a periodic interval. */
  heartbeat(requestId: string): Promise<void>;

  /** Remove a request from the registry. Called on terminal (success/failure). */
  deregister(requestId: string): Promise<void>;

  /** Return all entries whose lastHeartbeatAt is older than Date.now() - thresholdMs. */
  listStale(thresholdMs: number): Promise<ActiveRequestEntry[]>;

  /** Return all currently registered entries. */
  listAll(): Promise<ActiveRequestEntry[]>;

  /** Return a single entry by requestId, or undefined. */
  get(requestId: string): Promise<ActiveRequestEntry | undefined>;
}

/**
 * Scope discriminator for content storage.
 * Excludes "request" since request-scoped resources are not supported.
 */
export type ContentScopeType = "session" | "user" | "org";

/**
 * Separates resource content persistence from scope record persistence.
 *
 * Content is addressed by (scopeType, scopeId, resourceKey). This allows
 * adapters to store content independently of metadata — e.g., SQL metadata
 * with blob storage for content, or individual files on the filesystem.
 */
export interface ContentStore {
  /** Read a single resource's content. */
  get(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<string | undefined>;

  /** Write a single resource's content. Creates or overwrites. */
  set(scopeType: ContentScopeType, scopeId: string, resourceKey: string, content: string): Promise<void>;

  /** Delete a single resource's content. */
  delete(scopeType: ContentScopeType, scopeId: string, resourceKey: string): Promise<void>;

  /** Read all content for a scope instance. Used during state route reads (full-scope view). */
  getAll(scopeType: ContentScopeType, scopeId: string): Promise<Record<string, string>>;

  /**
   * Read every content entry in a scope whose resourceKey starts with
   * `keyPrefix`. An empty `keyPrefix` returns all keys in the scope
   * (equivalent to `getAll`). Used during context initialization to load
   * only the content a flow declares — fixed resources by exact key, and
   * collections by their pattern prefix.
   */
  getByPrefix(scopeType: ContentScopeType, scopeId: string, keyPrefix: string): Promise<Record<string, string>>;

  /** Delete all content for a scope instance. Used during scope record deletion. */
  deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void>;
}

/**
 * Phantom brand for {@link VersionedResourceState}. Declared, never defined —
 * it exists only in the type system and is absent from every runtime value.
 */
declare const versionedResourceStateBrand: unique symbol;

/**
 * A live resource state row together with the CAS version it was read at.
 *
 * The version is what makes a read usable as the basis for a conditional
 * write: pass it back as `set`'s `expectedVersion` and the write lands only
 * if nobody moved the key in between. `undefined` from a read means "no live
 * row" — an absent key and a tombstoned one are indistinguishable to readers
 * by design (see {@link ResourceStateStore}).
 *
 * ## Why this type is branded
 *
 * Structurally, `{ state, version }` is a perfectly good `JsonObject`. That
 * made every missed unwrap a *silent* bug rather than a compile error — handing
 * `{ state, version }` where the state itself was expected typechecked
 * cleanly and produced the wrong value downstream. The phantom brand below
 * breaks that assignability: its declared type is a `unique symbol`, which is
 * not a `JsonValue`, so `VersionedResourceState` (and any `Record` of them) is
 * no longer assignable to `JsonObject`. Use {@link toBareState} / {@link toBareStates}
 * to project down; forgetting to is now a type error.
 *
 * The property is optional and never written, so constructing a versioned read
 * stays a plain object literal — adapters pay nothing for the brand. It does
 * not defend against an explicit `as` cast, which remains the caller's
 * assertion to make.
 */
export type VersionedResourceState = {
  /**
   * Phantom. Never present at runtime — see the note above. The key is a
   * string rather than the symbol itself on purpose: a `JsonObject`'s index
   * signature only constrains string keys, so a symbol-keyed brand would be
   * ignored by the assignability check this exists to fail.
   */
  readonly __versionedResourceState?: typeof versionedResourceStateBrand;
  /** The stored state. A tombstone is never returned, so this is always live. */
  state: JsonObject;
  /** Monotonic per key, never reused — see {@link ResourceStateStore}. */
  version: number;
};

/**
 * Separates resource state persistence from scope record persistence.
 *
 * State is addressed by (scopeType, scopeId, resourceKey) — the same scheme as
 * `ContentStore`, and covers both single-resource and collection-instance
 * state uniformly. Each resource's state is a `JsonObject` written under its
 * own key, so a mutation to one resource never rewrites the whole scope
 * record. It shares `ContentStore`'s keyed storage pattern (FIX-689), but the
 * two stores deliberately diverge on concurrency — see below.
 *
 * ## Concurrency: compare-and-swap, not last-write-wins
 *
 * Every write carries an {@link ExpectedVersion} and returns a
 * {@link SetResult}, so a caller can tell whether its write actually landed.
 * This is the one place this store differs from `ContentStore`, and the
 * difference is deliberate: LWW is right for content, because nothing merges
 * a document body against a prior read. It is wrong for structured state that
 * concurrent workers read-modify-write, which is what resource state became
 * when it started backing task boards. One addressing scheme, two access
 * patterns, two concurrency models.
 *
 * Two semantics diverge from the scope stores that share these types, and
 * both are deliberate:
 *
 *  - **`expectedVersion: 0` means "no live row"** — it is create-if-absent,
 *    and it is satisfied by a tombstoned key as well as a never-existed one.
 *  - **Some conflicts are terminal, not retryable.** A conflict against a
 *    tombstone must not be retried into a resurrection, and a losing
 *    create-if-absent must not be retried into an overwrite. Callers drive
 *    this store through the resource CAS driver, not `runWithCAS`.
 *
 * ## Lifecycle and version semantics
 *
 * | Rule | Behaviour |
 * |---|---|
 * | Lifecycle | `live` (visible) or `deleted` (tombstone: invisible, version retained) |
 * | Reads | `get` / `getAll` / `getByPrefix` return **live rows only**. A tombstone reads exactly like an absent key |
 * | Snapshots | Every state crossing the boundary is a **deep copy**, both ways: what a read returns, what a caller passed to `set`, and a conflict's `currentValue`. Mutating any of them never changes the stored row — the version has to witness the value, so no path may change a value without bumping a version |
 * | Snapshot timing | `set` captures its value **before it yields** — on the synchronous run-up to the adapter's first `await`, never behind a lock or a microtask. A mutation the caller makes while the returned promise is still in flight must not be the one that commits. Serializing *eventually* is not enough: by the time a deferred body runs, the caller has had control back |
 * | Version | First create writes `1`; each committed write bumps by 1; **never reused**. A recreate continues from the tombstone's version + 1 |
 * | `delete` | Retains the version, drops the payload (stores `{}`), marks `deleted`. The version is the only thing a tombstone carries |
 * | `deleteAll` | Bulk-marks every live key in the scope `deleted`. A scope operation, so it takes no expected version |
 * | Retention | **Tombstones are retained indefinitely, in every scope.** Nothing reclaims one, and nothing here depends on anything ever doing so |
 * | Legacy rows | A row written before versioning reads as **live at version 1** — never as absent |
 * | Version domain | A numeric `expectedVersion` must be a **non-negative integer**. Negative, fractional, `NaN` and `Infinity` **throw** — a programming error, not a lost race, so it is never folded into a conflict |
 *
 * Retention is what closes the delete/recreate ABA: because a tombstone keeps
 * its version, an observer holding a pre-delete version never matches the row
 * that replaces it. A tombstone that is never removed is always sound — it
 * costs one row and can never resurrect anything.
 *
 * ## Per-adapter guarantee
 *
 * Real CAS on memory, SQLite and Postgres. The filesystem adapter compares
 * under a per-key mutex held on the store **instance**, so it closes the
 * in-process race but does **not** protect two OS processes over one
 * directory. Stated rather than implied.
 */
export interface ResourceStateStore {
  /**
   * Read a single resource's live state and its version, or `undefined` when
   * there is no live row. A tombstoned key returns `undefined`, exactly like
   * a key that never existed.
   */
  get(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string
  ): Promise<VersionedResourceState | undefined>;

  /**
   * Write a single resource's state if `expectedVersion` still holds.
   *
   * - A number writes only when the current **live** version equals it.
   * - `0` is create-if-absent: it succeeds when there is no live row
   *   (never existed, or tombstoned) and conflicts against a live one.
   * - `"any"` writes unconditionally — the opt-out, and the posture every
   *   caller that has not adopted CAS passes explicitly.
   *
   * A number outside that domain — negative, fractional, `NaN`, `Infinity` —
   * throws rather than conflicting. The type admits it; the contract does not.
   *
   * On conflict, `conflict.currentValue` is the current live state or
   * `undefined` when the row is tombstoned, and `conflict.currentVersion` is
   * the version now stored. A caller must treat an `undefined` current value
   * as "deleted" and stop — never as "reuse what I had cached".
   */
  set(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    state: JsonObject,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<JsonObject>>;

  /**
   * Tombstone a single resource's state if `expectedVersion` still holds.
   * Takes a version like every other write, so a delete chosen from a stale
   * snapshot conflicts instead of tombstoning a newer generation.
   *
   * The row keeps its version and drops its payload. Deleting an absent or
   * already-tombstoned key is an idempotent success — an absent key reports
   * `version: 0`, consistent with `0` meaning "no live row" everywhere else in
   * this contract. That is not a version any row holds, so never carry it
   * forward as the basis for a later write.
   *
   * `"any"` and a positive version part company when a delete finds nothing to
   * remove and a live row appears before it can say why. `"any"` asserts
   * nothing about versions, so "there was no live row" is already the whole
   * answer to what it asked: the call linearizes there, a recreate that lands
   * afterwards belongs to a later story, and the result is an idempotent
   * success reporting `version: 0` — never the recreated row's version, which
   * names a live row this delete did not remove. A positive `expectedVersion`
   * asserted something that did not hold at that same point, so it conflicts,
   * carrying the version now stored. Both halves matter: collapsing them into
   * "always succeed" hides a real lost race, and collapsing them into "always
   * conflict" reports one to a caller that opted out of versions entirely.
   */
  delete(
    scopeType: ContentScopeType,
    scopeId: string,
    resourceKey: string,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<JsonObject>>;

  /**
   * Read all live state for a scope instance, each entry carrying its
   * version. Used by full-scope reads (`/state`, debug snapshot).
   */
  getAll(
    scopeType: ContentScopeType,
    scopeId: string
  ): Promise<Record<string, VersionedResourceState>>;

  /**
   * Read every live state entry in a scope whose resourceKey starts with
   * `keyPrefix`, each carrying its version. An empty `keyPrefix` returns all
   * live keys in the scope (equivalent to `getAll`). Used during context
   * initialization to load only the state a flow declares — fixed resources
   * by exact key, collections by their pattern prefix.
   */
  getByPrefix(
    scopeType: ContentScopeType,
    scopeId: string,
    keyPrefix: string
  ): Promise<Record<string, VersionedResourceState>>;

  /**
   * Tombstone all live state for a scope instance, retaining each key's
   * version. Used during scope record deletion. A scope operation rather than
   * a key operation, so it carries no expected version.
   *
   * Note the limit this honestly does not close: a create of a key that never
   * existed can still land after this returns, because a bulk mark only
   * touches rows that already exist and `expectedVersion: 0` is satisfied by
   * a never-existed key. Closing that needs a scope generation, not a per-key
   * predicate.
   */
  deleteAll(scopeType: ContentScopeType, scopeId: string): Promise<void>;
}

/**
 * Durable sequencer checkpoint store (FIX-401).
 *
 * Latest-only persistence: identity is `(requestId, blockInstanceId)`. Each
 * write overwrites any prior record. The Phase 2 resume runtime (FIX-141)
 * reads the latest checkpoint to find the resume point — no enumeration
 * needed since identity is fully scoped.
 *
 * GC is per-instance: each sequencer's terminal state_snapshot triggers a
 * `delete` for its own instance. No `listForRequest` / `pruneBefore` /
 * `stepHistory` — those are explicitly out of scope (see FIX-401 spec).
 */
export interface CheckpointStore {
  /** Overwrite the latest checkpoint for this sequencer instance. */
  write(checkpoint: SequencerCheckpoint): Promise<void>;

  /** Read the latest checkpoint, or `null` if none exists. */
  latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null>;

  /** Remove the checkpoint when its sequencer reaches terminal state. */
  delete(requestId: string, blockInstanceId: string): Promise<void>;

  /**
   * Remove every checkpoint for `requestId` across all blockInstanceIds.
   * Idempotent — a request with no checkpoints is a no-op, never an error.
   */
  deleteForRequest(requestId: string): Promise<void>;
}

/**
 * A single trace event captured by the runtime. Carries the originating
 * request, a monotonically-increasing per-request `sequenceNumber` for
 * cursor-based reads, the wall-clock timestamp, the event type, and the
 * inner debug item.
 */
export type TraceEvent = {
  requestId: string;
  sequenceNumber: number;
  ts: number;
  type: "trace.item.added" | "trace.item.done";
  item: BlockTraceItem | RouterDecisionItem | StateSnapshotItem;
};

/**
 * Per-request trace event log. Implementations are responsible for bounded
 * retention — callers should not assume unbounded history.
 *
 * `appendEvent` is logically append-only per request. `flush` lets adapters
 * with batched I/O guarantee durability before a read. `getEvents` supports
 * cursor reads via `fromSequence` (exclusive lower bound). `listRequestIds`
 * returns the request IDs currently retained, in insertion order.
 *
 * TODO(FIX-511): cross-process live tail.
 */
export interface TraceStore {
  appendEvent(requestId: string, event: TraceEvent): Promise<void>;
  flush(requestId: string): Promise<void>;
  getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]>;
  listRequestIds(): Promise<string[]>;
}

/**
 * Suspension record persistence (FIX-140). Stores suspension metadata
 * created by ctx.suspend() for later resolution via the resume endpoint.
 */
export interface SuspensionStore {
  /** Create or update a suspension record. */
  set(record: SuspensionRecord): Promise<void>;

  /** Get a suspension by (requestId, suspensionId). */
  get(
    requestId: string,
    suspensionId: string
  ): Promise<SuspensionRecord | null>;

  /** List suspensions matching a filter. */
  list(filter?: SuspensionFilter): Promise<SuspensionRecord[]>;

  /** Delete all suspensions for a request. */
  deleteForRequest(requestId: string): Promise<void>;

  /**
   * Delete suspensions in a TERMINAL status (approved | rejected | timed_out |
   * expired) whose `resolvedAt` is non-null and strictly less than `cutoffMs`,
   * up to `limit` rows. Pending suspensions are never touched. Returns the
   * number of rows actually deleted so a sweeper can loop until it observes a
   * partial batch (`deleted < limit`). Idempotent — nothing matching returns 0.
   */
  pruneTerminalBefore(cutoffMs: number, limit: number): Promise<number>;
}

/**
 * Lease persistence for preventing concurrent resume (FIX-140). Each
 * lease is keyed by requestId; only one active (non-expired) lease per
 * request at a time.
 */
export interface LeaseStore {
  /**
   * Attempt to acquire a lease. Returns the lease on success, null if
   * the request already has an active (non-expired) lease held by
   * another holder.
   */
  acquire(
    requestId: string,
    options: LeaseOptions
  ): Promise<Lease | null>;

  /** Release a lease by (requestId, leaseId). */
  release(requestId: string, leaseId: string): Promise<void>;

  /** Get the current lease for a request, if any. */
  get(requestId: string): Promise<Lease | null>;

  /** Remove expired leases. Called periodically or on acquire. */
  pruneExpired(): Promise<void>;
}

export type StoreRegistry = {
  session: SessionStore;
  request: RequestStore;
  user: UserStore;
  org: OrgStore;
  activeRequests: ActiveRequestRegistry;
  content: ContentStore;
  resourceState: ResourceStateStore;
  checkpoints: CheckpointStore;
  traces: TraceStore;
  suspensions: SuspensionStore;
  leases: LeaseStore;
};

/**
 * Payload delivered to an `onPersistError` observable when a store adapter's
 * background write fails. `store` names the adapter ("request", "traces",
 * "activeRequests"), `id` is the affected record key (typically a requestId),
 * and `error` is the underlying write failure (FIX-406 6B).
 */
export type PersistErrorInfo = {
  store: string;
  id: string;
  error: Error;
};

/**
 * Operator-suppliable hook fired on store persistence failures. Configured via
 * the store factory (e.g. `createFilesystemStores({ onPersistError })`). When
 * unset, adapters still log the failure — the hook is the structured channel
 * for alerting, not a replacement for the safety-net log.
 */
export type PersistErrorHandler = (info: PersistErrorInfo) => void;

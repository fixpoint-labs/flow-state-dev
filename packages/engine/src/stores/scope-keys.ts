/**
 * Storage key derivation for user- and org-scope records and their resources.
 *
 * Two storage concerns key off the user/org identity, and FIX-735 decouples
 * them because they answer different questions:
 *
 *   - The **scope record** (`stores.user` / `stores.org`) holds scope-level
 *     `state` (`ctx.user.state`). It is a single blob per scope, so its key
 *     is a flow-wide decision: the flow's `isolateUserState` / `isolateOrgState`
 *     flag. `resolveUserStorageKey` / `resolveOrgStorageKey` answer this.
 *
 *   - **Resources** (`stores.resourceState` / `stores.content`) key per
 *     resource. Each user/org-scoped resource keys at the bare identity id
 *     when shared (effective `flowIsolation` false) or `${id}:${flowKind}`
 *     when isolated (effective `flowIsolation` true) — honoring the
 *     resource-level override the API advertises (FIX-435) rather than a
 *     flow-wide OR. `resolveResourceIsolation` + `resolveResourceScopeId`
 *     answer this per resource; `resourceScopeIds` enumerates the distinct
 *     buckets a read path must consult.
 *
 * Before FIX-735 both concerns shared one key derived from a flow-wide OR, so
 * a `flowIsolation: false` resource was silently isolated whenever any sibling
 * was isolated. The opt-out direction is now honored.
 *
 * **Session scope splits the same two ways** (FIX-1000), and for the same
 * reason: `resolveSessionStorageKey` is the session *record* key, while
 * `resolveSessionResourceScopeId` is its *resource* address, fenced by a
 * per-record `storageGeneration`. One function used to answer both, which is
 * how a recreated session came to inherit a deleted one's rows.
 */

import type { SessionParentage, SessionRecord } from "./types";

/** Minimal flow shape carrying the scope-isolation flags plus its own `kind`. */
export interface IsolationFlow {
  kind: string;
  isolateUserState: boolean;
  isolateOrgState: boolean;
  /**
   * Flat resource declarations (FIX-435). Consulted by `resourceScopeIds`
   * to enumerate the per-resource isolation buckets in play for a scope.
   */
  resources?: Record<string, { scope?: string; flowIsolation?: boolean }>;
}

/**
 * Bare `userId` unless the flow isolates the user scope; then
 * `${userId}:${flowKind}`. Governs the scope *record* (`ctx.user.state`)
 * only — resources route per-resource via `resolveResourceScopeId`.
 */
export function resolveUserStorageKey(
  userId: string,
  flow: Pick<IsolationFlow, "kind" | "isolateUserState">
): string {
  return flow.isolateUserState ? `${userId}:${flow.kind}` : userId;
}

/**
 * Bare `orgId` unless the flow isolates the org scope; then
 * `${orgId}:${flowKind}`. Governs the scope *record* (`ctx.org.state`)
 * only — resources route per-resource via `resolveResourceScopeId`.
 */
export function resolveOrgStorageKey(
  orgId: string,
  flow: Pick<IsolationFlow, "kind" | "isolateOrgState">
): string {
  return flow.isolateOrgState ? `${orgId}:${flow.kind}` : orgId;
}

/**
 * Tenant-namespaced session **record** key (FIX-682). Bare `sessionId` for
 * single-tenant requests (no tenant header, or an empty one); when a tenant is
 * present, `${tenantId}:${sessionId}`, so two tenants sharing a session id
 * never collide on one record.
 *
 * This is the key of the record in `stores.session` — and *only* that. It is
 * **not** the address of the session's resources: those route through
 * {@link resolveSessionResourceScopeId}, which fences them by generation
 * (FIX-1000). Before FIX-1000 one function served both questions, and a
 * recreated session inheriting a purged session's rows is the defect that
 * ambiguity grew. Deriving this key without a record in hand is still correct
 * and expected — the key is how you load one.
 *
 * Mirrors the user/org storage-key convention above — the `:` separator and the
 * "bare unless namespaced" shape are identical, and the same caveat applies:
 * ids must not contain `:` ambiguously (an existing, accepted constraint).
 * The empty-string guard makes an empty `x-tenant-id` header behave exactly
 * like an absent one (bare keys).
 */
export function resolveSessionStorageKey(
  sessionId: string,
  tenantId: string | undefined
): string {
  return tenantId !== undefined && tenantId.length > 0
    ? `${tenantId}:${sessionId}`
    : sessionId;
}

/**
 * Inverse of {@link resolveSessionStorageKey} (FIX-682): recover the bare
 * session id from a tenant-namespaced storage key. Used to shape HTTP
 * responses so clients receive the id they passed in (the namespaced key is an
 * internal storage detail; surfacing it would make clients double-namespace on
 * follow-up calls). A no-op when there is no tenant or the prefix is absent.
 */
export function toBareSessionId(
  storageKey: string,
  tenantId: string | undefined
): string {
  if (tenantId === undefined || tenantId.length === 0) return storageKey;
  const prefix = `${tenantId}:`;
  return storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : storageKey;
}

/**
 * Separator between a session's record key and its storage generation
 * (FIX-1000). `#` rather than the `:` used for tenant and flow namespacing:
 * `:` is already load-bearing in this module and ids carrying one are an
 * accepted ambiguity, so reusing it here would make `${tenant}:${id}#${gen}`
 * parseable two ways. Nothing inverts a session-scope resource address, so the
 * separator is an internal detail — but it must not collide with one that is.
 */
const STORAGE_GENERATION_SEPARATOR = "#";

/**
 * Mint a fresh storage generation for a new session record (FIX-1000).
 *
 * **Every production site that creates a `SessionRecord` must call this.** The
 * field is optional on the type, so the compiler will not enumerate the mint
 * sites for you (D3) — that is a deliberate trade, because a missed mint site
 * degrades to legacy behaviour and breaks nothing, whereas a missed *read* site
 * makes writer and reader disagree, which is silent data loss. One test per
 * production mint path covers the former.
 *
 * A nonce, not a counter (D2): a counter has to read the previous value, and
 * deleting the session removes the record that held it, so two successive
 * generations would both be `1` and reproduce the very collision being fenced.
 */
export function mintStorageGeneration(): string {
  return crypto.randomUUID();
}

/**
 * The `scopeId` a session's resources (`stores.resourceState` / `stores.content`)
 * live at (FIX-1000) — the **only** producer of a session-scope resource
 * address, and the reason it takes the record rather than the session id.
 *
 * `${recordKey}#${storageGeneration}` for a fenced record; the bare record key
 * for a legacy one (no generation), which is byte-identical to pre-FIX-1000
 * behaviour. The generation composes onto a key that may already be
 * tenant-namespaced, so multi-tenancy is unaffected.
 *
 * Sibling to {@link resolveResourceScopeId}, which answers the same question
 * for user/org scope; the naming pairing is what tells the next reader these
 * are different questions from {@link resolveSessionStorageKey}.
 *
 * A caller holding only a `sessionId` cannot produce an address without loading
 * the record. That is the point: the record is what carries the generation.
 */
export function resolveSessionResourceScopeId(
  record: Pick<SessionRecord, "id" | "storageGeneration">
): string {
  // `== null` so a store that nulls absent keys reads as legacy, and an
  // empty-string generation never silently addresses `${id}#` (BP-030).
  const generation = record.storageGeneration;
  return generation == null || generation.length === 0
    ? record.id
    : `${record.id}${STORAGE_GENERATION_SEPARATOR}${generation}`;
}

/**
 * Whether a stored record's tenant matches a request's tenant (FIX-682),
 * treating `undefined` and absent identically (single-tenant). The canonical
 * tenant-binding predicate: the `${tenantId}:${sessionId}` key is ambiguous
 * when the caller controls `sessionId`, so a key collision must never be acted
 * on across the boundary. Used by the session binding guard, the route session
 * loader, the `latestRequestId` update, and resource/debug reads — one
 * predicate keeps the rule greppable.
 */
export function tenantMatches(
  recordTenantId: string | undefined,
  requestTenantId: string | undefined
): boolean {
  return (recordTenantId ?? undefined) === (requestTenantId ?? undefined);
}

/**
 * Tenant list-filter predicate (FIX-682) with present-vs-absent semantics:
 * - When the `tenantId` key is **absent** from `options`, every record passes
 *   (admin/debug "list everything" callers stay unfiltered).
 * - When the key is **present** (including an explicit `undefined`), the record
 *   must exact-match — `undefined` matches only records with no tenant.
 *
 * Used by the in-memory / filesystem store list filters. The SQLite adapter
 * cannot import this (type-only boundary to `@flow-state-dev/engine`) and
 * implements the same predicate as a NULL-safe `tenant_id IS ?` clause.
 */
export function matchesTenantFilter(
  options: { tenantId?: string } | undefined,
  recordTenantId: string | undefined
): boolean {
  if (options === undefined || !("tenantId" in options)) return true;
  return recordTenantId === options.tenantId;
}

/**
 * Parentage list-filter predicate (FIX-1009). The canonical definition of the
 * three modes; the memory and filesystem session stores call it directly, and
 * the SQLite / Postgres adapters mirror it in their `WHERE` builders because
 * they cannot import across the type-only package boundary.
 *
 * Absence narrows: no `parentage` (and an explicit `undefined`) means
 * `"top-level"`, so a caller that passes no filter gets only the sessions a
 * person started. This is deliberately the **opposite** of
 * {@link matchesTenantFilter}, where absence widens — see
 * `SessionListOptions.parentage` for why the two differ.
 *
 * The top-level test is `== null` rather than `=== undefined` so a record
 * persisted before `parentSessionId` existed, and one round-tripped through a
 * store that nulls absent keys, both read as top-level (BP-030).
 */
export function matchesParentageFilter(
  options: { parentage?: SessionParentage } | undefined,
  recordParentSessionId: string | undefined
): boolean {
  const parentage = options?.parentage ?? "top-level";
  if (parentage === "all") return true;
  if (parentage === "top-level") return recordParentSessionId == null;
  return recordParentSessionId === parentage.parentOf;
}

/**
 * Effective isolation for a single resource: its own `flowIsolation` when
 * set, otherwise the scope's flow-level default. Resource-level declarations
 * always win (FIX-435), in both the opt-in and opt-out directions.
 */
export function resolveResourceIsolation(
  resourceFlowIsolation: boolean | undefined,
  flow: Pick<IsolationFlow, "isolateUserState" | "isolateOrgState">,
  scope: "user" | "org"
): boolean {
  if (resourceFlowIsolation !== undefined) return resourceFlowIsolation;
  return scope === "user" ? flow.isolateUserState : flow.isolateOrgState;
}

/**
 * The `scopeId` a resource's per-resource storage (`resourceState` / `content`)
 * lives at: bare `identityId` when shared, `${identityId}:${flowKind}` when
 * isolated.
 */
export function resolveResourceScopeId(
  identityId: string,
  flowKind: string,
  isolated: boolean
): string {
  return isolated ? `${identityId}:${flowKind}` : identityId;
}

/**
 * The distinct storage `scopeId`s a flow's user/org-scoped resources occupy
 * for a given identity — at most two (the bare bucket and the
 * flow-namespaced bucket). Read paths consult every returned id and merge,
 * since a flow may declare both shared and isolated resources at one scope.
 *
 * When the flow declares no resources at the scope, falls back to the
 * scope-record bucket (the flow-flag key) so callers still resolve a key.
 */
export function resourceScopeIds(
  identityId: string,
  flow: IsolationFlow,
  scope: "user" | "org"
): string[] {
  const ids = new Set<string>();
  const entries = flow.resources === undefined ? [] : Object.values(flow.resources);
  for (const entry of entries) {
    if (entry.scope !== scope) continue;
    const isolated = resolveResourceIsolation(entry.flowIsolation, flow, scope);
    ids.add(resolveResourceScopeId(identityId, flow.kind, isolated));
  }
  if (ids.size === 0) {
    const flowDefault = scope === "user" ? flow.isolateUserState : flow.isolateOrgState;
    ids.add(resolveResourceScopeId(identityId, flow.kind, flowDefault));
  }
  return [...ids];
}

/**
 * Await a set of per-bucket store reads (one per `resourceScopeIds` entry) and
 * merge them into one map. A resource lives in exactly one isolation bucket, so
 * keys never collide and merge order is immaterial; an empty input yields `{}`.
 */
export async function mergeScopeReads<T>(
  reads: Array<Promise<Record<string, T>>>
): Promise<Record<string, T>> {
  const results = await Promise.all(reads);
  return Object.assign({}, ...results) as Record<string, T>;
}

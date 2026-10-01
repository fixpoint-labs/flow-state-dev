/**
 * Where a session-scoped resource STORES, for execution and the HTTP routes alike (FIX-1068).
 *
 * A resource declaring `sharedToLineage: true` has one identity across a
 * session lineage: it resolves against the lineage ROOT rather than the running
 * session, so a conversation and the background sessions under it address the
 * same rows. `createExecutionContext` applies that rule on the execution path;
 * the HTTP read/write routes need the same answer, and this module is the one
 * place both derive it from so they cannot disagree: {@link sessionRoutingIndex}
 * walks a flow's session declarations once, and both paths read that walk.
 *
 * The address comes off the session record (`SessionRecord.lineageId`), minted
 * at session creation and inherited verbatim by every descendant — so the id is
 * read, never reconstructed, and a parent and a child cannot compute their way
 * to different answers. A record written before the field existed has no
 * `lineageId` and falls back to a value derived from its session key, prefixed
 * so it can never equal that key (BP-030).
 */
import { getPatternPrefix } from "@flow-state-dev/core/types";
import { isCollectionConfig } from "./is-collection-config";
import { resourceStorageKeys } from "./storage-keys";
import type { StorageScopeType } from "../stores/types";
import { resolveLineageId } from "../stores/scope-keys";

/** The session-record fields lineage addressing reads. */
export type LineageSession = {
  /** Tenant-namespaced session storage key — the scopeId for unshared resources. */
  id: string;
  /** The session's owner. Authoritative — it is the stored record's own field. */
  userId: string;
  /**
   * The lineage this session belongs to (FIX-1068). Absent on a record written
   * before the field existed, read as its own lineage keyed by `id` (BP-030).
   */
  lineageId?: string | null;
};

/** The declaration fields that decide where a session-scoped resource stores. */
type SharedFlag = { sharedToLineage?: boolean };

/**
 * Whether a session-scoped declaration is shared across its lineage. The one
 * reading of the flag: only an explicit `true` shares, so an absent or
 * malformed value keeps the resource on the running session.
 */
export function isSharedToLineage(config: unknown): boolean {
  return (config as SharedFlag | null | undefined)?.sharedToLineage === true;
}

/**
 * Storage `scopeId` for one session-scoped resource or collection.
 *
 * Pass the resource's own declaration — a caller holding a config never needs
 * the key-prefix matching below, and reading the flag directly is exact for
 * collections too (whose accessor is not a key prefix).
 */
export function sessionResourceScopeId(
  session: LineageSession,
  config: SharedFlag | undefined,
  tenantId: string | undefined
): string {
  if (!isSharedToLineage(config)) return session.id;
  return lineageScopeId(session);
}

/**
 * Storage `scopeId` for one concrete session-scope storage KEY.
 *
 * Use this — not {@link sessionResourceScopeId} — wherever the key is
 * addressable through a declaration that does not own it. A route names a
 * collection by ref, and a broad pattern accepts keys a narrower sibling owns
 * (`tasks/**` accepts `tasks/meta/a` while `tasks/meta/*` owns it), so reading
 * the addressed declaration's flag sends the request to the wrong session. The
 * key's owner is the only thing that decides, and it is decided here by the same
 * `resolveOwnershipFlag` execution uses.
 */
export function sessionKeyScopeId(
  session: LineageSession,
  flowResources: unknown,
  storageKey: string,
  tenantId: string | undefined
): string {
  const { buckets } = sessionRoutingIndex(flowResources);
  return resolveOwnershipFlag(buckets, storageKey) === true
    ? lineageScopeId(session)
    : session.id;
}

/**
 * The lineage address for this session — the same one `createExecutionContext`
 * resolves. The stored id *is* the address; nothing is conjoined onto it,
 * because a recreated session mints a fresh id rather than landing back on the
 * old one's address.
 */
function lineageScopeId(session: LineageSession): string {
  // Prefixed for the same reason `createExecutionContext` prefixes it: the
  // fallback must never equal the session key, or unshared resources become
  // indistinguishable from lineage ones.
  return resolveLineageId(session);
}

/**
 * The scope kind a resolved session-scope address stores under (FIX-1068).
 *
 * The lineage bucket is not in the session namespace: session scope ids are
 * caller-chosen and nothing validates them, so a lineage address sharing that
 * space would be one a caller could occupy by picking the right session id.
 * Its own scope kind makes that unaddressable rather than merely unguessable.
 */
export function sessionStorageScope(
  session: LineageSession,
  scopeId: string
): StorageScopeType {
  // No exception for the legacy fallback, where the lineage id happens to equal
  // the session key: `createExecutionContext` puts that bucket in the lineage
  // namespace too, and the two paths reading one address differently is the
  // failure this module exists to prevent. Same id, different namespace, so
  // shared and unshared rows stay apart even there.
  return scopeId === lineageScopeId(session) ? "lineage" : "session";
}

/**
 * Which declaration owns a storage key, expressed as the routing flag that
 * declaration carries. Singles are matched exactly; collection instances by
 * their pattern prefix.
 *
 * Shared by every reader that has to split one scope across two storage
 * addresses, so the precedence rule below exists once rather than once per
 * call site — two independent "longest prefix wins" implementations is how the
 * two sides drift into disagreeing about who owns a key.
 */
export type OwnershipBuckets = {
  singles: ReadonlyMap<string, boolean>;
  prefixes: ReadonlyArray<{ prefix: string; flag: boolean }>;
};

/**
 * The flag of the declaration that owns `storageKey`, or `undefined` when no
 * declaration claims it.
 *
 * **An exact single wins outright**, because a single's storage key names one
 * slot and cannot be a prefix of anything it doesn't own. Otherwise the
 * **longest matching prefix** wins: `tasks/meta/*` owns `tasks/meta/a` even
 * when `tasks/**` is declared beside it, and the empty prefix a parameterized
 * pattern produces (`[topic]/observations`) is the weakest possible match
 * rather than a wildcard that swallows the scope.
 */
export function resolveOwnershipFlag(
  buckets: OwnershipBuckets,
  storageKey: string
): boolean | undefined {
  const single = buckets.singles.get(storageKey);
  if (single !== undefined) return single;
  let flag: boolean | undefined;
  let bestLen = -1;
  for (const p of buckets.prefixes) {
    const matches = p.prefix === "" || storageKey.startsWith(p.prefix);
    if (matches && p.prefix.length > bestLen) {
      bestLen = p.prefix.length;
      flag = p.flag;
    }
  }
  return flag;
}

/** Where a flow's session-scoped keys route, walked once from its declarations. */
export type SessionRoutingIndex = {
  /** Every session declaration's routing flag: singles by storage key, collections by prefix. */
  buckets: OwnershipBuckets;
  /** Whether any session declaration is shared, so a whole-scope read needs the lineage bucket. */
  anyShared: boolean;
  /**
   * Collection storage prefixes whose collections disagree on
   * `sharedToLineage`, in the order each disagreement is first seen. Two
   * collections on one prefix share one storage slot, so they cannot live at
   * two addresses. Reported, not thrown: execution refuses such a flow, while
   * the HTTP helpers still answer it with the first declaration winning.
   */
  conflicts: ReadonlyArray<string>;
};

/**
 * The session routing index for a flow's resources: the one walk of its
 * session-scoped declarations that both the HTTP helpers and
 * `createExecutionContext` route from.
 *
 * It covers **every** session-scoped declaration rather than only the shared
 * ones. Reading only the shared declarations is what makes a private resource
 * look shared: with nothing representing it, any shared prefix that happens to
 * match its key claims it, and an empty prefix matches every key there is.
 *
 * Collection prefixes stay in declaration order, duplicates included: for a
 * conflicting prefix {@link resolveOwnershipFlag} lets the first declaration
 * win, and that tie-break is observable over HTTP. Singles key on the canonical
 * storage key resolved from the full session config map, so an unaliased single
 * lands on the slot execution uses.
 */
export function sessionRoutingIndex(flowResources: unknown): SessionRoutingIndex {
  const singles = new Map<string, boolean>();
  const prefixes: Array<{ prefix: string; flag: boolean }> = [];
  const conflicts: string[] = [];
  let anyShared = false;
  if (typeof flowResources !== "object" || flowResources === null) {
    return { buckets: { singles, prefixes }, anyShared, conflicts };
  }
  const entries = Object.entries(flowResources as Record<string, unknown>).filter(
    ([, def]) => (def as { scope?: string } | null)?.scope === "session"
  );
  const storageKeys = resourceStorageKeys(Object.fromEntries(entries));
  const prefixFlag = new Map<string, boolean>();
  for (const [accessor, def] of entries) {
    const flag = isSharedToLineage(def);
    if (flag) anyShared = true;
    if (isCollectionConfig(def)) {
      const rawPrefix = getPatternPrefix(def.pattern);
      const prefix = rawPrefix === "" ? "" : `${rawPrefix}/`;
      const existing = prefixFlag.get(prefix);
      if (existing === undefined) prefixFlag.set(prefix, flag);
      else if (existing !== flag && !conflicts.includes(prefix)) conflicts.push(prefix);
      prefixes.push({ prefix, flag });
    } else {
      singles.set(storageKeys[accessor] ?? accessor, flag);
    }
  }
  return { buckets: { singles, prefixes }, anyShared, conflicts };
}

/**
 * Read a session's whole resource scope the way execution sees it: this
 * session's own rows, with every shared key taken from the lineage root instead.
 *
 * `readAll` is the store read for one scopeId (`getAll` on either the resource
 * state or the content store). It runs once when nothing is shared or this
 * session is the root, and twice otherwise.
 *
 * A shared key is dropped from this session's own rows before the root's are
 * folded in, so a row left at a child address by an earlier declaration cannot
 * shadow the one execution would actually read.
 */
export async function readSessionScopeWithLineage<T>(
  session: LineageSession,
  flowResources: unknown,
  tenantId: string | undefined,
  readAll: (scopeType: StorageScopeType, scopeId: string) => Promise<Record<string, T>>
): Promise<Record<string, T>> {
  const { buckets, anyShared } = sessionRoutingIndex(flowResources);
  // Nothing shared means one bucket, which is every flow that never asked for
  // this. The second read below is not paid for by flows that don't use it.
  if (!anyShared) return readAll("session", session.id);

  // Ownership, not "matches some shared prefix" — a private declaration beside
  // a shared one keeps the keys it owns.
  const isShared = (key: string): boolean => resolveOwnershipFlag(buckets, key) === true;

  // Both buckets, whether or not this session has an ancestor: the lineage
  // address is its own namespace, so a ROOT session's shared rows are not at
  // its session key either. Reading only `session.id` there would return an
  // empty shared resource for the very session that owns it.
  const [own, atLineage] = await Promise.all([
    readAll("session", session.id),
    readAll(sessionStorageScope(session, lineageScopeId(session)), lineageScopeId(session))
  ]);

  const merged: Record<string, T> = {};
  for (const [key, value] of Object.entries(own)) {
    if (isShared(key)) continue;
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(atLineage)) {
    if (isShared(key)) merged[key] = value;
  }
  return merged;
}

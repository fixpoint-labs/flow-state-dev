// FIX-2942; BP-030.
/**
 * The kind of the principal that created a session: a person's or a
 * machine's.
 *
 * A session born since `SessionRecord.principalKind` existed carries it. One
 * written before is classified in place, with no new config, from its birth
 * request (`firstRequestKind`), and the answer is written onto the record the
 * first time, so later retention can't change it: the session store keeps a
 * stored `principalKind` against every later write (`withStoredPrincipalKind`).
 *
 * The birth request is the earliest request written for this record: the
 * record's owner, organization (a request from before organizations takes the
 * session's), tenant and flow, created at the record's birth, within
 * {@link BIRTH_WINDOW_MS} either side of its `createdAt`. The request that
 * starts an action is written before the run creates the session, by up to a
 * queue's wait; a session created on its own route gets its first request
 * after. Session deletion leaves requests behind and an id can be taken
 * again, so a request from before the window is a predecessor's; and once
 * retention prunes the birth request, the oldest one left is a later turn's.
 * Neither counts.
 *
 * A dispatched session (`internal`, `task`) takes the kind of the parent it
 * can prove dispatched it (`provesDispatchingParent`), walking up to
 * {@link MAX_LINEAGE_DEPTH} hops. Every case that proves nothing reads as a
 * machine's: no birth request, no parent, a parent that is missing, recreated
 * or someone else's, a cycle, or a chain past the bound. A guess of "person"
 * would hand a webhook's or a schedule's session a person's reach.
 */
import {
  isSameSession,
  MAX_LINEAGE_DEPTH,
  provesDispatchingParent,
  resolveSessionStorageKey,
  toBareSessionId
} from "../stores/scope-keys";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../stores/types";
import { DEFAULT_QUEUED_GRACE_MS } from "../runtime-config";
import { firstRequestKind, type PrincipalKind } from "./principal";

/**
 * How far from a session's `createdAt` its birth request may be: the default
 * time a queued action may wait for a worker (`DEFAULT_QUEUED_GRACE_MS`),
 * since an action's request is written at enqueue and its session at the
 * worker's start.
 */
const BIRTH_WINDOW_MS = DEFAULT_QUEUED_GRACE_MS;

/** Whether `request` was written for `session`'s own record, at its birth. */
function isBirthCandidate(session: SessionRecord, request: RequestRecord): boolean {
  if (request.userId !== session.userId) return false;
  if ((request.orgId ?? session.orgId ?? undefined) !== (session.orgId ?? undefined)) return false;
  if ((request.tenantId ?? undefined) !== (session.tenantId ?? undefined)) return false;
  if (request.flowKind !== session.flowKind) return false;
  if ((request.flowId ?? request.flowKind) !== (session.flowId ?? session.flowKind)) return false;
  return Math.abs(request.createdAt - session.createdAt) <= BIRTH_WINDOW_MS;
}

/** The birth request of `session` (see the file header), or `undefined` when none can be read. */
async function birthRequestOf(
  stores: Pick<StoreRegistry, "request">,
  session: SessionRecord
): Promise<RequestRecord | undefined> {
  const tenantId = session.tenantId ?? undefined;
  // Owner, tenant and flow at the store; the rest of the check needs the record.
  const records = await stores.request.list({
    sessionId: toBareSessionId(session.id, tenantId),
    tenantId,
    userId: session.userId,
    flowKind: session.flowKind,
    orderBy: "none"
  });
  let birth: RequestRecord | undefined;
  for (const record of records) {
    if (!isBirthCandidate(session, record)) continue;
    if (birth === undefined || record.createdAt < birth.createdAt) birth = record;
  }
  return birth;
}

/** The kind `session` reads as from what is stored, without writing it. */
async function classifySession(
  stores: Pick<StoreRegistry, "session" | "request">,
  session: SessionRecord
): Promise<PrincipalKind> {
  const seen = new Set<string>();
  let current = session;
  for (let depth = 0; depth <= MAX_LINEAGE_DEPTH; depth += 1) {
    if (current.principalKind != null) return current.principalKind === "person" ? "person" : "machine";
    if (seen.has(current.id)) return "machine";
    seen.add(current.id);
    const kind = firstRequestKind(await birthRequestOf(stores, current));
    if (kind !== "parent") return kind;
    if (current.parentSessionId == null) return "machine";
    const parent = await stores.session.get(resolveSessionStorageKey(current.parentSessionId, current.tenantId ?? undefined));
    if (parent === undefined || !provesDispatchingParent(current, parent)) return "machine";
    current = parent;
  }
  return "machine";
}

/**
 * Write a backfilled `kind` onto `session`'s record, once: only over the
 * record just classified (the same incarnation, still without a kind) and one
 * version past it, so a writer holding the older copy conflicts rather than
 * putting it back. A write that loses a race leaves the record as the winner
 * wrote it, and one the stores refuse (a view's read-only stores) leaves it
 * as it was; either way the kind is still the answer, and the next read
 * that can write records it.
 */
async function recordSessionKind(
  stores: Pick<StoreRegistry, "session">,
  session: SessionRecord,
  kind: PrincipalKind
): Promise<void> {
  try {
    const current = await stores.session.get(session.id);
    if (current === undefined || current.principalKind != null || !isSameSession(session, current)) return;
    await stores.session.set(current.id, { ...current, principalKind: kind, version: current.version + 1 }, current.version);
  } catch {
    // Not recorded this time: see above.
  }
}

/** The kind of the principal that created `session`, read as the file header describes. */
export async function resolveSessionKind(
  stores: Pick<StoreRegistry, "session" | "request">,
  session: SessionRecord
): Promise<PrincipalKind> {
  if (session.principalKind != null) return session.principalKind === "person" ? "person" : "machine";
  const kind = await classifySession(stores, session);
  await recordSessionKind(stores, session, kind);
  return kind;
}

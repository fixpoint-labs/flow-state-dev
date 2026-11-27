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
 * A birth candidate is a request written for this record: its owner,
 * organization (a request from before organizations takes the session's),
 * tenant and flow, within the host's queued grace (`queuedGraceMs`, else
 * {@link DEFAULT_QUEUED_GRACE_MS}) either side of its `createdAt`. The request
 * that starts an action is written before the run creates the session, by up
 * to a queue's wait; a session created on its own route, by a webhook
 * delivery or by a dispatch gets its first request after. So the birth
 * request is one of the candidates at or before `createdAt`, or the earliest
 * after it (one with a parent's source only for a session with a parent:
 * nothing dispatched a session that has none).
 *
 * Session deletion leaves requests behind and an id can be taken again, so a
 * candidate at or before `createdAt` may be a predecessor's, and nothing on a
 * request says which incarnation wrote it. The session reads as a kind only
 * when every request that could be its birth request reads as that kind;
 * when they disagree it reads as a machine's. A request from before the
 * window is a predecessor's; once retention prunes the birth request, the
 * oldest one left is a later turn's. Neither counts.
 *
 * A dispatched session (`internal`, `task`) takes the kind of the parent it
 * can prove dispatched it (`provesDispatchingParent`), walking up to
 * {@link MAX_LINEAGE_DEPTH} hops. Every case that proves nothing reads as a
 * machine's: no birth request, possible birth requests that disagree, no
 * parent, a parent that is missing, recreated or someone else's, a cycle, or a
 * chain past the bound. A guess of "person" would hand a webhook's or a
 * schedule's session a person's reach.
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

/** How far from a session's birth its birth request may be written: the host's `queuedGraceMs`, else its default. */
export interface BirthWindow {
  readonly queuedGraceMs?: number;
}

/** Whether `request` was written for `session`'s own record, within `windowMs` of its birth. */
function isBirthCandidate(session: SessionRecord, request: RequestRecord, windowMs: number): boolean {
  if (request.userId !== session.userId) return false;
  if ((request.orgId ?? session.orgId ?? undefined) !== (session.orgId ?? undefined)) return false;
  if ((request.tenantId ?? undefined) !== (session.tenantId ?? undefined)) return false;
  if (request.flowKind !== session.flowKind) return false;
  if ((request.flowId ?? request.flowKind) !== (session.flowId ?? session.flowKind)) return false;
  return Math.abs(request.createdAt - session.createdAt) <= windowMs;
}

/**
 * The kind `session`'s birth request reads as (see the file header): the one
 * every possible birth request agrees on, a machine's when they disagree or
 * none is stored.
 */
async function birthRequestKind(
  stores: Pick<StoreRegistry, "request">,
  session: SessionRecord,
  window: BirthWindow
): Promise<PrincipalKind | "parent"> {
  const windowMs = window.queuedGraceMs ?? DEFAULT_QUEUED_GRACE_MS;
  const tenantId = session.tenantId ?? undefined;
  // Owner, tenant and flow at the store; the rest of the check needs the record.
  const records = await stores.request.list({
    sessionId: toBareSessionId(session.id, tenantId),
    tenantId,
    userId: session.userId,
    flowKind: session.flowKind,
    orderBy: "none"
  });
  const candidates = records.filter((record) => isBirthCandidate(session, record, windowMs));
  const possible = candidates.filter((record) => record.createdAt <= session.createdAt);
  let firstAfter: RequestRecord | undefined;
  for (const record of candidates) {
    if (record.createdAt <= session.createdAt) continue;
    if (session.parentSessionId == null && firstRequestKind(record) === "parent") continue;
    if (firstAfter === undefined || record.createdAt < firstAfter.createdAt) firstAfter = record;
  }
  if (firstAfter !== undefined) possible.push(firstAfter);
  // None stored: `firstRequestKind` says what no readable request reads as.
  if (possible.length === 0) return firstRequestKind(undefined);
  const [first, ...rest] = possible.map((record) => firstRequestKind(record));
  return rest.every((kind) => kind === first) ? first! : "machine";
}

/** The kind `session` reads as from what is stored, without writing it. */
async function classifySession(
  stores: Pick<StoreRegistry, "session" | "request">,
  session: SessionRecord,
  window: BirthWindow
): Promise<PrincipalKind> {
  const seen = new Set<string>();
  let current = session;
  for (let depth = 0; depth <= MAX_LINEAGE_DEPTH; depth += 1) {
    if (current.principalKind != null) return current.principalKind === "person" ? "person" : "machine";
    if (seen.has(current.id)) return "machine";
    seen.add(current.id);
    const kind = await birthRequestKind(stores, current, window);
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
 *
 * @returns The record as the store now holds it for this incarnation: the one
 * written, the winner's after a lost race, else `session` unchanged.
 */
async function recordSessionKind(
  stores: Pick<StoreRegistry, "session">,
  session: SessionRecord,
  kind: PrincipalKind
): Promise<SessionRecord> {
  try {
    const current = await stores.session.get(session.id);
    if (current === undefined || !isSameSession(session, current)) return session;
    if (current.principalKind != null) return current;
    const written: SessionRecord = { ...current, principalKind: kind, version: current.version + 1 };
    const result = await stores.session.set(current.id, written, current.version);
    if (result.ok) return result.record ?? { ...written, version: result.version };
    const winner = result.conflict.currentValue;
    return winner !== undefined && isSameSession(session, winner) ? winner : session;
  } catch {
    // Not recorded this time: see above.
    return session;
  }
}

/**
 * The kind of the principal that created `session`, read as the file header
 * describes, and the record as it stands once a backfilled kind is written.
 * A caller that goes on to write the session builds on `session` here, never
 * on the copy it passed in, whose version the backfill has moved past.
 */
export async function resolveSessionKindRecord(
  stores: Pick<StoreRegistry, "session" | "request">,
  session: SessionRecord,
  window: BirthWindow = {}
): Promise<{ kind: PrincipalKind; session: SessionRecord }> {
  if (session.principalKind != null) return { kind: session.principalKind === "person" ? "person" : "machine", session };
  const kind = await classifySession(stores, session, window);
  return { kind, session: await recordSessionKind(stores, session, kind) };
}

/** The kind of the principal that created `session`, read as the file header describes. */
export async function resolveSessionKind(
  stores: Pick<StoreRegistry, "session" | "request">,
  session: SessionRecord,
  window: BirthWindow = {}
): Promise<PrincipalKind> {
  return (await resolveSessionKindRecord(stores, session, window)).kind;
}

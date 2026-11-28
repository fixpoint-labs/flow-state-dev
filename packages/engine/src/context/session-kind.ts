// FIX-2942; BP-030.
/**
 * The kind of the principal that created a session: a person's or a
 * machine's.
 *
 * A session born since `SessionRecord.principalKind` existed carries it. One
 * written before is classified in place, with no new config, from its birth
 * request (`firstRequestKind`), and the answer is written onto the record the
 * first time, so later retention can't change it: the session store keeps a
 * stored `principalKind` against every later write (`withWriteOnceSessionFields`).
 *
 * A birth candidate is a request written for this record: its owner,
 * organization (a request from before organizations takes the session's),
 * tenant and flow, within the host's queued grace (`queuedGraceMs`, else
 * {@link DEFAULT_QUEUED_GRACE_MS}) either side of its `createdAt`. A request's
 * own times are when its record was created (`createdAt`, at enqueue for a
 * queued action) and when it was last written (`updatedAt`, or its terminal
 * stamp): nothing on it says when its run started. The run that creates a
 * session writes its request again after the session exists (at least its
 * final status), so:
 *
 * - a request last written before the session's `createdAt` didn't create it;
 * - a request created at or before `createdAt` and still live then (last
 *   written at or after it) is a possible birth, and when there is one, only
 *   those count: a wake or a delivery that runs moments later is a turn of
 *   the session, not its birth;
 * - otherwise the earliest request after `createdAt` is the birth, whatever
 *   its source: a session created on its own route has no request of its
 *   own, so its first turn reads as its birth, and a dispatch that creates a
 *   session with its own id and state leaves it without a parent and writes
 *   its request just after.
 *
 * Session deletion leaves requests behind and an id can be taken again, and
 * nothing on a request says which incarnation wrote it. The session reads as
 * a kind only when every possible birth reads as that kind; when they
 * disagree it reads as a machine's. Once retention prunes the birth request,
 * the oldest one left is a later turn's, and doesn't count.
 *
 * Cases the stored times can't settle. Each one needs a request from the
 * session's own user, org, tenant and flow, and each affects only sessions
 * from before kinds (a session born now records its kind):
 *
 * - A predecessor's run still in flight while its session is deleted and the
 *   id is taken again looks live at the birth. Against a birth written at or
 *   before `createdAt` the two disagree and the session reads as a machine's.
 *   Against a birth written after (a dispatch, or the session-create route's
 *   first turn) it is the only live request, and the session reads as the
 *   predecessor's kind.
 * - A person request queued before the birth, which waits at the gate while
 *   a dispatch births the session, is written again after the birth. It
 *   reads as the live birth, and the session reads as a person's. That
 *   case looks exactly like a person birth followed moments later by a wake
 *   or notice delivery. Backfill favours the ordinary conversation.
 * - A queued action whose run created the session and then never wrote its
 *   request again looks finished before the birth: a crash, or a start-up
 *   throw after the session exists. The session reads as its first later
 *   turn's kind, or a machine's with none.
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
import { requestLastWrittenAtMs } from "../stores/request-ended-at";
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
  const candidates = records.filter(
    (record) => isBirthCandidate(session, record, windowMs) && requestLastWrittenAtMs(record) >= session.createdAt
  );
  const possible = candidates.filter((record) => record.createdAt <= session.createdAt);
  if (possible.length === 0) {
    let firstAfter: RequestRecord | undefined;
    for (const record of candidates) {
      if (firstAfter === undefined || record.createdAt < firstAfter.createdAt) firstAfter = record;
    }
    if (firstAfter !== undefined) possible.push(firstAfter);
  }
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

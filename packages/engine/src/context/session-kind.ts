// FIX-2942; BP-030.
/**
 * The kind of the principal that created a session: a person's or a
 * machine's.
 *
 * A session born since `SessionRecord.principalKind` existed carries it. One
 * written before is classified in place, with no new config, from its first
 * request record's source (`firstRequestKind`). A dispatched session
 * (`internal`, `task`) takes the kind of the parent it can prove dispatched
 * it (`provesDispatchingParent`), walking up to {@link MAX_LINEAGE_DEPTH}
 * hops. Every case that proves nothing reads as a machine's: no readable
 * request, no parent, a parent that is missing, recreated or someone else's,
 * a cycle, or a chain past the bound. A guess of "person" would hand a
 * webhook's or a schedule's session a person's reach.
 */
import {
  MAX_LINEAGE_DEPTH,
  provesDispatchingParent,
  resolveSessionStorageKey,
  toBareSessionId
} from "../stores/scope-keys";
import type { RequestRecord, SessionRecord, StoreRegistry } from "../stores/types";
import { firstRequestKind, type PrincipalKind } from "./principal";

/** The earliest request record of `session`, or `undefined` when none can be read. */
async function firstRequestOf(
  stores: Pick<StoreRegistry, "request">,
  session: SessionRecord
): Promise<RequestRecord | undefined> {
  const tenantId = session.tenantId ?? undefined;
  const records = await stores.request.list({
    sessionId: toBareSessionId(session.id, tenantId),
    tenantId,
    orderBy: "startedAtMs"
  });
  // Newest first: the last is the first request.
  return records.at(-1);
}

/** The kind of the principal that created `session`, read as the file header describes. */
export async function resolveSessionKind(
  stores: Pick<StoreRegistry, "session" | "request">,
  session: SessionRecord
): Promise<PrincipalKind> {
  const seen = new Set<string>();
  let current = session;
  for (let depth = 0; depth <= MAX_LINEAGE_DEPTH; depth += 1) {
    if (current.principalKind != null) return current.principalKind === "person" ? "person" : "machine";
    if (seen.has(current.id)) return "machine";
    seen.add(current.id);
    const kind = firstRequestKind(await firstRequestOf(stores, current));
    if (kind !== "parent") return kind;
    if (current.parentSessionId == null) return "machine";
    const parent = await stores.session.get(resolveSessionStorageKey(current.parentSessionId, current.tenantId ?? undefined));
    if (parent === undefined || !provesDispatchingParent(current, parent)) return "machine";
    current = parent;
  }
  return "machine";
}

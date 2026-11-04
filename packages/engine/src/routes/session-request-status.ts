/**
 * A session's latest request status, for the session listing's
 * `include=status` (FIX-2411): what a row in a list of sessions shows about
 * its turn.
 *
 * The rule is the runs listing's (`child-session-routes.ts`): a request still
 * going wins over a later one that ended, else the most recent request
 * speaks. Unlike that listing, the status goes out as the request's own, so
 * `suspended` (waiting on a person) and `interrupted` (lost to a restart) stay
 * apart: a person acts on each.
 *
 * At most two bounded reads per session, both under the session's own
 * request scope (`sessionRequestScope`), never the caller's.
 */
import type { RequestStatus } from "@flow-state-dev/core/types";
import { sessionRequestScope } from "../context/session-request-scope";
import type { RequestStore, SessionRecord } from "../stores/types";

/** A request that is still going, whether or not it is the most recent. */
const GOING: readonly RequestStatus[] = ["in_progress", "suspended"];

/**
 * The status of `session`'s latest request, or `undefined` when it has none.
 *
 * Read 1 is the most recent request. When it is still going, it is the
 * answer. Otherwise read 2 asks, unordered and `limit: 1`, whether any request
 * is still going (an earlier one finishing after a later one started); one
 * that is wins. Unordered and limited, so a session that has piled up
 * suspended records costs one row.
 */
export async function latestRequestStatus(
  store: RequestStore,
  sessionId: string,
  session: Pick<SessionRecord, "userId" | "orgId" | "flowKind" | "flowId">,
  tenantId: string | undefined
): Promise<RequestStatus | undefined> {
  const scope = sessionRequestScope(sessionId, session, tenantId);
  const [mostRecent] = await store.list({ ...scope, orderBy: "startedAtMs", limit: 1 });
  if (mostRecent === undefined) return undefined;
  if (GOING.includes(mostRecent.status)) return mostRecent.status;
  const [going] = await store.list({ ...scope, status: GOING, orderBy: "none", limit: 1 });
  return going?.status ?? mostRecent.status;
}

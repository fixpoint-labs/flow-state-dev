/**
 * A session's latest request status, for the session listing's
 * `include=status` (FIX-2411): what a row in a list of sessions shows about
 * its turn.
 *
 * The rule is the runs listing's (`child-session-routes.ts`): a request still
 * going wins over a later one that ended, else the most recent request
 * speaks. Unlike that listing, the status goes out as the request's own, so
 * `suspended` (stopped) and `interrupted` (lost to a restart) stay apart: a
 * person acts on each.
 *
 * `suspended` covers two stops a person tells apart: one that waits for them
 * (a question, an approval) and one that waits on other work (a reply from
 * another worker), which resumes by itself. `waitsForUser` says which.
 *
 * At most two bounded reads per session, both under the session's own
 * request scope (`sessionRequestScope`), never the caller's, and one read of
 * the session's pending suspensions when the answer is `suspended`.
 */
import type { RequestStatus } from "@flow-state-dev/core/types";
import { isUserSuspension } from "@flow-state-dev/core/types";
import { sessionRequestScope } from "../context/session-request-scope";
import type { RequestRecord, RequestStore, SessionRecord, SuspensionStore } from "../stores/types";

/** A request that is still going, whether or not it is the most recent. */
const GOING: readonly RequestStatus[] = ["in_progress", "suspended"];

/** What a listed row says about its session's turn. */
export type LatestRequestStatus = {
  readonly status: RequestStatus;
  /** Set when `status` is `suspended`: whether a stop waits for the user. */
  readonly waitsForUser?: boolean;
};

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
  stores: { readonly request: RequestStore; readonly suspensions: SuspensionStore },
  sessionId: string,
  session: Pick<SessionRecord, "userId" | "orgId" | "flowKind" | "flowId">,
  tenantId: string | undefined
): Promise<LatestRequestStatus | undefined> {
  const scope = sessionRequestScope(sessionId, session, tenantId);
  const [mostRecent] = await stores.request.list({ ...scope, orderBy: "startedAtMs", limit: 1 });
  if (mostRecent === undefined) return undefined;
  let latest: RequestRecord = mostRecent;
  if (!GOING.includes(mostRecent.status)) {
    const [going] = await stores.request.list({ ...scope, status: GOING, orderBy: "none", limit: 1 });
    if (going !== undefined) latest = going;
  }
  if (latest.status !== "suspended") return { status: latest.status };
  // The request id came from the tenant's own request store, so matching it
  // keeps another tenant's suspension of the same bare session id out.
  const pending = await stores.suspensions.list({ sessionId, userId: session.userId, status: "pending" });
  return {
    status: "suspended",
    waitsForUser: pending.some((stop) => stop.requestId === latest.id && isUserSuspension(stop))
  };
}

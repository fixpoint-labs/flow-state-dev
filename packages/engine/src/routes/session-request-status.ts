/**
 * A session's latest request status, for the session listing's
 * `include=status`: what a row in a list of sessions shows about
 * its turn.
 *
 * Which request speaks is the runs listing's rule, read through its one
 * helper ({@link governingRequest}): a live request wins over a later one
 * that ended, else the most recent request speaks. Unlike that listing, the
 * status goes out as the request's own, so `suspended` (stopped) and
 * `interrupted` (lost to a restart) stay apart: the user acts on each.
 *
 * `suspended` covers two stops the user tells apart: one that waits for them
 * (a question, an approval) and one that waits on other work (a reply from
 * another worker), which resumes by itself. `waitsForUser` says which.
 *
 * At most two bounded reads per session, both under the session's own
 * request scope (`sessionRequestScope`), never the caller's, and one read of
 * the session's pending suspensions when the answer is `suspended`.
 */
import { isUserSuspension } from "@flow-state-dev/core/types";
import type { RequestStatus } from "@flow-state-dev/core/types";
import { sessionRequestScope } from "../context/session-request-scope";
import type { RequestStore, SessionRecord, SuspensionStore } from "../stores/types";
import { governingRequest } from "./child-session-routes";

/** What a listed row says about its session's turn. */
export type LatestRequestStatus = {
  readonly status: RequestStatus;
  /** Set when `status` is `suspended`: whether a stop waits for the user. */
  readonly waitsForUser?: boolean;
};

/** The status of `session`'s latest request, or `undefined` when it has none. */
export async function latestRequestStatus(
  stores: {
    readonly request: RequestStore;
    /**
     * Where the run's stops are kept: the host's durability provider when it
     * has one (`runAction` writes stops through it), else the suspension store
     * the default provider writes to.
     */
    readonly listSuspended: SuspensionStore["list"];
  },
  sessionId: string,
  session: Pick<SessionRecord, "userId" | "orgId" | "flowKind" | "flowId">,
  tenantId: string | undefined
): Promise<LatestRequestStatus | undefined> {
  const latest = await governingRequest(stores.request, sessionRequestScope(sessionId, session, tenantId));
  if (latest === undefined) return undefined;
  if (latest.status !== "suspended") return { status: latest.status };
  // The suspension filter has no request id, so this lists the session's
  // pending stops (owner-scoped, usually one or two) and matches the request
  // here. The request id came from the tenant's own request store, so
  // matching it keeps another tenant's suspension of the same bare session id
  // out.
  const pending = await stores.listSuspended({ sessionId, userId: session.userId, status: "pending" });
  return {
    status: "suspended",
    waitsForUser: pending.some((stop) => stop.requestId === latest.id && isUserSuspension(stop))
  };
}

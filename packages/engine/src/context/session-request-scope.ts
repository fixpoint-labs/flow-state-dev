/**
 * The one filter for which stored requests belong to a session.
 *
 * Shared by every reader of a session's request history: the session's
 * request listing, snapshot and stream routes, and the cross-turn history a
 * run in the session hands its model (`createExecutionContext`). One definition, so a request a
 * session's reads leave out can never reach a model through the history load.
 */
import { matchesOrgFilter, matchesTenantFilter } from "../stores/scope-keys";
import type { RequestRecord, SessionRecord } from "../stores/types";

/**
 * The request filter for what a session shows, in its snapshot and its
 * stream, and in the history a run in it loads: requests made in it (by bare
 * id) under its tenant, its owner and its organization.
 *
 * Every request that runs in a session carries its owner and organization;
 * `createExecutionContext` refuses any other. A request record under the id
 * with another owner or organization is one that was refused there, or one an
 * earlier session under the same id left behind, and it is not this session's
 * to show. Every key is present, so an `undefined` tenant or organization
 * exact-matches unbound records rather than lifting the filter.
 *
 * And the session's own flow, as the request listing filters it: its kind,
 * and its owning instance when the session records one. The session's flow is
 * what admitted the caller, so it never authorizes another flow's run. Today
 * admission refuses a run of any other instance into a session, but a session
 * written before that check can hold one, and neither a read of the session
 * nor a run in it may use its items. A legacy session with no owning instance
 * keeps the kind filter alone, as the listing does.
 *
 * A session not yet persisted (a run's first turn) is scoped by the record the
 * run is about to create, which always carries `flowId`, so its first history
 * load is exact-owner even where a legacy session of the same kind is kind-only.
 *
 * @param sessionId The bare session id, as request records carry it.
 * @param session The session's owner facts: its own record, already read for
 *   the caller's tenant, or the record a run is about to create.
 * @param tenantId The caller's tenant.
 */
export function sessionRequestScope(
  sessionId: string,
  session: Pick<SessionRecord, "userId" | "orgId" | "flowKind" | "flowId">,
  tenantId: string | undefined
): {
  sessionId: string;
  tenantId: string | undefined;
  userId: string;
  orgId: string | undefined;
  flowKind: string;
  flowId?: string;
} {
  return {
    sessionId,
    tenantId,
    userId: session.userId,
    orgId: session.orgId ?? undefined,
    flowKind: session.flowKind,
    ...(session.flowId != null ? { flowId: session.flowId } : {})
  };
}

/**
 * Whether `record` is a request {@link sessionRequestScope} selects: the one
 * filter, applied to a single record read by id. Every key is matched exactly,
 * as the store filters match a present key.
 *
 * @param record The stored request.
 * @param scope The session's scope, from {@link sessionRequestScope}.
 */
export function requestInSessionScope(
  record: Pick<RequestRecord, "sessionId" | "tenantId" | "userId" | "orgId" | "flowKind" | "flowId">,
  scope: ReturnType<typeof sessionRequestScope>
): boolean {
  return (
    record.sessionId === scope.sessionId &&
    matchesTenantFilter(scope, record.tenantId) &&
    record.userId === scope.userId &&
    matchesOrgFilter(scope, record.orgId) &&
    record.flowKind === scope.flowKind &&
    (scope.flowId === undefined || record.flowId === scope.flowId)
  );
}

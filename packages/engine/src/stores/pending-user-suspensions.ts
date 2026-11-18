// FIX-2770; FIX-2683 ER-6.
/**
 * `SuspensionStore.listPendingForUser` for the stores that keep records in
 * JavaScript (memory and filesystem): each pending suspension of the user
 * joined to its request, read from the request store the registry factory
 * hands the suspension store. The predicates are the SQL adapters' `WHERE`,
 * the tenant and organization by `matchesTenantFilter` and `matchesOrgFilter`
 * with both keys always present, so an unbound principal matches only
 * unbound requests.
 */
import {
  USER_SUSPENSION_REASONS,
  projectUserSuspension,
  type PendingUserSuspension,
  type PendingUserSuspensionCursor,
  type PendingUserSuspensionQuery,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import { FlowStateConfigError } from "../errors/flow-error";
import { matchesOrgFilter, matchesTenantFilter } from "./scope-keys";
import type { RequestStore } from "./types";

/** What a JS suspension store reads its requests through. */
export type SuspensionRequestReads = Pick<RequestStore, "get">;

const USER_REASONS: ReadonlySet<string> = new Set(USER_SUSPENSION_REASONS);

/** `a` against `b` by `(createdAt, requestId, suspensionId)`, ids by code unit as the SQL stores order them. */
function compareAge(a: PendingUserSuspensionCursor, b: PendingUserSuspensionCursor): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.requestId !== b.requestId) return a.requestId < b.requestId ? -1 : 1;
  return a.suspensionId < b.suspensionId ? -1 : a.suspensionId > b.suspensionId ? 1 : 0;
}

/** Whether `record` sorts strictly after `after`. A suspension id is unique only within its request. */
function isAfter(record: SuspensionRecord, after: PendingUserSuspensionCursor | undefined): boolean {
  return after === undefined || compareAge(record, after) > 0;
}

/** The refusal a suspension store built without its request store gives the read. */
export function missingRequestStore(factory: string): FlowStateConfigError {
  return new FlowStateConfigError(
    `${factory} was built without \`requests\`, the request store a user's pending suspensions are joined to. ` +
      "Pass it (`createInMemoryStores` and `createFilesystemStores` do)."
  );
}

/**
 * The user's pending suspensions among `records`, each joined to its request
 * and projected. Suspension-side predicates run first, so a request is read
 * only for a row that could be listed.
 */
export async function listPendingForUser(
  records: Iterable<SuspensionRecord>,
  requests: SuspensionRequestReads,
  query: PendingUserSuspensionQuery
): Promise<PendingUserSuspension[]> {
  const kinds = new Set(query.flowKinds);
  const candidates = [...records]
    .filter(
      (record) =>
        record.status === "pending" &&
        record.userId === query.userId &&
        USER_REASONS.has(record.reason) &&
        (record.expiresAt == null || record.expiresAt > query.now) &&
        isAfter(record, query.after)
    )
    .sort(compareAge);
  const rows: PendingUserSuspension[] = [];
  for (const record of candidates) {
    if (rows.length >= query.limit) break;
    const request = await requests.get(record.requestId);
    if (
      request === undefined ||
      request.userId !== query.userId ||
      !kinds.has(request.flowKind) ||
      !matchesTenantFilter({ tenantId: query.tenantId }, request.tenantId) ||
      !matchesOrgFilter({ orgId: query.orgId }, request.orgId)
    ) {
      continue;
    }
    rows.push(
      projectUserSuspension({
        suspensionId: record.suspensionId,
        requestId: record.requestId,
        flowKind: request.flowKind,
        flowId: request.flowId ?? record.flowId,
        sessionId: request.sessionId,
        reason: record.reason,
        kind: record.kind,
        title: record.title,
        message: record.message,
        allow: record.allow,
        resumeSchema: record.resumeSchema,
        render: record.render,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt
      })
    );
  }
  return rows;
}

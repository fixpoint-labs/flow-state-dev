/**
 * PostgreSQL SessionStore implementation.
 * Delegates CRUD and list to the generic pg record store with session-specific column mappings.
 */

import type {
  SessionListOptions,
  SessionRecord,
  SessionStore
} from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";
import { createPgRecordStore, nullSafeEqualsClause } from "./pg-store";

export function createPostgresSessionStore(executor: QueryExecutor): SessionStore {
  return createPgRecordStore<SessionRecord, SessionListOptions>(executor, {
    tableName: "sessions",
    columns: ["flow_kind", "user_id", "org_id", "tenant_id", "parent_session_id"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.orgId ?? null,
      record.tenantId ?? null,
      record.parentSessionId ?? null
    ],
    toWhere: (options, nextParam = 1) => {
      const parts: string[] = [];
      const params: unknown[] = [];
      let p = nextParam;

      if (options?.flowKind !== undefined) {
        parts.push(`flow_kind = $${p++}`);
        params.push(options.flowKind);
      }
      if (options?.userId !== undefined) {
        parts.push(`user_id = $${p++}`);
        params.push(options.userId);
      }
      // Tenant filter (FIX-682): present (incl. explicit undefined) → NULL-safe
      // exact match; absent → no filter. Same semantics as the server-side
      // `matchesTenantFilter` (NULL = NULL), emitted in the indexable form —
      // see `nullSafeEqualsClause`.
      if (options !== undefined && "tenantId" in options) {
        const tenant = nullSafeEqualsClause("tenant_id", options.tenantId, p);
        parts.push(tenant.clause);
        params.push(...tenant.params);
        p = tenant.nextParam;
      }
      // Org filter (FIX-1010): same present-vs-absent NULL-safe semantics as
      // the tenant clause, mirroring the server-side `matchesOrgFilter`.
      if (options !== undefined && "orgId" in options) {
        const org = nullSafeEqualsClause("org_id", options.orgId, p);
        parts.push(org.clause);
        params.push(...org.params);
        p = org.nextParam;
      }
      // Parentage filter (FIX-1009). Mirrors the server-side
      // `matchesParentageFilter` predicate, which is the source of truth — this
      // package cannot import it across the type-only boundary. Note absence
      // *narrows* here, the opposite of the tenant clause above: no `parentage`
      // means top-level only.
      const parentage = options?.parentage ?? "top-level";
      if (parentage === "top-level") {
        parts.push("parent_session_id IS NULL");
      } else if (parentage !== "all") {
        parts.push(`parent_session_id = $${p++}`);
        params.push(parentage.parentOf);
      }
      // `"all"` emits no clause at all — today's unrestricted query, unchanged.

      return { clause: parts.join(" AND "), params };
    },
    // FIX-1010: `createdAt` orders on two immutable columns so a session
    // record rewritten mid-walk (a run starting stamps `updated_at`) cannot
    // reorder a caller's pages. Anything else keeps the shipped default.
    resolveOrderBy: (options) =>
      options?.orderBy === "createdAt" ? "created_at DESC, id DESC" : "updated_at DESC"
  });
}

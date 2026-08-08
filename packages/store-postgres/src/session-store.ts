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
import { createPgRecordStore } from "./pg-store";

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
      // exact match; absent → no filter. `IS NOT DISTINCT FROM` matches the
      // server-side `matchesTenantFilter` semantics (NULL = NULL).
      if (options !== undefined && "tenantId" in options) {
        parts.push(`tenant_id IS NOT DISTINCT FROM $${p++}`);
        params.push(options.tenantId ?? null);
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
    }
  });
}

import type Database from "better-sqlite3";
import type {
  SessionListOptions,
  SessionRecord,
  SessionStore
} from "@flow-state-dev/engine";
import { createSQLiteRecordStore } from "./sqlite-store";

export function createSQLiteSessionStore(db: Database.Database): SessionStore {
  return createSQLiteRecordStore<SessionRecord, SessionListOptions>(db, {
    tableName: "sessions",
    columns: ["flow_kind", "user_id", "org_id", "tenant_id", "parent_session_id"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.orgId ?? null,
      record.tenantId ?? null,
      record.parentSessionId ?? null
    ],
    toWhere: (options) => {
      const parts: string[] = [];
      const params: unknown[] = [];

      if (options?.flowKind !== undefined) {
        parts.push("flow_kind = ?");
        params.push(options.flowKind);
      }
      if (options?.userId !== undefined) {
        parts.push("user_id = ?");
        params.push(options.userId);
      }
      // Tenant filter (FIX-682): present (incl. explicit undefined) → exact
      // match via NULL-safe `IS`; absent → no filter. Mirrors the server-side
      // `matchesTenantFilter` predicate.
      if (options !== undefined && "tenantId" in options) {
        parts.push("tenant_id IS ?");
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
        parts.push("parent_session_id = ?");
        params.push(parentage.parentOf);
      }
      // `"all"` emits no clause at all — today's unrestricted query, unchanged.

      return { clause: parts.join(" AND "), params };
    }
  });
}

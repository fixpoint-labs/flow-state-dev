import type Database from "better-sqlite3";
import type {
  SessionListOptions,
  SessionRecord,
  SessionStore
} from "@flow-state-dev/server";
import { createSQLiteRecordStore } from "./sqlite-store";

export function createSQLiteSessionStore(db: Database.Database): SessionStore {
  return createSQLiteRecordStore<SessionRecord, SessionListOptions>(db, {
    tableName: "sessions",
    columns: ["flow_kind", "user_id", "org_id", "tenant_id"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.orgId ?? null,
      record.tenantId ?? null
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

      return { clause: parts.join(" AND "), params };
    }
  });
}

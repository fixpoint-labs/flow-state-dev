/**
 * PostgreSQL SessionStore implementation.
 * Delegates CRUD and list to the generic pg record store with session-specific column mappings.
 */

import type {
  SessionListOptions,
  SessionRecord,
  SessionStore
} from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";
import { createPgRecordStore } from "./pg-store";

export function createPostgresSessionStore(executor: QueryExecutor): SessionStore {
  return createPgRecordStore<SessionRecord, SessionListOptions>(executor, {
    tableName: "sessions",
    columns: ["flow_kind", "user_id", "org_id"],
    toRow: (record) => [record.flowKind, record.userId, record.orgId ?? null],
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

      return { clause: parts.join(" AND "), params };
    }
  });
}

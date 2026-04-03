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
    columns: ["flow_kind", "user_id", "project_id"],
    toRow: (record) => [record.flowKind, record.userId, record.projectId ?? null],
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

      return { clause: parts.join(" AND "), params };
    }
  });
}

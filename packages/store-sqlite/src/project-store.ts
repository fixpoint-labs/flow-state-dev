import type Database from "better-sqlite3";
import type {
  ProjectListOptions,
  ProjectRecord,
  ProjectStore
} from "@flow-state-dev/server";
import { createSQLiteRecordStore } from "./sqlite-store";

export function createSQLiteProjectStore(db: Database.Database): ProjectStore {
  return createSQLiteRecordStore<ProjectRecord, ProjectListOptions>(db, {
    tableName: "projects",
    columns: ["user_id"],
    toRow: (record) => [record.userId ?? null],
    toWhere: (options) => {
      const parts: string[] = [];
      const params: unknown[] = [];

      if (options?.userId !== undefined) {
        parts.push("user_id = ?");
        params.push(options.userId);
      }

      return { clause: parts.join(" AND "), params };
    }
  });
}

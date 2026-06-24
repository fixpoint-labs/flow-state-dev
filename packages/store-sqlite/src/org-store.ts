import type Database from "better-sqlite3";
import type {
  OrgListOptions,
  OrgRecord,
  OrgStore
} from "@flow-state-dev/engine";
import { createSQLiteRecordStore } from "./sqlite-store";

export function createSQLiteOrgStore(db: Database.Database): OrgStore {
  return createSQLiteRecordStore<OrgRecord, OrgListOptions>(db, {
    tableName: "orgs",
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

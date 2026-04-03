import type Database from "better-sqlite3";
import type {
  UserListOptions,
  UserRecord,
  UserStore
} from "@flow-state-dev/server";
import { createSQLiteRecordStore } from "./sqlite-store";

export function createSQLiteUserStore(db: Database.Database): UserStore {
  return createSQLiteRecordStore<UserRecord, UserListOptions>(db, {
    tableName: "users",
    columns: [],
    toRow: () => [],
    toWhere: () => ({ clause: "", params: [] })
  });
}

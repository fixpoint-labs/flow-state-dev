/**
 * PostgreSQL UserStore implementation.
 * Delegates CRUD and list to the generic pg record store. No indexed filter columns.
 */

import type {
  UserListOptions,
  UserRecord,
  UserStore
} from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";
import { createPgRecordStore } from "./pg-store";

export function createPostgresUserStore(executor: QueryExecutor): UserStore {
  return createPgRecordStore<UserRecord, UserListOptions>(executor, {
    tableName: "users",
    columns: [],
    toRow: () => [],
    toWhere: () => ({ clause: "", params: [] })
  });
}

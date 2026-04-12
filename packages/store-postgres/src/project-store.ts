/**
 * PostgreSQL ProjectStore implementation.
 * Delegates CRUD and list to the generic pg record store with userId filter support.
 */

import type {
  ProjectListOptions,
  ProjectRecord,
  ProjectStore
} from "@flow-state-dev/server";
import type { QueryExecutor } from "./types";
import { createPgRecordStore } from "./pg-store";

export function createPostgresProjectStore(executor: QueryExecutor): ProjectStore {
  return createPgRecordStore<ProjectRecord, ProjectListOptions>(executor, {
    tableName: "projects",
    columns: ["user_id"],
    toRow: (record) => [record.userId ?? null],
    toWhere: (options, nextParam = 1) => {
      const parts: string[] = [];
      const params: unknown[] = [];
      let p = nextParam;

      if (options?.userId !== undefined) {
        parts.push(`user_id = $${p++}`);
        params.push(options.userId);
      }

      return { clause: parts.join(" AND "), params };
    }
  });
}

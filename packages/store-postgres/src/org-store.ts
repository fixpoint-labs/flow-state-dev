/**
 * PostgreSQL OrgStore implementation.
 * Delegates CRUD and list to the generic pg record store with userId filter support.
 */

import type {
  OrgListOptions,
  OrgRecord,
  OrgStore
} from "@flow-state-dev/engine";
import type { QueryExecutor } from "./types";
import { createPgRecordStore } from "./pg-store";

export function createPostgresOrgStore(executor: QueryExecutor): OrgStore {
  return createPgRecordStore<OrgRecord, OrgListOptions>(executor, {
    tableName: "orgs",
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

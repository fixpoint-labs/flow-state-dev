import type Database from "better-sqlite3";
import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  RequestListOptions,
  RequestRecord,
  RequestStore
} from "@flow-state-dev/server";
import { createSQLiteRecordStore } from "./sqlite-store";

export function createSQLiteRequestStore(db: Database.Database): RequestStore {
  const base = createSQLiteRecordStore<RequestRecord, RequestListOptions>(db, {
    tableName: "requests",
    columns: ["flow_kind", "user_id", "session_id", "project_id", "status"],
    toRow: (record) => [
      record.flowKind,
      record.userId,
      record.sessionId ?? null,
      record.projectId ?? null,
      record.status
    ],
    toWhere: (options) => {
      const parts: string[] = [];
      const params: unknown[] = [];

      if (options?.flowKind !== undefined) {
        parts.push("flow_kind = ?");
        params.push(options.flowKind);
      }
      if (options?.sessionId !== undefined) {
        parts.push("session_id = ?");
        params.push(options.sessionId);
      }
      if (options?.userId !== undefined) {
        parts.push("user_id = ?");
        params.push(options.userId);
      }
      if (options?.status !== undefined) {
        parts.push("status = ?");
        params.push(options.status);
      }

      return { clause: parts.join(" AND "), params };
    }
  });

  const pendingItemWrites = new Set<string>();

  const getStmt = db.prepare("SELECT data FROM requests WHERE id = ?");
  const updateItemsStmt = db.prepare(
    "UPDATE requests SET data = ?, updated_at = ? WHERE id = ?"
  );

  return {
    get: base.get,
    set: base.set,
    delete: base.delete,
    list: base.list,

    persistItems(requestId: string, items: OutputItem[]): void {
      if (pendingItemWrites.has(requestId)) return;
      pendingItemWrites.add(requestId);

      queueMicrotask(() => {
        pendingItemWrites.delete(requestId);
        const row = getStmt.get(requestId) as { data: string } | undefined;
        if (row !== undefined) {
          const current = JSON.parse(row.data) as RequestRecord;
          const updatedAt = Date.now();
          const updated = { ...current, items, updatedAt };
          updateItemsStmt.run(JSON.stringify(updated), updatedAt, requestId);
        }
      });
    },

    async flushItems(_requestId: string): Promise<void> {
      // No-op: queueMicrotask writes complete before any await resumes
    }
  };
}

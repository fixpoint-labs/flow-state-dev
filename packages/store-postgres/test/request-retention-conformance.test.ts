/**
 * Retention reused-id conformance on the Postgres stores (PGlite): a request
 * id freed by retention must not carry its previous run's stream events to a
 * new owner. Also pins the order of `delete`, which has no transaction to
 * lean on: the record goes last.
 */
import type { PGlite } from "@electric-sql/pglite";
import type { RequestRecord } from "@flow-state-dev/engine";
import {
  createRequestRetentionConformanceTests,
  makeRequestStreamEvent
} from "@flow-state-dev/engine/testing";
import { describe, expect, it } from "vitest";
import {
  createPostgresRequestStore,
  createPostgresStores,
  initializeSchema,
  type QueryExecutor
} from "../src";
import { freshPglite } from "./shared-pglite";

function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

createRequestRetentionConformanceTests({
  name: "Postgres stores",
  createStores: async () => createPostgresStores({ executor: pgliteExecutor(await freshPglite()) })
});

describe("Postgres request delete order", () => {
  it("a failed event delete keeps the record, so nothing is left without an owner", async () => {
    const executor = pgliteExecutor(await freshPglite());
    await initializeSchema(executor);
    let failEventDelete = false;
    const store = createPostgresRequestStore({
      async query(text, values) {
        if (failEventDelete && text.startsWith("DELETE FROM request_events")) {
          throw new Error("event delete failed");
        }
        return executor.query(text, values);
      }
    });

    const requestId = "req_delete_order";
    const record: RequestRecord = {
      id: requestId,
      flowKind: "f",
      actionName: "run",
      userId: "u",
      status: "completed",
      startedAtMs: 1,
      completedAtMs: 2,
      version: 1,
      createdAt: 1,
      updatedAt: 2,
      state: {}
    };
    await store.set(requestId, record, "any");
    store.persistEvents(requestId, [makeRequestStreamEvent(requestId, 1)]);
    await store.flushEvents(requestId);

    failEventDelete = true;
    await expect(store.delete(requestId)).rejects.toThrow("event delete failed");

    // The record still holds the id: no one can claim it while its events remain.
    expect(await store.get(requestId)).toBeDefined();
    expect(await store.getEvents(requestId)).toHaveLength(1);

    // And the delete can simply be retried.
    failEventDelete = false;
    await store.delete(requestId);
    expect(await store.get(requestId)).toBeUndefined();
    expect(await store.getEvents(requestId)).toEqual([]);
  });
});

/**
 * A request's items are in the store by the time its status reads settled.
 *
 * The SQLite request store keeps items out of the record row: `set` drops
 * `items`, and only `persistItems` writes `request_items`. Until the terminal
 * write persisted its own items, a settled request's last items reached the
 * table only through the emitter's `item.done` hook, which fires after the
 * event is appended — after an `onEvent` the emitter awaits. A block's trace
 * is closed without waiting on that, so behind a live stream that yields even
 * once the run wrote `completed` first, and a poller read the status with the
 * root block_trace (the action's output) missing.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { createResponseEmitter, runAction } from "@flow-state-dev/engine";
import type { RequestRecord } from "@flow-state-dev/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSQLiteStores } from "../src/index";

describe("a settled request's items on SQLite", () => {
  let dir: string | undefined;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // The root block_trace (which carries the action's output) is captured
    // only with trace observability on, as it is under `fsdev dev`.
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("holds the root block_trace's output when the status first reads completed, even behind a slow live stream", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsd-settled-items-"));
    const stores = createSQLiteStores({ filename: join(dir, "request.db") });
    const requestId = "req_settled_items";

    const flow = defineFlow({
      kind: "settled-items",
      actions: {
        answer: {
          inputSchema: z.object({}),
          block: handler({
            name: "answer-door",
            inputSchema: z.object({}),
            outputSchema: z.object({ outcome: z.string() }),
            execute: async () => ({ outcome: "declined" })
          })
        }
      }
    })({ id: "settled-items" });

    // A live stream whose `onEvent` yields on a block_trace's `item.done` (the
    // emitter's contract allows a Promise). The run does not wait on it.
    const response = createResponseEmitter({
      requestId,
      onEvent: async (event) => {
        if (event.type === "item.done" && event.item.type === "block_trace") {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    });

    // What a poller sees the moment the terminal status lands: read the record
    // straight after the write that settles it, before anything else runs.
    let atSettle: RequestRecord | undefined;
    const set = stores.request.set.bind(stores.request);
    stores.request.set = async (id, value, expectedVersion) => {
      const result = await set(id, value, expectedVersion);
      if (id === requestId && value.status === "completed" && atSettle === undefined) {
        atSettle = await stores.request.get(id);
      }
      return result;
    };

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "answer",
      input: {},
      requestId,
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: {},
      responseEmitter: response
    });

    expect(atSettle?.status).toBe("completed");
    const root = (atSettle?.items ?? []).find(
      (item): item is BlockTraceItem =>
        item.type === "block_trace" && item.blockInstanceId === `${requestId}:root:0`
    );
    expect(root?.status).toBe("completed");
    expect(root?.output).toEqual({ kind: "inline", value: { outcome: "declined" } });

    // Let the slow stream drain before the database closes.
    await new Promise((resolve) => setTimeout(resolve, 100));
    stores.close();
  });
});

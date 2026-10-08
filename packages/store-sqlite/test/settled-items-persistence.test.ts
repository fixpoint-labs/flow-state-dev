/**
 * A request's items are in the store by the time its status reads settled.
 *
 * The SQLite request store keeps items out of the record row, in
 * `request_items`. While the request runs, its items reach the table through
 * the emitter's `item.done` hook, which fires after the event is appended —
 * after an `onEvent` the emitter awaits. A block's trace is closed without
 * waiting on that, so behind a live stream that yields even once the run
 * writes `completed` before the hook has persisted the root block_trace (the
 * action's output). The write that settles the request carries its items and
 * lands them with the status, so a poller never reads the status without it.
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
    const yielded: Promise<void>[] = [];
    const response = createResponseEmitter({
      requestId,
      onEvent: (event) => {
        if (event.type !== "item.done" || event.item.type !== "block_trace") return;
        const pending = new Promise<void>((resolve) => setTimeout(resolve, 0));
        yielded.push(pending);
        return pending;
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

    // Let the stream's pending events finish before the database closes.
    await Promise.all(yielded);
    await new Promise((resolve) => setImmediate(resolve));
    stores.close();
  });
});

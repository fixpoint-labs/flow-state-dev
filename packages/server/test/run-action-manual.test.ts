/**
 * Tests for the non-HTTP affordances on `runAction` (FIX-504): the returned
 * `requestId` and the `onItem` live-subscription convenience. These are what
 * let code outside any transport (cron, queue consumers, background jobs) run a
 * flow, correlate it by id, and observe items as they happen without assembling
 * its own `ResponseEmitter`.
 *
 * Every test runs with no router, no `Request`, and no transport host — that
 * absence is the point: this is the sanctioned non-HTTP path.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runAction } from "../src";

/** A trivial single-handler flow that emits one assistant message. */
function buildMessageFlow() {
  return defineFlow({
    kind: "manual-message",
    actions: {
      greet: {
        inputSchema: z.object({ name: z.string() }),
        block: handler({
          name: "greet",
          inputSchema: z.object({ name: z.string() }),
          outputSchema: z.string(),
          execute: ({ name }, ctx) => {
            ctx.emit.message(`Hello, ${name}`);
            return `greeted:${name}`;
          }
        })
      }
    }
  })();
}

describe("runAction — non-HTTP affordances", () => {
  it("returns the requestId on the ExecutionResult", async () => {
    const result = await runAction({
      flow: buildMessageFlow(),
      actionName: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(typeof result.requestId).toBe("string");
    expect(result.requestId?.length).toBeGreaterThan(0);
  });

  it("echoes a caller-supplied requestId on the result", async () => {
    const result = await runAction({
      flow: buildMessageFlow(),
      actionName: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      requestId: "req_manual_42",
      stores: createInMemoryStores(),
      runtimeConfig: {}
    });

    expect(result.requestId).toBe("req_manual_42");
  });

  it("delivers emitted items to onItem with valid kinds", async () => {
    const received: Array<{ type: string; kind: string }> = [];
    const result = await runAction({
      flow: buildMessageFlow(),
      actionName: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores: createInMemoryStores(),
      runtimeConfig: {},
      onItem: (item, kind) => received.push({ type: item.type, kind })
    });

    expect(result.error).toBeUndefined();
    const messages = received.filter((r) => r.type === "message");
    expect(messages.length).toBeGreaterThan(0);
    for (const r of received) {
      expect(["added", "updated", "done"]).toContain(r.kind);
    }
  });

  it("delivers transient items to onItem but keeps them out of the persisted record", async () => {
    // onItem is the live fan-out, same as a connected SSE client: it sees
    // transient items (live-only), which never reach the persisted item log.
    const flow = defineFlow({
      kind: "manual-transient",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "transient-emitter",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: (_input, ctx) => {
              ctx.emit.message("ephemeral", { transient: true });
              return "done";
            }
          })
        }
      }
    })();

    const stores = createInMemoryStores();
    const received: Array<{ type: string; transient?: boolean }> = [];
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      stores,
      runtimeConfig: {},
      onItem: (item) => received.push({ type: item.type, transient: item.transient })
    });

    const liveTransient = received.filter(
      (r) => r.type === "message" && r.transient === true
    );
    expect(liveTransient.length).toBeGreaterThan(0);

    const record = await stores.request.get(result.requestId ?? "");
    const persistedTransient = (record?.items ?? []).filter(
      (item) => item.type === "message" && item.transient === true
    );
    expect(persistedTransient).toEqual([]);
  });

  it("resumes event numbering from startSequenceNumber", async () => {
    // Queue consumers re-running an action under the same requestId (e.g. a
    // BullMQ retry attempt) pass the last persisted sequence number so the
    // event log stays strictly increasing — tailing clients filter on
    // `sequence_number > cursor` and would never see a restarted sequence.
    const stores = createInMemoryStores();
    const result = await runAction({
      flow: buildMessageFlow(),
      actionName: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      requestId: "req_seq_resume",
      startSequenceNumber: 100,
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    const events = await stores.request.getEvents("req_seq_resume");
    expect(events.length).toBeGreaterThan(0);
    expect(Math.min(...events.map((e) => e.sequence_number))).toBe(101);
  });
});

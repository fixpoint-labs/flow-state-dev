/**
 * Tests for FIX-504: the `runFlow` sanctioned non-HTTP flow entry point.
 *
 * Every test here runs with no router, no `Request`, and no transport host —
 * that absence is itself the success criterion (§7 behaviour 7): `runFlow` is
 * the path for code that lives outside any transport. The behaviours assert the
 * load-bearing additions over bare `runAction`: a returned `requestId` handed
 * back before the run completes, an `onItem` convenience over
 * `subscribeToItems`, a `finished` promise carrying the terminal result, and
 * `source` provenance defaulting to `"manual"`.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { defineFlow, handler } from "@flow-state-dev/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInMemoryStores, runFlow, ValidationError } from "../src";

/**
 * A trivial single-handler flow that emits one assistant message and returns a
 * string. No generator, so no `modelResolver` is needed.
 */
function buildMessageFlow() {
  return defineFlow({
    kind: "run-flow-message",
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

describe("runFlow", () => {
  it("returns a handle with a requestId before the run completes", async () => {
    const handle = await runFlow(buildMessageFlow(), {
      action: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores: createInMemoryStores()
    });

    expect(typeof handle.requestId).toBe("string");
    expect(handle.requestId.length).toBeGreaterThan(0);
    expect(handle.status).toBe("in_progress");

    await handle.finished;
  });

  it("resolves finished with the terminal ExecutionResult", async () => {
    const handle = await runFlow(buildMessageFlow(), {
      action: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores: createInMemoryStores()
    });

    const result = await handle.finished;
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("greeted:Ada");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("delivers emitted items to onItem with valid kinds", async () => {
    const received: Array<{ type: string; kind: string }> = [];
    const handle = await runFlow(buildMessageFlow(), {
      action: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores: createInMemoryStores(),
      onItem: (item, kind) => received.push({ type: item.type, kind })
    });

    await handle.finished;

    const messages = received.filter((r) => r.type === "message");
    expect(messages.length).toBeGreaterThan(0);
    for (const r of received) {
      expect(["added", "updated", "done"]).toContain(r.kind);
    }
  });

  it("delivers transient items to onItem (live-stream semantics)", async () => {
    // onItem is a thin pass-through over subscribeToItems, the same live fan-out
    // that feeds connected SSE clients. Transient items are live-only (not
    // persisted), but a live consumer still sees them — so onItem does too.
    const flow = defineFlow({
      kind: "run-flow-transient",
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
    const received: OutputItem[] = [];
    const handle = await runFlow(flow, {
      action: "run",
      input: {},
      userId: "user_1",
      stores,
      onItem: (item) => received.push(item)
    });

    await handle.finished;

    // The transient message reached the live onItem consumer...
    const transientMessages = received.filter(
      (item) => item.type === "message" && item.transient === true
    );
    expect(transientMessages.length).toBeGreaterThan(0);

    // ...but was filtered from the persisted request record, matching the wire.
    const record = await stores.request.get(handle.requestId);
    const persistedTransient = (record?.items ?? []).filter(
      (item) => item.type === "message" && item.transient === true
    );
    expect(persistedTransient).toEqual([]);
  });

  it("echoes sessionId through the handle", async () => {
    const handle = await runFlow(buildMessageFlow(), {
      action: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      sessionId: "sess_42",
      stores: createInMemoryStores()
    });

    expect(handle.sessionId).toBe("sess_42");
    await handle.finished;
  });

  it("defaults source to \"manual\" on the persisted request record", async () => {
    const stores = createInMemoryStores();
    const handle = await runFlow(buildMessageFlow(), {
      action: "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores
    });

    await handle.finished;

    const record = await stores.request.get(handle.requestId);
    expect(record?.source).toBe("manual");
  });

  it("rejects finished (not the runFlow call) for an unknown action", async () => {
    // The call itself resolves to a handle; the unknown-action rejection from
    // runAction lands on `finished`, mirroring host.dispatch.
    const handle = await runFlow(buildMessageFlow(), {
      action: "nope" as "greet",
      input: { name: "Ada" },
      userId: "user_1",
      stores: createInMemoryStores()
    });

    expect(handle.requestId.length).toBeGreaterThan(0);
    await expect(handle.finished).rejects.toBeInstanceOf(ValidationError);
  });
});

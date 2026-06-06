/**
 * FIX-573 §6.1: block_trace lifecycle event tests.
 *
 * Covers the per-block-run lifecycle contract: a single `block_trace` item
 * progresses item.added → item.updated (input / generator phases) →
 * item.updated (output) → item.done. Status transitions in_progress →
 * completed | failed; final emission is always item.done. Generator-only
 * fields are undefined for non-generator blocks. Per the FIX-478 contract
 * (restored by FIX-586), the auto-emitted block_trace inherits the
 * originating block's `transient` flag — non-transient blocks produce
 * retained traces, transient blocks produce live-only traces.
 *
 * Generator-specific cases that require provider mocks (resolved generator
 * bundle, multi-call last-write-wins, Path A tool_output coupling) live in
 * the patterns/integration suites — this file focuses on the framework's
 * own emission logic.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

type LifecycleEvent =
  | { type: "item.added"; item: BlockTraceItem }
  | { type: "item.updated"; id: string; patch: Record<string, unknown> }
  | { type: "item.done"; item: BlockTraceItem };

function collectBlockTraceEvents(
  events: ReadonlyArray<{ type?: string; item?: { type?: string } } & Record<string, unknown>>
): LifecycleEvent[] {
  const out: LifecycleEvent[] = [];
  // Snapshot mutable item objects: the runtime emits the same item reference
  // on `added`/`done`, mutating fields between phases. Tests need the values
  // at emission time, not the final state.
  for (const ev of events) {
    if (ev.type === "item.added" && (ev.item as { type?: string } | undefined)?.type === "block_trace") {
      out.push({ type: "item.added", item: { ...(ev.item as BlockTraceItem) } });
    } else if (ev.type === "item.updated") {
      out.push({
        type: "item.updated",
        id: (ev.itemId ?? ev.id) as string,
        patch: { ...(ev.patch as Record<string, unknown>) },
      });
    } else if (ev.type === "item.done" && (ev.item as { type?: string } | undefined)?.type === "block_trace") {
      out.push({ type: "item.done", item: { ...(ev.item as BlockTraceItem) } });
    }
  }
  return out;
}

function getTraces(items: ReadonlyArray<{ type: string }>): BlockTraceItem[] {
  return items.filter((i) => i.type === "block_trace") as BlockTraceItem[];
}

describe("block_trace lifecycle events (FIX-573 §6.1)", () => {
  // Force trace observability on so all subtests share the same gate state.
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("emits item.added (in_progress) → item.updated (output, completed) → item.done in order for a handler", async () => {
    const block = handler({
      name: "h-lifecycle",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x + 1 })
    });

    const flow = defineFlow({
      kind: "lifecycle-flow",
      actions: {
        run: { inputSchema: z.object({ x: z.number() }), block }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf1", now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: { x: 1 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });
    expect(result.error).toBeUndefined();

    const lifecycle = collectBlockTraceEvents(response.getEvents() as never);
    // At least one block_trace lifecycle for the handler.
    expect(lifecycle.length).toBeGreaterThanOrEqual(3);

    const added = lifecycle.find((e) => e.type === "item.added");
    expect(added).toBeDefined();
    // The runtime emits item.added with status=in_progress (§3.1). The same
    // object reference is later mutated as the row settles, so we can't
    // assert added.item.status post-facto — that's why we capture patches
    // for status transitions in the updated events instead.
    if (added && added.type === "item.added") {
      // §3.8: canonical retained; transient is never true.
      expect(added.item.transient).not.toBe(true);
    }

    const id = (added as { item: BlockTraceItem }).item.id;
    const updates = lifecycle.filter(
      (e) => e.type === "item.updated" && e.id === id
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);

    // The output-phase update must carry status=completed and a defined output.
    const outputUpdate = updates.find(
      (e) => e.type === "item.updated" && (e.patch.status === "completed" || e.patch.output !== undefined)
    );
    expect(outputUpdate).toBeDefined();
    if (outputUpdate && outputUpdate.type === "item.updated") {
      expect(outputUpdate.patch.status).toBe("completed");
    }

    const done = lifecycle.find((e) => e.type === "item.done" && e.item.id === id);
    expect(done).toBeDefined();

    // Ordering: added strictly precedes any updated; final updated precedes done.
    const indexOf = (predicate: (e: LifecycleEvent) => boolean) =>
      lifecycle.findIndex(predicate);
    const addedIdx = indexOf((e) => e.type === "item.added" && e.item.id === id);
    const lastUpdateIdx = (() => {
      let lastIdx = -1;
      lifecycle.forEach((e, i) => {
        if (e.type === "item.updated" && e.id === id) lastIdx = i;
      });
      return lastIdx;
    })();
    const doneIdx = indexOf((e) => e.type === "item.done" && e.item.id === id);
    expect(addedIdx).toBeLessThan(lastUpdateIdx);
    expect(lastUpdateIdx).toBeLessThan(doneIdx);
  });

  it("failed block: status transitions to failed, error.message populated, item.done still fires", async () => {
    const failing = handler({
      name: "h-fails",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: () => {
        throw new Error("boom");
      }
    });

    const pipeline = sequencer({
      name: "fail-seq",
      inputSchema: z.object({})
    }).step(failing);

    const flow = defineFlow({
      kind: "fail-lifecycle-flow",
      actions: { run: { inputSchema: z.object({}), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf2", now: () => Date.now() });
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });
    expect(result.error).toBeDefined();

    const traces = getTraces(response.getItems());
    const failingTrace = traces.find((t) => t.blockName === "h-fails");
    expect(failingTrace).toBeDefined();
    expect(failingTrace!.status).toBe("failed");
    expect(failingTrace!.error?.message).toContain("boom");

    // item.done still emits for the failing block.
    const lifecycle = collectBlockTraceEvents(response.getEvents() as never);
    const failingId = failingTrace!.id;
    const doneForFailing = lifecycle.find(
      (e) => e.type === "item.done" && e.item.id === failingId
    );
    expect(doneForFailing).toBeDefined();
  });

  it("failed block: serializes the error cause chain into block_trace.error.details (FIX-723)", async () => {
    const failing = handler({
      name: "h-fails-cause",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: () => {
        const root = Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" });
        throw new Error("upstream failed", { cause: root });
      }
    });

    const pipeline = sequencer({
      name: "fail-cause-seq",
      inputSchema: z.object({})
    }).step(failing);

    const flow = defineFlow({
      kind: "fail-cause-flow",
      actions: { run: { inputSchema: z.object({}), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf3", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const failingTrace = getTraces(response.getItems()).find(
      (t) => t.blockName === "h-fails-cause"
    );
    expect(failingTrace!.status).toBe("failed");
    expect(failingTrace!.error?.details?.cause).toMatchObject({
      message: "upstream failed",
      cause: { name: "TypeError", message: "fetch failed", code: "ENOTFOUND" }
    });
  });

  it("trace observability disabled: no block_trace items emitted", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const block = handler({
      name: "h-gated",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x })
    });
    const flow = defineFlow({
      kind: "gated-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf3", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: { x: 1 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    expect(traces.length).toBe(0);
  });

  it("non-generator block: trace.generator is undefined", async () => {
    const block = handler({
      name: "h-non-gen",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x })
    });
    const flow = defineFlow({
      kind: "non-gen-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf4", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: { x: 2 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    expect(traces.length).toBeGreaterThanOrEqual(1);
    for (const t of traces) {
      expect(t.generator).toBeUndefined();
    }
  });

  it("connectInput identity (returns reference unchanged): no input.connected field on the trace", async () => {
    // The post-connectInput value is captured only when the function actually
    // transformed the input (FIX-573 §3.4). When connectInput returns the same
    // reference, `connected` stays unset.
    const stepA = handler({
      name: "step-a",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number() }),
      execute: (v) => v
    });
    const stepB = handler({
      name: "step-b-identity",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number() }),
      execute: (v) => v
    }).connectInput((v: { x: number }) => v); // identity — same reference

    const pipeline = sequencer({
      name: "id-seq",
      inputSchema: z.object({ x: z.number() })
    })
      .step(stepA)
      .step(stepB);

    const flow = defineFlow({
      kind: "id-conn-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf5", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: { x: 7 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    const tB = traces.find((t) => t.blockName === "step-b-identity");
    expect(tB).toBeDefined();
    // `input.source` is always populated; `input.connected` is the post-transform
    // reflection. Identity transform → no connected field.
    expect(tB!.input?.connected).toBeUndefined();
  });

  it(".parallel({ a, b }) downstream sees a structure container with branch refs by key", async () => {
    const branchA = handler({
      name: "p-a",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (n) => n + 1
    });
    const branchB = handler({
      name: "p-b",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (n) => n + 2
    });
    const after = handler({
      name: "p-after",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    });

    const pipeline = sequencer({ name: "par-seq", inputSchema: z.number() })
      .parallel({ a: branchA, b: branchB })
      .step(after);

    const flow = defineFlow({
      kind: "par-flow",
      actions: { run: { inputSchema: z.number(), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf6", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: 5,
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    const tA = traces.find((t) => t.blockName === "p-a");
    const tB = traces.find((t) => t.blockName === "p-b");
    const tAfter = traces.find((t) => t.blockName === "p-after");
    expect(tA).toBeDefined();
    expect(tB).toBeDefined();
    expect(tAfter).toBeDefined();

    // Downstream `after` receives a structure aggregating branch refs by key.
    expect(tAfter!.input?.source.kind).toBe("structure");
    if (tAfter!.input?.source.kind === "structure") {
      expect(tAfter!.input.source.shape.container).toBe("object");
      if (tAfter!.input.source.shape.container === "object") {
        const entries = tAfter!.input.source.shape.entries;
        expect(Object.keys(entries).sort()).toEqual(["a", "b"]);
        const aRef = entries.a;
        const bRef = entries.b;
        if (aRef.kind === "ref") expect(aRef.sourceItemId).toBe(tA!.id);
        if (bRef.kind === "ref") expect(bRef.sourceItemId).toBe(tB!.id);
      }
    }
  });

  it(".work() background step's input.source is a ref to the parent step's trace", async () => {
    const main = handler({
      name: "main-step",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x + 1 })
    });
    const bg = handler({
      name: "bg-step",
      inputSchema: z.object({ y: z.number() }),
      outputSchema: z.void(),
      execute: () => undefined
    });

    const pipeline = sequencer({
      name: "work-seq",
      inputSchema: z.object({ x: z.number() })
    })
      .step(main)
      .work(bg);

    const flow = defineFlow({
      kind: "work-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf7", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: { x: 3 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    const tMain = traces.find((t) => t.blockName === "main-step");
    const tBg = traces.find((t) => t.blockName === "bg-step");
    expect(tMain).toBeDefined();
    expect(tBg).toBeDefined();
    // Background step input refs the parent step's trace.
    expect(tBg!.input?.source.kind).toBe("ref");
    if (tBg!.input?.source.kind === "ref") {
      expect(tBg!.input.source.sourceItemId).toBe(tMain!.id);
    }
  });

  it("transient block: block_trace inherits the originating block's transient flag (FIX-586)", async () => {
    const transientBlock = handler({
      name: "transient-h",
      transient: true,
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x })
    });
    const flow = defineFlow({
      kind: "trans-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block: transientBlock } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf8", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      requestId: "req_lf8",
      input: { x: 1 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    // Traces still stream live (visible on the response emitter) so DevTool
    // and other active SSE consumers continue to observe transient blocks.
    const traces = getTraces(response.getItems());
    expect(traces.length).toBeGreaterThanOrEqual(1);
    for (const t of traces) {
      expect(t.transient).toBe(true);
    }

    // Persisted request record filters transient items out — the items log
    // does not retain block_trace rows from transient blocks.
    const record = await stores.request.get("req_lf8");
    expect(record).toBeDefined();
    const persistedTraces = (record!.items ?? []).filter(
      (i) => i.type === "block_trace"
    );
    expect(persistedTraces.length).toBe(0);
  });

  it("non-transient block: block_trace is retained in the persisted items log (regression guard)", async () => {
    const normalBlock = handler({
      name: "retained-h",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x })
    });
    const flow = defineFlow({
      kind: "retained-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block: normalBlock } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf9", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      requestId: "req_lf9",
      input: { x: 1 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    expect(traces.length).toBeGreaterThanOrEqual(1);
    for (const t of traces) {
      expect(t.transient).not.toBe(true);
    }

    const record = await stores.request.get("req_lf9");
    expect(record).toBeDefined();
    const persistedTraces = (record!.items ?? []).filter(
      (i) => i.type === "block_trace"
    );
    expect(persistedTraces.length).toBeGreaterThanOrEqual(1);
  });

  it("transient sequencer wrapping non-transient children: only the outer trace is transient", async () => {
    const innerA = handler({
      name: "inner-a",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number() }),
      execute: (v) => v
    });
    const innerB = handler({
      name: "inner-b",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number() }),
      execute: (v) => v
    });
    const wrapper = sequencer({
      name: "wrap-seq",
      inputSchema: z.object({ x: z.number() }),
      transient: true
    })
      .step(innerA)
      .step(innerB);
    const flow = defineFlow({
      kind: "wrap-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block: wrapper } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_lf10", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      requestId: "req_lf10",
      input: { x: 1 },
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    const traces = getTraces(response.getItems());
    const outer = traces.find((t) => t.blockName === "wrap-seq");
    const a = traces.find((t) => t.blockName === "inner-a");
    const b = traces.find((t) => t.blockName === "inner-b");
    expect(outer).toBeDefined();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(outer!.transient).toBe(true);
    expect(a!.transient).not.toBe(true);
    expect(b!.transient).not.toBe(true);
  });
});

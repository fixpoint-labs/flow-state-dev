/**
 * Contract test for the untyped-response fallback in `createExecutionContext`.
 *
 * When the `response` handed to the context exposes only a generic `emit()`
 * (no typed `emitItemAdded` / `emitItemDone`), the runtime synthesizes item
 * events through `emit()`. Those synthesized `item.updated` events must use
 * the canonical `itemId` field from `ItemUpdatedEvent`: clients (including
 * the CLI's capture mapping) key updates on `itemId`, and `ResponseEmitter`
 * only routes an `item.updated` through its tracked-item path when `itemId`
 * is present. An update with any other key is invisible to both.
 *
 * A response that also exposes `getItems()` (but not `getItemCount()`) is the
 * index cursor: items a block emits straight through it and the records the
 * runtime reserves must not share an index.
 */
import { defineFlow, generator, handler, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeneratorModel, ResponseEmitterHandle } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock
} from "../src";

describe("untyped response fallback", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    // block_trace updates are the fallback's item.updated source.
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("emits item.updated with the canonical itemId, so a downstream emitter tracks the update", async () => {
    const block = handler({
      name: "untyped-h",
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      execute: ({ x }) => ({ y: x + 1 })
    });
    const flow = defineFlow({
      kind: "untyped-response-flow",
      actions: { run: { inputSchema: z.object({ x: z.number() }), block } }
    })();

    // A response that forwards to a real emitter but exposes only `emit()`,
    // which is what forces the context onto its fallback adapter.
    const downstream = createResponseEmitter({ requestId: "req_untyped", now: () => 1 });
    const raw: Array<Record<string, unknown>> = [];
    const untypedResponse = {
      async emit(event: unknown) {
        raw.push(event as Record<string, unknown>);
        await downstream.emit(event);
      }
    };

    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_untyped",
      sessionId: "sess_untyped",
      userId: "user_untyped",
      modelResolver: createMockModelResolver({}),
      stores: createInMemoryStores(),
      // Deliberately partial: a JS caller can hand over an emit-only response.
      response: untypedResponse as unknown as ResponseEmitterHandle
    });

    await executeBlock({ block, input: { x: 1 }, ctx });
    // Trace emissions are fire-and-forget; let them settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const traceAdded = raw.find(
      (e) => e.type === "item.added" && (e.item as { type?: string }).type === "block_trace"
    );
    expect(traceAdded).toBeDefined();
    const traceId = (traceAdded!.item as { id: string }).id;

    // What the fallback put on the wire: the canonical shape, no legacy key.
    const rawUpdates = raw.filter((e) => e.type === "item.updated");
    expect(rawUpdates.length).toBeGreaterThan(0);
    for (const update of rawUpdates) {
      expect(update.itemId).toBe(traceId);
      expect(update).not.toHaveProperty("id");
    }

    // What a reader of the downstream stream sees: every update is keyed by
    // itemId and names the item it patches.
    const streamed = downstream
      .getEvents()
      .filter((e) => e.type === "item.updated") as Array<{ itemId?: string; patch: Record<string, unknown> }>;
    expect(streamed).toHaveLength(rawUpdates.length);
    expect(streamed.every((e) => e.itemId === traceId)).toBe(true);
    expect(streamed.some((e) => e.patch.status === "completed")).toBe(true);
  });

  it("reads the item cursor from getItems() when the response has no getItemCount()", async () => {
    // Observability off: the lean completion record is reserved after the
    // generator's message went straight through the response.
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const model: GeneratorModel = {
      modelId: "stub",
      generate: async () => ({
        text: "the draft",
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
    };
    const draft = generator({
      name: "draft",
      model,
      prompt: "write it",
      itemVisibility: { client: true, history: true },
    });
    const after = handler({
      name: "after",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input: unknown) => ({ got: input }),
    });
    const block = sequencer({ name: "seq" }).step(draft).step(after);
    const flow = defineFlow({
      kind: "untyped-cursor-flow",
      actions: { run: { inputSchema: z.any(), block } },
    })();

    const downstream = createResponseEmitter({ requestId: "req_cursor", now: () => 1 });
    const partialResponse = {
      emit: (event: unknown) => downstream.emit(event),
      getItems: () => downstream.getItems(),
    };
    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_cursor",
      sessionId: "sess_cursor",
      userId: "user_cursor",
      modelResolver: createMockModelResolver({}),
      stores: createInMemoryStores(),
      response: partialResponse as unknown as ResponseEmitterHandle
    });

    await executeBlock({ block, input: {}, ctx });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const items = downstream.getItems();
    expect(items.some((i) => i.type === "message")).toBe(true);
    expect(items.some((i) => i.type === "block_trace")).toBe(true);
    const indexes = items.map((i) => i.itemIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("reserves past the highest seeded index, not the item count, when the response has no getItemCount()", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const step = (name: string) =>
      handler({ name, inputSchema: z.any(), outputSchema: z.any(), execute: () => ({ name }) });
    const block = sequencer({ name: "seq" }).step(step("first")).step(step("second"));
    const flow = defineFlow({
      kind: "untyped-seeded-flow",
      actions: { run: { inputSchema: z.any(), block } },
    })();

    // One prior item, at index 5: the count (1) is not the next free index (6).
    const downstream = createResponseEmitter({ requestId: "req_seeded", now: () => 1 });
    const prior = {
      id: "item_prior",
      type: "message",
      role: "assistant",
      status: "completed",
      requestId: "req_seeded",
      itemIndex: 5,
      provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
      ts: 1,
      content: [{ type: "output_text", text: "earlier" }],
    };
    await downstream.emitItemAdded(prior as never);
    const partialResponse = {
      emit: (event: unknown) => downstream.emit(event),
      getItems: () => downstream.getItems(),
    };
    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_seeded",
      sessionId: "sess_seeded",
      userId: "user_seeded",
      modelResolver: createMockModelResolver({}),
      stores: createInMemoryStores(),
      response: partialResponse as unknown as ResponseEmitterHandle
    });

    await executeBlock({ block, input: {}, ctx });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const added = downstream.getItems().filter((i) => i.id !== "item_prior").map((i) => i.itemIndex);
    expect(added).toEqual([6, 7, 8]);
  });
});

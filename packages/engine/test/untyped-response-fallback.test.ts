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
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      response: untypedResponse
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
});

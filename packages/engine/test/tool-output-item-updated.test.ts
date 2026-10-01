/**
 * Contract test for the `tool_output` status updates emitted by core's
 * `emitToolOutputAround` (used by `block.asTool()` and the generator tool
 * loop).
 *
 * When a tool settles, the emitter sends an `item.updated` that flips the
 * `tool_output` item to `completed` or `failed`. That event must use the
 * canonical `itemId` field from `ItemUpdatedEvent`: clients (including the
 * CLI's capture mapping) key updates on `itemId`, and `ResponseEmitter` only
 * routes an `item.updated` through its tracked-item path when `itemId` is
 * present. An update with any other key is invisible to both, so the tool's
 * status change never reaches a reader.
 */
import { defineFlow, handler, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock
} from "../src";

async function runToolStep(
  tool: ReturnType<typeof handler>,
  requestId: string
): Promise<{
  raw: Array<Record<string, unknown>>;
  downstream: ReturnType<typeof createResponseEmitter>;
  error: unknown;
}> {
  const block = sequencer({
    name: `${tool.name}-step`,
    inputSchema: z.object({ q: z.string() })
  }).step(tool.asTool());
  const flow = defineFlow({
    kind: `${tool.name}-flow`,
    actions: { run: { inputSchema: z.object({ q: z.string() }), block } }
  })();

  // Record exactly what the tool emitter put on the wire, and forward it to a
  // real emitter so we can see what a reader of that stream receives.
  const downstream = createResponseEmitter({ requestId, now: () => 1 });
  const raw: Array<Record<string, unknown>> = [];
  const response = {
    async emit(event: unknown) {
      raw.push(event as Record<string, unknown>);
      await downstream.emit(event);
    }
  };

  const ctx = await createExecutionContext({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    requestId,
    sessionId: `sess_${requestId}`,
    userId: `user_${requestId}`,
    modelResolver: createMockModelResolver({}),
    stores: createInMemoryStores(),
    response
  });

  const { error } = await executeBlock({ block, input: { q: "x" }, ctx });
  return { raw, downstream, error };
}

function toolOutputId(raw: Array<Record<string, unknown>>): string {
  const added = raw.find(
    (e) => e.type === "item.added" && (e.item as { type?: string }).type === "tool_output"
  );
  expect(added).toBeDefined();
  return (added!.item as { id: string }).id;
}

describe("tool_output item.updated", () => {
  it("a completed tool's update carries the canonical itemId, so a downstream emitter tracks it", async () => {
    const lookup = handler({
      name: "lookup",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ answer: z.string() }),
      execute: ({ q }) => ({ answer: `result:${q}` })
    });
    const { raw, downstream, error } = await runToolStep(lookup, "req_tool_ok");
    expect(error).toBeUndefined();

    const toolId = toolOutputId(raw);

    // What the tool emitter put on the wire: the canonical shape, no legacy key.
    const rawUpdates = raw.filter(
      (e) => e.type === "item.updated" && (e.itemId === toolId || e.id === toolId)
    );
    expect(rawUpdates).toHaveLength(1);
    expect(rawUpdates[0]!.itemId).toBe(toolId);
    expect(rawUpdates[0]).not.toHaveProperty("id");

    // What a reader of the downstream stream sees: the update is keyed by
    // itemId and carries the completed status.
    const streamed = downstream
      .getEvents()
      .filter((e) => e.type === "item.updated") as Array<{ itemId?: string; patch: Record<string, unknown> }>;
    const toolUpdates = streamed.filter((e) => e.itemId === toolId);
    expect(toolUpdates).toHaveLength(1);
    expect(toolUpdates[0]!.patch.status).toBe("completed");
    expect(toolUpdates[0]!.patch.output).toEqual({ answer: "result:x" });
  });

  it("a failed tool's update carries the canonical itemId, so a downstream emitter tracks it", async () => {
    const boom = handler({
      name: "boom",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        throw new Error("kaboom");
      }
    });
    const { raw, downstream, error } = await runToolStep(boom, "req_tool_fail");
    expect((error as Error).message).toContain("kaboom");

    const toolId = toolOutputId(raw);

    const rawUpdates = raw.filter(
      (e) => e.type === "item.updated" && (e.itemId === toolId || e.id === toolId)
    );
    expect(rawUpdates).toHaveLength(1);
    expect(rawUpdates[0]!.itemId).toBe(toolId);
    expect(rawUpdates[0]).not.toHaveProperty("id");

    const streamed = downstream
      .getEvents()
      .filter((e) => e.type === "item.updated") as Array<{ itemId?: string; patch: Record<string, unknown> }>;
    const toolUpdates = streamed.filter((e) => e.itemId === toolId);
    expect(toolUpdates).toHaveLength(1);
    expect(toolUpdates[0]!.patch.status).toBe("failed");
    expect((toolUpdates[0]!.patch.error as { message?: string }).message).toBe("kaboom");
  });
});

/**
 * Contract test for the `tool_output` status updates emitted by core's
 * `emitToolOutputAround` (used by `block.asTool()` and the generator tool
 * loop): the completed/failed `item.updated` must carry `itemId`.
 *
 * Pins the same `itemId` contract as `untyped-response-fallback.test.ts`; see
 * its header for why readers miss an update keyed any other way.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { createTestContext } from "@flow-state-dev/testing";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { executeBlock } from "../src";

/**
 * Run `tool.asTool()` as a sequencer step, then assert its status update is
 * canonical on the wire and that the downstream emitter tracks it with this
 * path's own `patch`.
 */
async function expectCanonicalUpdate(
  tool: ReturnType<typeof handler>,
  thrown: string | undefined,
  patch: Record<string, unknown>
): Promise<void> {
  const block = sequencer({
    name: `${tool.name}-step`,
    inputSchema: z.object({ q: z.string() })
  }).step(tool.asTool());
  const { ctx, response } = await createTestContext({ requestId: `req_${tool.name}` });

  // Record exactly what the tool emitter puts on the wire, then forward it to
  // the real emitter so we can see what a reader of that stream receives.
  const raw: Array<Record<string, unknown>> = [];
  const emit = ctx.response.emit.bind(ctx.response);
  ctx.response.emit = async (event: unknown) => {
    raw.push(event as Record<string, unknown>);
    await emit(event);
  };

  const { error } = await executeBlock({ block, input: { q: "x" }, ctx });
  if (thrown === undefined) expect(error).toBeUndefined();
  else expect((error as Error).message).toContain(thrown);

  const added = raw.find(
    (e) => e.type === "item.added" && (e.item as { type?: string }).type === "tool_output"
  );
  expect(added).toBeDefined();
  const toolId = (added!.item as { id: string }).id;

  // On the wire: exactly one update for the tool, canonical key, no legacy one.
  const rawUpdates = raw.filter(
    (e) => e.type === "item.updated" && (e.itemId === toolId || e.id === toolId)
  );
  expect(rawUpdates).toHaveLength(1);
  expect(rawUpdates[0]).toHaveProperty("itemId", toolId);
  expect(rawUpdates[0]).not.toHaveProperty("id");

  // Downstream: the emitter tracked it, keyed by itemId, with this path's patch.
  const streamed = response
    .getEvents()
    .filter((e) => e.type === "item.updated" && "itemId" in e && e.itemId === toolId);
  expect(streamed).toHaveLength(1);
  expect(streamed[0]).toMatchObject({ patch });
}

describe("tool_output item.updated", () => {
  it("a completed tool's update carries itemId and the downstream emitter tracks it", async () => {
    await expectCanonicalUpdate(
      handler({
        name: "lookup",
        inputSchema: z.object({ q: z.string() }),
        outputSchema: z.object({ answer: z.string() }),
        execute: ({ q }) => ({ answer: `result:${q}` })
      }),
      undefined,
      { status: "completed", output: { answer: "result:x" } }
    );
  });

  it("a failed tool's update carries itemId and the downstream emitter tracks it", async () => {
    await expectCanonicalUpdate(
      handler({
        name: "boom",
        inputSchema: z.object({ q: z.string() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: () => {
          throw new Error("kaboom");
        }
      }),
      "kaboom",
      { status: "failed", error: { message: "kaboom" } }
    );
  });
});

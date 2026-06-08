import { describe, it, expect } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createEmitState, emitTranslatedEvent } from "../../src/sdk/emit";

/**
 * Minimal fake block context that records the raw events emitted via
 * `ctx.response.emit`. The emit layer only touches `request.identity`,
 * `response.emit` / `response.getItemCount`, `emit.status`, and the
 * `_blockIdentity` provenance seam — enough to exercise emission directly,
 * without the full block harness (which exposes only tracked items, not the
 * underlying added/done event sequence).
 */
function fakeEmitCtx() {
  const events: Array<{ type: string; item?: { id?: string; type?: string } }> = [];
  let count = 0;
  const ctx = {
    request: { identity: { id: "req_1" } },
    response: {
      emit: async (e: { type: string; item?: { id?: string; type?: string } }) => {
        events.push(e);
        if (e.type === "item.added") count += 1;
      },
      getItemCount: () => count,
    },
    emit: { status: () => {} },
    _blockIdentity: { blockName: "claude-code-agent", blockInstanceId: "bi_1", phase: "main" },
  } as unknown as BlockContext;
  return { ctx, events };
}

describe("emitTranslatedEvent", () => {
  it("emits item.added before item.done for an orphan tool result (no preceding tool_use)", async () => {
    // A tool_result whose opening tool_use was never seen (a partial-message
    // gap) must be self-contained: a consumer tracking items added-then-done
    // would otherwise receive an item.done for an item it never saw added.
    const { ctx, events } = fakeEmitCtx();
    const state = createEmitState();

    await emitTranslatedEvent(
      { kind: "tool_result", callId: "toolu_orphan", output: "ok", isError: false },
      ctx,
      state,
      "claude-code-agent",
    );

    const toolEventTypes = events
      .filter((e) => e.item?.type === "tool_output")
      .map((e) => e.type);
    expect(toolEventTypes).toEqual(["item.added", "item.done"]);
  });

  it("emits only item.done for a tool result whose opening call was seen", async () => {
    // The normal path: emitToolCall already emitted item.added, so the result
    // completes it with a single item.done (no duplicate add).
    const { ctx, events } = fakeEmitCtx();
    const state = createEmitState();

    await emitTranslatedEvent(
      { kind: "tool_call", callId: "toolu_1", name: "Bash", arguments: "{}" },
      ctx,
      state,
      "claude-code-agent",
    );
    const afterCall = events.filter((e) => e.item?.type === "tool_output").map((e) => e.type);
    expect(afterCall).toEqual(["item.added"]);

    await emitTranslatedEvent(
      { kind: "tool_result", callId: "toolu_1", output: "ok", isError: false },
      ctx,
      state,
      "claude-code-agent",
    );
    const toolEventTypes = events
      .filter((e) => e.item?.type === "tool_output")
      .map((e) => e.type);
    expect(toolEventTypes).toEqual(["item.added", "item.done"]);
  });
});

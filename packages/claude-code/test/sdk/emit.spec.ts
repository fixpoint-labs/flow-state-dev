import { describe, it, expect } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { closeStreamingItems, createEmitState, emitTranslatedEvent, finalizeOpenItems } from "../../src/sdk/emit";

/**
 * Minimal fake block context that records the raw events emitted via
 * `ctx.response.emit`. The emit layer only touches `request.identity`,
 * `response.emit` / `response.getItemCount`, `emit.status`, and the
 * `_blockIdentity` provenance seam — enough to exercise emission directly,
 * without the full block harness (which exposes only tracked items, not the
 * underlying added/done event sequence).
 */
function fakeEmitCtx(scope: { taskId?: string } = {}) {
  const events: Array<{ type: string; item?: { id?: string; type?: string; taskId?: string } }> = [];
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
    _blockIdentity: { blockName: "claude-code-agent", blockInstanceId: "bi_1", phase: "main", ...scope },
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

// A run inside a task scope (a board's gated task entry, as `harnessManager`
// runs it) must put the task's id on every item it emits: it is what puts the
// item in the task's own view, the Session tab a person opens on that task.
// Without it a Claude Code run's steps are in the session but in no task's view.
describe("task attribution", () => {
  const BLOCK = "claude-code-agent";

  it("stamps the scope's taskId on every item it adds and finishes", async () => {
    const { ctx, events } = fakeEmitCtx({ taskId: "row-1--implement" });
    const state = createEmitState();

    await emitTranslatedEvent({ kind: "message_delta", text: "Reading" }, ctx, state, BLOCK);
    await closeStreamingItems(ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "message_complete", text: "Done." }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "reasoning_complete", text: "Thinking" }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "tool_call", callId: "t1", name: "Bash", arguments: "{}" }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "tool_result", callId: "t1", output: "ok", isError: false }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "tool_result", callId: "t-orphan", output: "ok", isError: false }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "subagent_open", callId: "s1", name: "Task" }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "tool_call", callId: "t2", name: "Read", arguments: "{}" }, ctx, state, BLOCK);
    await emitTranslatedEvent({ kind: "error", message: "boom" }, ctx, state, BLOCK);
    await finalizeOpenItems(ctx, state, BLOCK);

    const items = events.filter((e) => e.item !== undefined).map((e) => e.item!);
    expect(new Set(items.map((i) => i.type))).toEqual(new Set(["message", "reasoning", "tool_output", "container", "error"]));
    for (const item of items) expect({ type: item.type, taskId: item.taskId }).toEqual({ type: item.type, taskId: "row-1--implement" });
  });

  it("puts no taskId key on an item emitted outside a task scope", async () => {
    const { ctx, events } = fakeEmitCtx();
    const state = createEmitState();

    await emitTranslatedEvent({ kind: "message_complete", text: "Done." }, ctx, state, BLOCK);

    const items = events.filter((e) => e.item !== undefined).map((e) => e.item!);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(Object.keys(item)).not.toContain("taskId");
  });
});

/**
 * Emission: the fields every item this package creates must carry.
 *
 * The behaviour under test is scope attribution. The runtime puts `taskId` and
 * `ownedBy` on `ctx._blockIdentity`, and every canonical emit site in the
 * framework stamps both onto the items it creates. An emitter that omits them
 * produces items that are excluded from a task's own item list and render
 * outside their enclosing container — which for a harness is not cosmetic: the
 * whole point of this package is a manager running it inside a task scope, and
 * an unattributed item is invisible to exactly that reader.
 */
import { describe, it, expect } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { createEmitState, emitTranslatedEvent, finalizeOpenItems } from "../src/emit";

/** A context standing inside a task scope, as the runtime provides one. */
async function scopedContext() {
  const runtime = await createTestContext({});
  (runtime.ctx as { _blockIdentity?: unknown })._blockIdentity = {
    blockName: "codex-agent",
    blockInstanceId: "codex-agent_1",
    phase: "main",
    taskId: "task_42",
    ownedBy: "container_7",
  };
  return runtime;
}

describe("scope attribution", () => {
  it("stamps taskId and ownedBy on messages, reasoning and tool items", async () => {
    const runtime = await scopedContext();
    const state = createEmitState();
    for (const event of [
      { kind: "message", text: "done" },
      { kind: "reasoning", text: "thinking" },
      { kind: "tool_call", callId: "c1", name: "command_execution", arguments: "{}" },
      {
        kind: "tool_result",
        callId: "c1",
        name: "command_execution",
        arguments: "{}",
        output: "ok",
        isError: false,
      },
      { kind: "error", message: "transient" },
    ] as const) {
      await emitTranslatedEvent(event, runtime.ctx as never, state, "codex-agent");
    }

    const items = runtime.getItems() as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.taskId).toBe("task_42");
      expect(item.ownedBy).toBe("container_7");
    }
  });

  it("stamps them on an item finalized because the run ended early", async () => {
    // The abort and failure paths close open tool items through `finalizeOpenItems`.
    // An item that lost its attribution only when the run was cancelled would be
    // missing from the task view in exactly the case someone goes looking.
    const runtime = await scopedContext();
    const state = createEmitState();
    await emitTranslatedEvent(
      { kind: "tool_call", callId: "c1", name: "command_execution", arguments: "{}" },
      runtime.ctx as never,
      state,
      "codex-agent",
    );
    await finalizeOpenItems(runtime.ctx as never, state, "codex-agent");

    const items = runtime.getItems() as Array<Record<string, unknown>>;
    const settled = items.filter((i) => i.status === "incomplete");
    expect(settled.length).toBe(1);
    expect(settled[0].taskId).toBe("task_42");
    expect(settled[0].ownedBy).toBe("container_7");
  });

  it("omits both keys outside a task scope rather than writing undefined", async () => {
    const runtime = await createTestContext({});
    const state = createEmitState();
    await emitTranslatedEvent(
      { kind: "message", text: "done" },
      runtime.ctx as never,
      state,
      "codex-agent",
    );
    const items = runtime.getItems() as Array<Record<string, unknown>>;
    expect(items[0].taskId).toBeUndefined();
    expect(items[0].ownedBy).toBeUndefined();
  });
});

describe("reasoning item shape", () => {
  async function emitted(kind: "message" | "reasoning", text: string) {
    const runtime = await createTestContext({});
    const state = createEmitState();
    await emitTranslatedEvent({ kind, text }, runtime.ctx as never, state, "codex-agent");
    return { state, events: runtime.response.getEvents() };
  }

  it("puts reasoning text in summary as reasoning_text, on every event the item travels on", async () => {
    const { events } = await emitted("reasoning", "weighing the options");
    const items = events
      .filter((e) => e.type === "item.added" || e.type === "item.done")
      .map((e) => (e as { item: Record<string, unknown> }).item);

    expect(items.map((item) => item.type)).toEqual(["reasoning", "reasoning"]);
    expect(items.map((item) => item.summary)).toEqual([
      [{ type: "reasoning_text", text: "" }],
      [{ type: "reasoning_text", text: "weighing the options" }],
    ]);
    for (const item of items) {
      expect(item).not.toHaveProperty("content");
    }

    expect(
      events
        .filter((e) => e.type === "content.added" || e.type === "content.done")
        .map((e) => (e as { content: unknown }).content),
    ).toEqual([
      { type: "reasoning_text", text: "" },
      { type: "reasoning_text", text: "weighing the options" },
    ]);
  });

  it("leaves message items on content as output_text", async () => {
    const { state, events } = await emitted("message", "all done");
    const done = events.find((e) => e.type === "item.done") as { item: Record<string, unknown> };
    expect(done.item).not.toHaveProperty("summary");
    expect(done.item.content).toEqual([{ type: "output_text", text: "all done" }]);
    const contentDone = events.find((e) => e.type === "content.done") as { content: unknown };
    expect(contentDone.content).toEqual({ type: "output_text", text: "all done" });
    expect(state.finalMessage).toBe("all done");
  });
});

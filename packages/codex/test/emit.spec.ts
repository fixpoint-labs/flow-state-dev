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

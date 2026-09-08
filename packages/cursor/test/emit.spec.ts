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
    blockName: "cursor-agent",
    blockInstanceId: "cursor-agent_1",
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
      { kind: "tool_call", callId: "c1", name: "shell", arguments: "{}" },
      {
        kind: "tool_result",
        callId: "c1",
        name: "shell",
        arguments: "{}",
        output: "ok",
        isError: false,
      },
      { kind: "error", message: "transient" },
    ] as const) {
      await emitTranslatedEvent(event, runtime.ctx as never, state, "cursor-agent");
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
      { kind: "tool_call", callId: "c1", name: "shell", arguments: "{}" },
      runtime.ctx as never,
      state,
      "cursor-agent",
    );
    await finalizeOpenItems(runtime.ctx as never, state, "cursor-agent");

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
      "cursor-agent",
    );
    const items = runtime.getItems() as Array<Record<string, unknown>>;
    expect(items[0].taskId).toBeUndefined();
    expect(items[0].ownedBy).toBeUndefined();
  });
});

describe("item index", () => {
  /** The `item.added` / `item.done` versions of every item, in emission order. */
  function itemVersions(runtime: Awaited<ReturnType<typeof createTestContext>>) {
    return runtime.response
      .getEvents()
      .filter((e) => e.type === "item.added" || e.type === "item.done")
      .map((e) => {
        const { type, item } = e as { type: string; item: { id: string; type: string; itemIndex: number } };
        return { event: type, id: item.id, kind: item.type, itemIndex: item.itemIndex };
      });
  }

  it("settling a tool item keeps the index it was added with, so the next item gets its own", async () => {
    // `getItemCount()` counts items by id, and an `item.done` for an id the
    // stream already has does not grow it. Re-reading the count on completion
    // hands the settled tool item the index the NEXT item is about to get —
    // two items on one index, and a replay whose order depends on a timestamp
    // tie-break rather than on the index that exists to decide it.
    const runtime = await createTestContext({});
    const state = createEmitState();
    for (const event of [
      { kind: "tool_call", callId: "c1", name: "shell", arguments: "{}" },
      {
        kind: "tool_result",
        callId: "c1",
        name: "shell",
        arguments: "{}",
        output: "ok",
        isError: false,
      },
      { kind: "message", text: "done" },
    ] as const) {
      await emitTranslatedEvent(event, runtime.ctx as never, state, "cursor-agent");
    }

    const versions = itemVersions(runtime);
    const toolAdded = versions.find((v) => v.kind === "tool_output" && v.event === "item.added");
    const toolDone = versions.find((v) => v.kind === "tool_output" && v.event === "item.done");
    const message = versions.find((v) => v.kind === "message" && v.event === "item.added");

    expect(toolDone?.itemIndex).toBe(toolAdded?.itemIndex);
    expect(message?.itemIndex).not.toBe(toolAdded?.itemIndex);
    const added = versions.filter((v) => v.event === "item.added").map((v) => v.itemIndex);
    expect(new Set(added).size).toBe(added.length);
  });

  it("an item finalized because the run ended early keeps its index too", async () => {
    const runtime = await createTestContext({});
    const state = createEmitState();
    await emitTranslatedEvent(
      { kind: "tool_call", callId: "c1", name: "shell", arguments: "{}" },
      runtime.ctx as never,
      state,
      "cursor-agent",
    );
    await finalizeOpenItems(runtime.ctx as never, state, "cursor-agent");

    const versions = itemVersions(runtime);
    const added = versions.find((v) => v.event === "item.added");
    const done = versions.find((v) => v.event === "item.done");
    expect(done?.itemIndex).toBe(added?.itemIndex);
  });
});

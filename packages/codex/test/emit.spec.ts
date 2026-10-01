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

/**
 * Item shape: a reasoning item carries its text in `summary`, as the
 * `ReasoningItem` contract declares and as the Claude Code and generator
 * emitters produce it. The React reasoning renderer reads `item.summary`
 * directly, so a reasoning item that put its text in `content` instead threw
 * on render and took the whole Session view down with it. The client places a
 * reasoning item's `content.added` / `content.done` parts into `summary`, and
 * the renderer keeps only `reasoning_text` parts, so the part type on those
 * events has to match too or the text renders empty.
 */
describe("reasoning item shape", () => {
  /** Record every response event while still letting the test context accumulate items. */
  async function recordingContext() {
    const runtime = await createTestContext({});
    const events: Array<Record<string, unknown>> = [];
    const response = (runtime.ctx as { response: { emit: (e: unknown) => Promise<void> } }).response;
    const passThrough = response.emit.bind(response);
    response.emit = async (event: unknown) => {
      events.push(event as Record<string, unknown>);
      await passThrough(event);
    };
    return { runtime, events };
  }

  /** The renderer's read of a reasoning item: join its `reasoning_text` summary parts. */
  function renderedReasoningText(item: Record<string, unknown>): string {
    return (item.summary as Array<{ type: string; text: string }>)
      .filter((c) => c.type === "reasoning_text")
      .map((c) => c.text)
      .join("\n");
  }

  it("puts reasoning text in summary as reasoning_text, on every event the item travels on", async () => {
    const { runtime, events } = await recordingContext();
    const state = createEmitState();
    await emitTranslatedEvent(
      { kind: "reasoning", text: "weighing the options" },
      runtime.ctx as never,
      state,
      "codex-agent",
    );

    const lifecycle = events.filter((e) => e.type === "item.added" || e.type === "item.done");
    expect(lifecycle.map((e) => e.type)).toEqual(["item.added", "item.done"]);
    for (const { item } of lifecycle as Array<{ item: Record<string, unknown> }>) {
      expect(item.type).toBe("reasoning");
      expect(item).not.toHaveProperty("content");
      expect(Array.isArray(item.summary)).toBe(true);
    }
    const done = (lifecycle[1] as { item: Record<string, unknown> }).item;
    expect(renderedReasoningText(done)).toBe("weighing the options");

    const parts = events
      .filter((e) => e.type === "content.added" || e.type === "content.done")
      .map((e) => ({ type: e.type, content: e.content }));
    expect(parts).toEqual([
      { type: "content.added", content: { type: "reasoning_text", text: "" } },
      { type: "content.done", content: { type: "reasoning_text", text: "weighing the options" } },
    ]);

    const [stored] = runtime.getItems() as Array<Record<string, unknown>>;
    expect(renderedReasoningText(stored)).toBe("weighing the options");
  });

  it("leaves message items on content as output_text", async () => {
    const { runtime, events } = await recordingContext();
    const state = createEmitState();
    await emitTranslatedEvent({ kind: "message", text: "all done" }, runtime.ctx as never, state, "codex-agent");

    const done = events.find((e) => e.type === "item.done") as { item: Record<string, unknown> };
    expect(done.item).not.toHaveProperty("summary");
    expect(done.item.content).toEqual([{ type: "output_text", text: "all done" }]);
    const contentDone = events.find((e) => e.type === "content.done") as { content: unknown };
    expect(contentDone.content).toEqual({ type: "output_text", text: "all done" });
    expect(state.finalMessage).toBe("all done");
  });
});

// Characterization of the task scope every item carries: which of `taskId` and
// `ownedBy` are present, and with what value, for each identity the runtime can
// hand over, on every item kind and every close path. Asserted on the item's
// key list read off the raw `item.added` / `item.done` events, because a key
// set to `undefined` and an absent key are different items once persisted.
describe("scope characterization", () => {
  type Identity = { taskId?: string; ownedBy?: string };

  const IDENTITIES: Array<[string, Identity]> = [
    ["none", {}],
    ["task only", { taskId: "task_42" }],
    ["owner only", { ownedBy: "container_7" }],
    ["task and owner", { taskId: "task_42", ownedBy: "container_7" }],
    ["empty-string task", { taskId: "" }],
  ];

  /** A context that records every raw emitted event, standing in the given identity. */
  function recordingContext(identity: Identity) {
    const events: Array<{ type: string; item?: Record<string, unknown> & { id: string; type: string } }> = [];
    const ids = new Set<string>();
    const ctx = {
      request: { identity: { id: "req_1" } },
      response: {
        emit: async (e: (typeof events)[number]) => {
          events.push(e);
          if (e.item) ids.add(e.item.id);
        },
        getItemCount: () => ids.size,
      },
      emit: { status: () => {} },
      _blockIdentity: { blockName: "codex-agent", blockInstanceId: "codex-agent_1", phase: "main", ...identity },
    };
    return { ctx, events };
  }

  /**
   * Every item kind and close path: message, reasoning, a tool opened and
   * settled, an orphan failed result, an error, and a tool left open and closed
   * at stream end.
   */
  async function runScript(identity: Identity) {
    const { ctx, events } = recordingContext(identity);
    const state = createEmitState();
    for (const event of [
      { kind: "message", text: "done" },
      { kind: "reasoning", text: "thinking" },
      { kind: "tool_call", callId: "c1", name: "command_execution", arguments: "{}" },
      { kind: "tool_result", callId: "c1", name: "command_execution", arguments: "{}", output: "ok", isError: false },
      { kind: "tool_result", callId: "c-orphan", name: "command_execution", arguments: "{}", output: "bad", isError: true },
      { kind: "error", message: "transient" },
      { kind: "tool_call", callId: "c2", name: "command_execution", arguments: "{}" },
    ] as const) {
      await emitTranslatedEvent(event, ctx as never, state, "codex-agent");
    }
    await finalizeOpenItems(ctx as never, state, "codex-agent");
    return events
      .filter((e) => e.type === "item.added" || e.type === "item.done")
      .map((e) => ({ event: e.type, item: e.item! }));
  }

  function expectedScope(identity: Identity): Record<string, string> {
    return {
      ...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
      ...(identity.ownedBy !== undefined ? { ownedBy: identity.ownedBy } : {}),
    };
  }

  /** The scope keys an item actually carries, absent keys omitted. */
  function actualScope(item: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(item).filter(([k]) => k === "taskId" || k === "ownedBy"));
  }

  it("covers every item kind on both open and close", async () => {
    const versions = await runScript({});
    const seen = new Set(versions.map((v) => `${v.item.type}:${v.event}:${String(v.item.status)}`));
    for (const key of [
      "message:item.added:in_progress",
      "message:item.done:completed",
      "reasoning:item.added:in_progress",
      "reasoning:item.done:completed",
      "tool_output:item.added:in_progress",
      "tool_output:item.done:completed",
      "tool_output:item.added:failed",
      "tool_output:item.done:failed",
      "tool_output:item.done:incomplete",
      "error:item.added:failed",
      "error:item.done:failed",
    ]) {
      expect(seen).toContain(key);
    }
  });

  for (const [label, identity] of IDENTITIES) {
    it(`stamps exactly the identity's scope keys on every item version (identity: ${label})`, async () => {
      const versions = await runScript(identity);
      expect(versions.length).toBeGreaterThan(0);
      for (const { event, item } of versions) {
        expect({ type: item.type, event, scope: actualScope(item) }).toEqual({
          type: item.type,
          event,
          scope: expectedScope(identity),
        });
      }
    });
  }
});

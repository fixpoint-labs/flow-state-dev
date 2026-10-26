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
import { translateCursorMessage } from "../src/translate";
import { closeOpenText, createEmitState, emitTranslatedEvent, finalizeOpenItems } from "../src/emit";

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

/**
 * The reasoning renderer reads `summary` as `reasoning_text` parts, the shape
 * the `ReasoningItem` contract declares. A reasoning item carrying `content`
 * instead makes the renderer throw, which takes down the whole Session tab.
 */
describe("reasoning item shape", () => {
  async function emitted(kind: "message" | "reasoning", text: string) {
    const runtime = await createTestContext({});
    const state = createEmitState();
    await emitTranslatedEvent({ kind, text }, runtime.ctx as never, state, "cursor-agent");
    // Text stays open for more chunks until something closes it.
    await closeOpenText(runtime.ctx as never, state);
    return { state, events: runtime.response.getEvents() };
  }

  it("puts reasoning text in summary as reasoning_text, on every event the item travels on", async () => {
    const { events } = await emitted("reasoning", "weighing the options");
    const items = events
      .filter((e) => e.type === "item.added" || e.type === "item.done")
      .map((e) => (e as { item: Record<string, unknown> }).item);

    expect(items.map((item) => item.type)).toEqual(["reasoning", "reasoning"]);
    // The engine folds streamed deltas into the item it was handed, so the
    // added event's object reads as the accumulated text; the shape is the claim.
    expect(items.map((item) => item.summary)).toEqual([
      [{ type: "reasoning_text", text: expect.any(String) }],
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
      _blockIdentity: { blockName: "cursor-agent", blockInstanceId: "cursor-agent_1", phase: "main", ...identity },
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
      { kind: "tool_call", callId: "c1", name: "shell", arguments: "{}" },
      { kind: "tool_result", callId: "c1", name: "shell", arguments: "{}", output: "ok", isError: false },
      { kind: "tool_result", callId: "c-orphan", name: "shell", arguments: "{}", output: "bad", isError: true },
      { kind: "error", message: "transient" },
      { kind: "tool_call", callId: "c2", name: "shell", arguments: "{}" },
    ] as const) {
      await emitTranslatedEvent(event, ctx as never, state, "cursor-agent");
    }
    await finalizeOpenItems(ctx as never, state, "cursor-agent");
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

/**
 * Cursor streams an answer, and its thinking, as a run of small chunks: one
 * `assistant` or `thinking` wire message per few tokens. A chunk is not an item:
 * a reader sees one paragraph, not one row per token.
 */
describe("streamed text arrives in chunks", () => {
  type Ev = { type: string; item?: Record<string, unknown>; content?: unknown; delta?: string; itemId?: string };

  async function run(events: Array<Parameters<typeof emitTranslatedEvent>[0]>, finish: "close" | "abort" | "none" = "close") {
    const runtime = await createTestContext({});
    const state = createEmitState();
    for (const event of events) {
      await emitTranslatedEvent(event, runtime.ctx as never, state, "cursor-agent");
    }
    if (finish === "close") await closeOpenText(runtime.ctx as never, state);
    if (finish === "abort") await finalizeOpenItems(runtime.ctx as never, state, "cursor-agent");
    const wire = runtime.response.getEvents() as Ev[];
    const doneItems = wire.filter((e) => e.type === "item.done").map((e) => e.item!);
    return { state, wire, doneItems };
  }

  const chunks = (kind: "message" | "reasoning", ...texts: string[]) => texts.map((text) => ({ kind, text }) as const);

  it("makes one message item of consecutive chunks, in order", async () => {
    const { wire, doneItems, state } = await run(chunks("message", "Yes", ".", " I'm here", " and working"));
    expect(wire.filter((e) => e.type === "item.added")).toHaveLength(1);
    expect(wire.filter((e) => e.type === "content.delta").map((e) => e.delta)).toEqual(["Yes", ".", " I'm here", " and working"]);
    expect(doneItems).toHaveLength(1);
    expect(doneItems[0]!.content).toEqual([{ type: "output_text", text: "Yes. I'm here and working" }]);
    // The run's final message is the whole answer, not the last chunk of it.
    expect(state.finalMessage).toBe("Yes. I'm here and working");
  });

  it("streams: a chunk is on the wire before the item is done", async () => {
    const { wire } = await run(chunks("message", "Yes", "."), "none");
    expect(wire.map((e) => e.type)).toEqual(["item.added", "content.added", "content.delta", "content.delta"]);
  });

  it("makes one reasoning item of consecutive thinking chunks, text in summary", async () => {
    const { doneItems } = await run(chunks("reasoning", "The", " user is asking", " whether I work."));
    expect(doneItems).toHaveLength(1);
    expect(doneItems[0]!.type).toBe("reasoning");
    expect(doneItems[0]!.summary).toEqual([{ type: "reasoning_text", text: "The user is asking whether I work." }]);
    expect(doneItems[0]).not.toHaveProperty("content");
  });

  it("closes the thinking when the answer starts, so each is its own item", async () => {
    const { doneItems } = await run([...chunks("reasoning", "hm", "m"), ...chunks("message", "Yes", ".")]);
    expect(doneItems.map((i) => i.type)).toEqual(["reasoning", "message"]);
    expect(doneItems[0]!.summary).toEqual([{ type: "reasoning_text", text: "hmm" }]);
    expect(doneItems[1]!.content).toEqual([{ type: "output_text", text: "Yes." }]);
  });

  it("closes the text a tool call interrupts, and starts a new item after it", async () => {
    const { doneItems } = await run([
      ...chunks("message", "Let me", " look."),
      { kind: "tool_call", callId: "c1", name: "shell", arguments: "{}" },
      { kind: "tool_result", callId: "c1", name: "shell", arguments: "{}", output: "ok", isError: false },
      ...chunks("message", "Found", " it."),
    ]);
    expect(doneItems.map((i) => i.type)).toEqual(["message", "tool_output", "message"]);
    expect(doneItems[0]!.content).toEqual([{ type: "output_text", text: "Let me look." }]);
    expect(doneItems[2]!.content).toEqual([{ type: "output_text", text: "Found it." }]);
  });

  it("keeps the text it has when the run ends early, marked incomplete, and not as the final message", async () => {
    const { doneItems, state } = await run(chunks("message", "Half an", " answ"), "abort");
    expect(doneItems).toHaveLength(1);
    expect(doneItems[0]!.status).toBe("incomplete");
    expect(doneItems[0]!.content).toEqual([{ type: "output_text", text: "Half an answ" }]);
    expect(state.finalMessage).toBeNull();
  });
});

/** The start of a real Cursor turn ("Do you work?"), as its stream delivered it: token-sized chunks. */
describe("a recorded Cursor stream", () => {
  const thinking = ["The", " user is asking whether", " I am operational."];
  const answer = ["Yes", ".", " I\u2019m here and", " working", " in your", " workspace", " at `/Users/j", "akehoffner/.", "local/state/flow"];

  it("reads as one thought and one answer, not a row per chunk", async () => {
    const wire = [
      ...thinking.map((text) => ({ type: "thinking", text })),
      ...answer.map((text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } })),
    ];
    const runtime = await createTestContext({});
    const state = createEmitState();
    for (const message of wire) {
      for (const event of translateCursorMessage(message as never)) {
        await emitTranslatedEvent(event, runtime.ctx as never, state, "cursor-agent");
      }
    }
    await closeOpenText(runtime.ctx as never, state);

    const done = (runtime.response.getEvents() as Array<{ type: string; item?: Record<string, unknown> }>)
      .filter((e) => e.type === "item.done")
      .map((e) => e.item!);
    expect(done.map((i) => i.type)).toEqual(["reasoning", "message"]);
    expect(done[0]!.summary).toEqual([{ type: "reasoning_text", text: thinking.join("") }]);
    expect(done[1]!.content).toEqual([{ type: "output_text", text: answer.join("") }]);
    expect(state.finalMessage).toBe(answer.join(""));
  });
});

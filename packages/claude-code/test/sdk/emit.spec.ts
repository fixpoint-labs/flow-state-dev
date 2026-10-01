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
function fakeEmitCtx(scope: { taskId?: string; ownedBy?: string } = {}) {
  const events: Array<{ type: string; item?: { id?: string; type?: string; taskId?: string; ownedBy?: string } }> = [];
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

// Characterization of the task scope every item carries: which of `taskId` and
// `ownedBy` are present, and with what value, for each identity the runtime can
// hand over, on every item kind and every close path. It is asserted on the
// item's key list, because a key set to `undefined` and an absent key are
// different items once persisted.
//
// The owner rules follow the Container Ownership contract
// (`docs/architecture/streaming.md`): an item inside a sub-agent carries the
// sub-agent's container as its owner whatever the runtime says; a top-level
// item and the sub-agent box itself carry the runtime's owner.
describe("scope characterization", () => {
  const BLOCK = "claude-code-agent";
  /** The sub-agent box's own instance id: the run's instance id, then the script's sub-agent call id `s1`. */
  const SUBAGENT_OWNER = `${fakeEmitCtx().ctx._blockIdentity!.blockInstanceId}:subagent:s1`;

  type Identity = { taskId?: string; ownedBy?: string };
  type Where = "top" | "inner" | "container";

  const IDENTITIES: Array<[string, Identity]> = [
    ["none", {}],
    ["task only", { taskId: "task_42" }],
    ["owner only", { ownedBy: "container_7" }],
    ["task and owner", { taskId: "task_42", ownedBy: "container_7" }],
    ["empty-string task", { taskId: "" }],
  ];

  /**
   * An item inside the sub-agent carries the sub-agent's owner; a top-level
   * item and the sub-agent box itself carry the runtime's, as a nested
   * container's own item does.
   */
  function expectedScope(where: Where, identity: Identity): Record<string, string> {
    const ownedBy = where === "inner" ? SUBAGENT_OWNER : identity.ownedBy;
    return {
      ...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
      ...(ownedBy !== undefined ? { ownedBy } : {}),
    };
  }

  /** The scope keys an item actually carries, absent keys omitted. */
  function actualScope(item: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(item).filter(([k]) => k === "taskId" || k === "ownedBy"));
  }

  /**
   * Every item kind and close path the emitter has: streamed message and
   * reasoning closed by the next item, by a turn-boundary flush, by a tool call,
   * by a sub-agent opening, and at stream end; whole message and reasoning; a
   * tool opened and settled, an orphan failed result, a tool left open; a
   * sub-agent opened and closed, closed failed, and left open; an error; and,
   * inside a sub-agent, its streamed and whole text, a tool opened and settled,
   * an orphan result, and a tool left open.
   */
  async function runScript(identity: Identity) {
    const { ctx, events } = fakeEmitCtx(identity);
    const state = createEmitState();
    const whereById = new Map<string, Where>();
    const step = async (where: Where, run: () => Promise<void>) => {
      const from = events.length;
      await run();
      for (const e of events.slice(from)) {
        const id = e.item?.id;
        if (id !== undefined && !whereById.has(id)) {
          whereById.set(id, e.item?.type === "container" ? "container" : where);
        }
      }
    };
    const emit = (event: Parameters<typeof emitTranslatedEvent>[0]) => emitTranslatedEvent(event, ctx, state, BLOCK);

    await step("top", () => emit({ kind: "reasoning_delta", text: "r1" }));
    await step("top", () => emit({ kind: "message_delta", text: "m1" }));
    await step("top", () => closeStreamingItems(ctx, state, BLOCK));
    await step("top", () => emit({ kind: "message_complete", text: "whole" }));
    await step("top", () => emit({ kind: "reasoning_complete", text: "whole" }));
    await step("top", () => emit({ kind: "message_delta", text: "m2" }));
    await step("top", () => emit({ kind: "tool_call", callId: "t1", name: "Bash", arguments: "{}" }));
    await step("top", () => emit({ kind: "tool_result", callId: "t1", output: "ok", isError: false }));
    await step("top", () => emit({ kind: "tool_result", callId: "t-orphan", output: "bad", isError: true }));
    await step("top", () => emit({ kind: "reasoning_delta", text: "r2" }));
    await step("top", () => emit({ kind: "subagent_open", callId: "s1", name: "Task" }));
    await step("inner", () => emit({ kind: "message_delta", text: "im", parentCallId: "s1" }));
    await step("inner", () => emit({ kind: "reasoning_delta", text: "ir", parentCallId: "s1" }));
    await step("inner", () => closeStreamingItems(ctx, state, BLOCK));
    await step("inner", () => emit({ kind: "message_complete", text: "iwhole", parentCallId: "s1" }));
    await step("inner", () => emit({ kind: "reasoning_complete", text: "iwhole", parentCallId: "s1" }));
    await step("inner", () =>
      emit({ kind: "tool_call", callId: "t2", name: "Read", arguments: "{}", parentCallId: "s1" }),
    );
    await step("inner", () =>
      emit({ kind: "tool_result", callId: "t2", output: "ok", isError: false, parentCallId: "s1" }),
    );
    await step("inner", () =>
      emit({ kind: "tool_result", callId: "t-in-orphan", output: "ok", isError: false, parentCallId: "s1" }),
    );
    await step("inner", () =>
      emit({ kind: "tool_call", callId: "t3", name: "Grep", arguments: "{}", parentCallId: "s1" }),
    );
    await step("top", () => emit({ kind: "subagent_close", callId: "s1", output: "done", isError: false }));
    await step("top", () => emit({ kind: "subagent_open", callId: "s2", name: "Task" }));
    await step("top", () => emit({ kind: "subagent_close", callId: "s2", output: "failed", isError: true }));
    await step("top", () => emit({ kind: "subagent_open", callId: "s3", name: "Task" }));
    await step("top", () => emit({ kind: "error", message: "boom" }));
    await step("top", () => emit({ kind: "tool_call", callId: "t4", name: "Bash", arguments: "{}" }));
    await step("top", () => emit({ kind: "message_delta", text: "m3" }));
    await step("top", () => emit({ kind: "reasoning_delta", text: "r3" }));
    await step("top", () => finalizeOpenItems(ctx, state, BLOCK));

    const versions = events
      .filter((e) => e.type === "item.added" || e.type === "item.done")
      .map((e) => ({ event: e.type, item: e.item as Record<string, unknown> & { id: string; type: string } }));
    return { versions, whereById };
  }

  it("covers every item kind, inside and outside a sub-agent, on both open and close", async () => {
    const { versions, whereById } = await runScript({});
    const seen = new Set(versions.map((v) => `${whereById.get(v.item.id)}:${v.item.type}:${v.event}`));
    for (const key of [
      "top:message:item.added",
      "top:message:item.done",
      "top:reasoning:item.added",
      "top:reasoning:item.done",
      "top:tool_output:item.added",
      "top:tool_output:item.done",
      "top:error:item.added",
      "top:error:item.done",
      "container:container:item.added",
      "container:container:item.done",
      "inner:message:item.added",
      "inner:message:item.done",
      "inner:reasoning:item.added",
      "inner:reasoning:item.done",
      "inner:tool_output:item.added",
      "inner:tool_output:item.done",
    ]) {
      expect(seen).toContain(key);
    }
    // Every opened item is closed, including the ones finalized at stream end.
    const done = new Set(versions.filter((v) => v.event === "item.done").map((v) => v.item.id));
    for (const v of versions.filter((x) => x.event === "item.added")) expect(done).toContain(v.item.id);
  });

  for (const [label, identity] of IDENTITIES) {
    it(`stamps exactly the expected scope keys on every item version (identity: ${label})`, async () => {
      const { versions, whereById } = await runScript(identity);
      expect(versions.length).toBeGreaterThan(0);
      for (const { event, item } of versions) {
        const where = whereById.get(item.id)!;
        expect({ where, type: item.type, event, scope: actualScope(item) }).toEqual({
          where,
          type: item.type,
          event,
          scope: expectedScope(where, identity),
        });
      }
    });
  }
});

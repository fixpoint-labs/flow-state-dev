/**
 * Tests for item visibility (client/history booleans) and backward
 * compatibility with the legacy itemRole / trace fields.
 *
 * Exercises:
 *   - `resolveItemVisibility` resolution order across explicit client/history,
 *     legacy `itemRole`, legacy `trace: true`, and per-type defaults.
 *   - `resolveItemRole` backward-compat shim mapping.
 *   - `normalizeEmit` precedence with the new EmitOverride shape.
 *   - `resolvePositionDefault` for main vs work/tool positions.
 *   - History assembly: items with `history: true` included; `history: false`
 *     excluded.
 *   - Emission helpers (`emitMessage`, `emitStatus`) stamp the new booleans.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { OutputItem } from "@flow-state-dev/core/items";
import { resolveItemRole, resolveItemVisibility } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

// ---------------------------------------------------------------------------
// resolveItemVisibility
// ---------------------------------------------------------------------------

function baseItem(overrides: Partial<OutputItem> = {}): OutputItem {
  const defaults = {
    id: "item_1",
    type: "message",
    status: "completed",
    requestId: "req_1",
    itemIndex: 0,
    ts: 0,
    provenance: {
      blockName: "b",
      blockInstanceId: "b_1",
      phase: "main"
    },
    role: "assistant",
    content: [{ type: "output_text", text: "hi" }]
  } as unknown as OutputItem;
  return { ...defaults, ...overrides };
}

describe("resolveItemVisibility", () => {
  it("returns explicit client/history when set", () => {
    expect(resolveItemVisibility(baseItem({ client: false, history: true }))).toEqual({
      client: false,
      history: true,
    });
  });

  it("partial explicit: fills from type defaults", () => {
    const vis = resolveItemVisibility(baseItem({ client: false }));
    expect(vis.client).toBe(false);
    expect(vis.history).toBe(true);
  });

  it("maps legacy itemRole: external to client+history", () => {
    expect(resolveItemVisibility(baseItem({ itemRole: "external" }))).toEqual({
      client: true,
      history: true,
    });
  });

  it("maps legacy itemRole: internal to !client+history", () => {
    expect(resolveItemVisibility(baseItem({ itemRole: "internal" }))).toEqual({
      client: false,
      history: true,
    });
  });

  it("maps legacy itemRole: trace to !client+!history", () => {
    expect(resolveItemVisibility(baseItem({ itemRole: "trace" }))).toEqual({
      client: false,
      history: false,
    });
  });

  it("maps legacy trace: true to !client+!history", () => {
    expect(resolveItemVisibility(baseItem({ trace: true }))).toEqual({
      client: false,
      history: false,
    });
  });

  it("explicit client/history takes precedence over legacy itemRole", () => {
    expect(
      resolveItemVisibility(baseItem({ client: true, history: false, itemRole: "trace" }))
    ).toEqual({ client: true, history: false });
  });

  it("returns per-type defaults for structural types", () => {
    const structural = ["block_output", "router_decision", "sequencer_state_snapshot"];
    for (const type of structural) {
      const item = baseItem() as OutputItem & { type: string };
      (item as { type: string }).type = type;
      const vis = resolveItemVisibility(item as OutputItem);
      expect(vis.client).toBe(false);
      expect(vis.history).toBe(false);
    }
  });

  it("returns client-only defaults for component/status types", () => {
    for (const type of ["component", "status", "error", "step_error"]) {
      const item = baseItem() as OutputItem & { type: string };
      (item as { type: string }).type = type;
      const vis = resolveItemVisibility(item as OutputItem);
      expect(vis.client).toBe(true);
      expect(vis.history).toBe(false);
    }
  });

  it("returns client+history defaults for message/reasoning/block_tool_output", () => {
    for (const type of ["message", "reasoning", "block_tool_output"]) {
      const item = baseItem() as OutputItem & { type: string };
      (item as { type: string }).type = type;
      const vis = resolveItemVisibility(item as OutputItem);
      expect(vis.client).toBe(true);
      expect(vis.history).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveItemRole backward compat shim
// ---------------------------------------------------------------------------

describe("resolveItemRole (deprecated shim)", () => {
  it("returns external for client+history items", () => {
    expect(resolveItemRole(baseItem({ client: true, history: true }))).toBe("external");
  });

  it("returns internal for !client+history items", () => {
    expect(resolveItemRole(baseItem({ client: false, history: true }))).toBe("internal");
  });

  it("returns trace for !client+!history items", () => {
    expect(resolveItemRole(baseItem({ client: false, history: false }))).toBe("trace");
  });

  it("returns external for client-only items (no history)", () => {
    expect(resolveItemRole(baseItem({ client: true, history: false }))).toBe("external");
  });
});

// ---------------------------------------------------------------------------
// Emission helpers stamp client/history
// ---------------------------------------------------------------------------

describe("emitMessage visibility stamping", () => {
  it("stamps client: true, history: true at the root scope", async () => {
    const emitter = handler({
      name: "emitter",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (_input, ctx) => {
        const handle = ctx.emitMessage("hello from emitter");
        handle.done();
        return { ok: true };
      }
    });

    const flow = defineFlow({
      kind: "vis-emit-flow",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: emitter
        }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({
      requestId: "req_emit",
      now: () => Date.now()
    });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_emit",
      sessionId: "sess_emit",
      stores,
      responseEmitter: response
    });

    const messageItems = response
      .getItems()
      .filter((item) => item.type === "message");
    expect(messageItems.length).toBeGreaterThanOrEqual(1);
    const message = messageItems[0]!;
    expect(message.client).toBe(true);
    expect(message.history).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeEmit precedence (pure unit tests)
// ---------------------------------------------------------------------------

describe("normalizeEmit precedence", () => {
  it("emit: false suppresses every item type", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(normalizeEmit(false, undefined, { client: true, history: true })).toEqual({
      reasoning: false,
      messages: false,
      toolCalls: false
    });
  });

  it("per-type override with explicit client/history", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    const result = normalizeEmit(
      { messages: { client: false }, reasoning: false },
      undefined,
      { client: true, history: true }
    );
    expect(result.messages).toEqual({ client: false, history: true });
    expect(result.reasoning).toBe(false);
    expect(result.toolCalls).toEqual({ client: true, history: true });
  });

  it("block-level client overrides position default", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    const result = normalizeEmit(
      undefined,
      { client: false },
      { client: true, history: true }
    );
    expect(result.messages).toEqual({ client: false, history: true });
    expect(result.reasoning).toEqual({ client: false, history: true });
    expect(result.toolCalls).toEqual({ client: false, history: true });
  });

  it("position default applies when block visibility and emit are absent", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    const result = normalizeEmit(
      undefined,
      undefined,
      { client: false, history: false }
    );
    expect(result.messages).toEqual({ client: false, history: false });
    expect(result.reasoning).toEqual({ client: false, history: false });
    expect(result.toolCalls).toEqual({ client: false, history: false });
  });

  it("per-type boolean false suppresses that type", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    const result = normalizeEmit(
      { reasoning: false },
      undefined,
      { client: true, history: true }
    );
    expect(result.reasoning).toBe(false);
    expect(result.messages).toEqual({ client: true, history: true });
    expect(result.toolCalls).toEqual({ client: true, history: true });
  });

  it("per-type boolean true uses block defaults", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    const result = normalizeEmit(
      { reasoning: true },
      { client: false },
      { client: true, history: true }
    );
    expect(result.reasoning).toEqual({ client: false, history: true });
  });
});

// ---------------------------------------------------------------------------
// resolvePositionDefault
// ---------------------------------------------------------------------------

describe("resolvePositionDefault", () => {
  it("defaults to client+history in the main phase with no generator parent", async () => {
    const { resolvePositionDefault } = await import("../../core/src/blocks/generator");
    const ctx = {
      _blockIdentity: { blockName: "b", blockInstanceId: "b_1", phase: "main" as const }
    } as unknown as Parameters<typeof resolvePositionDefault>[0];
    expect(resolvePositionDefault(ctx)).toEqual({ client: true, history: true });
  });

  it("returns suppressed when parent is a generator (tool-call position)", async () => {
    const { resolvePositionDefault } = await import("../../core/src/blocks/generator");
    const ctx = {
      parent: { name: "caller", kind: "generator" as const, input: undefined },
      _blockIdentity: { blockName: "b", blockInstanceId: "b_1", phase: "main" as const }
    } as unknown as Parameters<typeof resolvePositionDefault>[0];
    expect(resolvePositionDefault(ctx)).toEqual({ client: false, history: false });
  });

  it("returns suppressed when the block identity marks phase as work", async () => {
    const { resolvePositionDefault } = await import("../../core/src/blocks/generator");
    const ctx = {
      _blockIdentity: { blockName: "b", blockInstanceId: "b_1", phase: "work" as const }
    } as unknown as Parameters<typeof resolvePositionDefault>[0];
    expect(resolvePositionDefault(ctx)).toEqual({ client: false, history: false });
  });
});

// ---------------------------------------------------------------------------
// Structural items stamp client: false, history: false
// ---------------------------------------------------------------------------

describe("structural item visibility stamping", () => {
  it("stamps block_output items with client: false, history: false", async () => {
    const h = handler({
      name: "noop",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    });

    const flow = defineFlow({
      kind: "vis-struct-flow",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: h
        }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({
      requestId: "req_struct",
      now: () => Date.now()
    });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_struct",
      sessionId: "sess_struct",
      stores,
      responseEmitter: response
    });

    const blockOutputs = response.getItems().filter((i) => i.type === "block_output");
    expect(blockOutputs.length).toBeGreaterThan(0);
    for (const item of blockOutputs) {
      expect(item.client).toBe(false);
      expect(item.history).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// History assembly respects visibility
// ---------------------------------------------------------------------------

describe("itemToLLMMessages visibility filtering", () => {
  it("includes items with history: true, excludes history: false", async () => {
    const flow = defineFlow({
      kind: "llm-vis-filter-flow",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true })
          })
        }
      }
    })();

    const stores = createInMemoryStores();
    const prov = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };

    await stores.request.set("req_prev_vis", {
      id: "req_prev_vis",
      flowKind: flow.kind,
      actionName: "run",
      sessionId: "sess_vis",
      userId: "user_vis",
      status: "completed",
      startedAtMs: 1,
      updatedAt: 1,
      items: [
        {
          id: "m_ext",
          type: "message",
          status: "completed",
          client: true,
          history: true,
          requestId: "req_prev_vis",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "user input" }],
          provenance: prov
        },
        {
          id: "m_int",
          type: "message",
          status: "completed",
          client: false,
          history: true,
          requestId: "req_prev_vis",
          itemIndex: 1,
          ts: 2,
          role: "assistant",
          content: [{ type: "output_text", text: "internal synthesis" }],
          provenance: prov
        },
        {
          id: "m_hidden",
          type: "message",
          status: "completed",
          client: false,
          history: false,
          requestId: "req_prev_vis",
          itemIndex: 2,
          ts: 3,
          role: "assistant",
          content: [{ type: "output_text", text: "background worker chatter" }],
          provenance: prov
        }
      ]
    } as any);

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_cur_vis",
      sessionId: "sess_vis",
      userId: "user_vis",
      stores
    });

    const llmMessages = await ctx.session.items.llm();
    expect(llmMessages.map((m) => m.content)).toEqual([
      "user input",
      "internal synthesis"
    ]);
  });

  it("backward compat: legacy itemRole still gates history inclusion", async () => {
    const flow = defineFlow({
      kind: "legacy-role-flow",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true })
          })
        }
      }
    })();

    const stores = createInMemoryStores();
    const prov = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };

    await stores.request.set("req_legacy", {
      id: "req_legacy",
      flowKind: flow.kind,
      actionName: "run",
      sessionId: "sess_legacy",
      userId: "user_legacy",
      status: "completed",
      startedAtMs: 1,
      updatedAt: 1,
      items: [
        {
          id: "m_user",
          type: "message",
          status: "completed",
          itemRole: "external",
          requestId: "req_legacy",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "hello" }],
          provenance: prov
        },
        {
          id: "m_trace",
          type: "message",
          status: "completed",
          itemRole: "trace",
          requestId: "req_legacy",
          itemIndex: 1,
          ts: 2,
          role: "assistant",
          content: [{ type: "output_text", text: "hidden" }],
          provenance: prov
        }
      ]
    } as any);

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_cur_legacy",
      sessionId: "sess_legacy",
      userId: "user_legacy",
      stores
    });

    const llmMessages = await ctx.session.items.llm();
    expect(llmMessages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("backward compat: legacy trace: true still excludes from history", async () => {
    const flow = defineFlow({
      kind: "legacy-trace-flow",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "noop",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true })
          })
        }
      }
    })();

    const stores = createInMemoryStores();
    const prov = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };

    await stores.request.set("req_trace", {
      id: "req_trace",
      flowKind: flow.kind,
      actionName: "run",
      sessionId: "sess_trace",
      userId: "user_trace",
      status: "completed",
      startedAtMs: 1,
      updatedAt: 1,
      items: [
        {
          id: "m_user",
          type: "message",
          status: "completed",
          requestId: "req_trace",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "hello" }],
          provenance: prov
        },
        {
          id: "m_legacy_trace",
          type: "message",
          status: "completed",
          trace: true,
          requestId: "req_trace",
          itemIndex: 1,
          ts: 2,
          role: "assistant",
          content: [{ type: "output_text", text: "hidden" }],
          provenance: prov
        }
      ]
    } as any);

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_cur_trace",
      sessionId: "sess_trace",
      userId: "user_trace",
      stores
    });

    const llmMessages = await ctx.session.items.llm();
    expect(llmMessages).toEqual([{ role: "user", content: "hello" }]);
  });
});

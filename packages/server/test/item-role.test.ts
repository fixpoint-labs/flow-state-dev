/**
 * Tests for the three-tier item visibility role system (FIX-389).
 *
 * Exercises:
 *   - `resolveItemRole` resolution order across explicit role, legacy
 *     `trace: true`, structural item types, work-phase fallback, and defaults.
 *   - `emit` config shapes: `false`, role strings, boolean per-type, role
 *     per-type, and backward-compatible boolean values.
 *   - `normalizeEmit` precedence: per-type > top-level > block-level `itemRole`
 *     > position-based default.
 *   - History assembly: `external` and `internal` included; `trace` excluded.
 *   - Emission helpers (`emitMessage`, `emitStatus`) stamp the resolved role.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ItemRole, OutputItem } from "@flow-state-dev/core/items";
import { resolveItemRole } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

// ---------------------------------------------------------------------------
// resolveItemRole
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

describe("resolveItemRole", () => {
  it("returns explicit itemRole when set", () => {
    expect(resolveItemRole(baseItem({ itemRole: "internal" }))).toBe("internal");
    expect(resolveItemRole(baseItem({ itemRole: "trace" }))).toBe("trace");
    expect(resolveItemRole(baseItem({ itemRole: "external" }))).toBe("external");
  });

  it("falls back to trace when legacy trace: true is set", () => {
    expect(resolveItemRole(baseItem({ trace: true }))).toBe("trace");
  });

  it("prefers explicit itemRole over legacy trace boolean", () => {
    expect(
      resolveItemRole(baseItem({ itemRole: "internal", trace: true }))
    ).toBe("internal");
  });

  it("returns trace for structural item types without explicit role", () => {
    const structural: string[] = [
      "block_output",
      "router_decision",
      "sequencer_state_snapshot",
      "container",
      "state_change",
      "resource_change"
    ];
    for (const type of structural) {
      const item = baseItem() as OutputItem & { type: string };
      (item as { type: string }).type = type;
      expect(resolveItemRole(item as OutputItem)).toBe("trace");
    }
  });

  it("returns trace for work-phase items without explicit role", () => {
    const workItem = baseItem();
    (workItem.provenance as { phase: "main" | "work" }).phase = "work";
    expect(resolveItemRole(workItem)).toBe("trace");
  });

  it("defaults to external for conversational items without role hints", () => {
    expect(resolveItemRole(baseItem())).toBe("external");
  });
});

// ---------------------------------------------------------------------------
// Emission helpers stamp roles (and itemToLLMMessages respects them)
// ---------------------------------------------------------------------------

describe("emitMessage role stamping", () => {
  it("stamps external role at the root scope and includes the message in LLM history", async () => {
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
      kind: "role-emit-flow",
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
    expect(message.itemRole).toBe("external" satisfies ItemRole);
    expect(resolveItemRole(message)).toBe("external");
  });

  it("propagates block-level itemRole to emitted messages", async () => {
    const internalBlock = handler({
      name: "internal-emitter",
      itemRole: "internal",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: (_input, ctx) => {
        ctx.emitMessage("only for the model").done();
        return { ok: true };
      }
    });

    const flow = defineFlow({
      kind: "role-internal-flow",
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: internalBlock
        }
      }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({
      requestId: "req_internal",
      now: () => Date.now()
    });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_internal",
      sessionId: "sess_internal",
      stores,
      responseEmitter: response
    });

    const message = response
      .getItems()
      .find((item) => item.type === "message" && (item as { role?: string }).role === "assistant");
    expect(message).toBeDefined();
    expect(message!.itemRole).toBe("internal" satisfies ItemRole);
  });
});

// ---------------------------------------------------------------------------
// normalizeEmit precedence + position-default resolution (pure unit tests)
// ---------------------------------------------------------------------------

describe("normalizeEmit precedence", () => {
  it("emit: false suppresses every item type", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(normalizeEmit(false, undefined, "external")).toEqual({
      reasoning: false,
      messages: false,
      toolCalls: false
    });
  });

  it("top-level role string applies to every item type", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(normalizeEmit("internal", undefined, "external")).toEqual({
      reasoning: "internal",
      messages: "internal",
      toolCalls: "internal"
    });
  });

  it("per-type role overrides the block-level default", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(
      normalizeEmit({ messages: "internal", reasoning: "trace" }, "external", "external")
    ).toEqual({
      reasoning: "trace",
      messages: "internal",
      toolCalls: "external"
    });
  });

  it("block-level itemRole overrides the position default when emit is absent", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(normalizeEmit(undefined, "internal", "external")).toEqual({
      reasoning: "internal",
      messages: "internal",
      toolCalls: "internal"
    });
  });

  it("position default applies when both block itemRole and emit are absent", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(normalizeEmit(undefined, undefined, "trace")).toEqual({
      reasoning: "trace",
      messages: "trace",
      toolCalls: "trace"
    });
  });

  it("preserves per-type boolean false (backward compat)", async () => {
    const { normalizeEmit } = await import("../../core/src/blocks/generator");
    expect(
      normalizeEmit({ reasoning: false }, undefined, "external")
    ).toEqual({
      reasoning: false,
      messages: "external",
      toolCalls: "external"
    });
  });
});

// ---------------------------------------------------------------------------
// resolvePositionDefaultRole (reads _blockIdentity.phase + ctx.parent)
// ---------------------------------------------------------------------------

describe("resolvePositionDefaultRole", () => {
  it("defaults to external in the main phase with no generator parent", async () => {
    const { resolvePositionDefaultRole } = await import("../../core/src/blocks/generator");
    const ctx = {
      _blockIdentity: { blockName: "b", blockInstanceId: "b_1", phase: "main" as const }
    } as unknown as Parameters<typeof resolvePositionDefaultRole>[0];
    expect(resolvePositionDefaultRole(ctx)).toBe("external");
  });

  it("returns trace when parent is a generator (tool-call position)", async () => {
    const { resolvePositionDefaultRole } = await import("../../core/src/blocks/generator");
    const ctx = {
      parent: { name: "caller", kind: "generator" as const, input: undefined },
      _blockIdentity: { blockName: "b", blockInstanceId: "b_1", phase: "main" as const }
    } as unknown as Parameters<typeof resolvePositionDefaultRole>[0];
    expect(resolvePositionDefaultRole(ctx)).toBe("trace");
  });

  it("returns trace when the block identity marks phase as work", async () => {
    const { resolvePositionDefaultRole } = await import("../../core/src/blocks/generator");
    const ctx = {
      _blockIdentity: { blockName: "b", blockInstanceId: "b_1", phase: "work" as const }
    } as unknown as Parameters<typeof resolvePositionDefaultRole>[0];
    expect(resolvePositionDefaultRole(ctx)).toBe("trace");
  });
});

// ---------------------------------------------------------------------------
// Structural items stamp trace role
// ---------------------------------------------------------------------------

describe("structural item role stamping", () => {
  it("stamps block_output items with itemRole: trace", async () => {
    const h = handler({
      name: "noop",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true })
    });

    const flow = defineFlow({
      kind: "role-struct-flow",
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
      expect(item.itemRole).toBe("trace" satisfies ItemRole);
      // Legacy flag retained for backward compatibility.
      expect(item.trace).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// History assembly respects role (external + internal included, trace excluded)
// ---------------------------------------------------------------------------

describe("itemToLLMMessages role filtering", () => {
  it("includes external and internal messages, excludes trace items", async () => {
    const flow = defineFlow({
      kind: "llm-role-filter-flow",
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

    await stores.request.set("req_prev_role", {
      id: "req_prev_role",
      flowKind: flow.kind,
      actionName: "run",
      sessionId: "sess_role",
      userId: "user_role",
      status: "completed",
      startedAtMs: 1,
      updatedAt: 1,
      items: [
        // External message — included.
        {
          id: "m_ext",
          type: "message",
          status: "completed",
          itemRole: "external",
          requestId: "req_prev_role",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "user input" }],
          provenance: prov
        },
        // Internal assistant note — included (hidden from UI, visible to LLM).
        {
          id: "m_int",
          type: "message",
          status: "completed",
          itemRole: "internal",
          requestId: "req_prev_role",
          itemIndex: 1,
          ts: 2,
          role: "assistant",
          content: [{ type: "output_text", text: "internal synthesis" }],
          provenance: prov
        },
        // Trace message — excluded by role even though type is "message".
        {
          id: "m_trc",
          type: "message",
          status: "completed",
          itemRole: "trace",
          requestId: "req_prev_role",
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
      requestId: "req_cur_role",
      sessionId: "sess_role",
      userId: "user_role",
      stores
    });

    const llmMessages = await ctx.session.items.llm();

    // Exactly the external + internal messages — no trace content.
    expect(llmMessages.map((m) => m.content)).toEqual([
      "user input",
      "internal synthesis"
    ]);
  });

  it("still excludes legacy trace: true items (backward compat)", async () => {
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
          requestId: "req_legacy",
          itemIndex: 0,
          ts: 1,
          role: "user",
          content: [{ type: "output_text", text: "hello" }],
          provenance: prov
        },
        // Legacy trace marker (no itemRole) — must still be excluded.
        {
          id: "m_legacy_trace",
          type: "message",
          status: "completed",
          trace: true,
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

});

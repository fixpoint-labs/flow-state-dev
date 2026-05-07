/**
 * Tests for `resolveItemVisibility()` — the pure function that derives
 * `{ client, history }` from `(item.type, item.agentType)`. Generator
 * identity governs conversational items; structural items have fixed
 * per-type visibility.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";

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

describe("resolveItemVisibility — conversational types", () => {
  it("agent-typed message → client + history", () => {
    expect(resolveItemVisibility(baseItem({ agentType: "primary" }))).toEqual({
      client: true,
      history: true,
    });
  });

  it("sub-agent-typed message → client, no history", () => {
    expect(resolveItemVisibility(baseItem({ agentType: "sub" }))).toEqual({
      client: true,
      history: false,
    });
  });

  it("trace-typed message → neither client nor history", () => {
    expect(resolveItemVisibility(baseItem({ agentType: "trace" }))).toEqual({
      client: false,
      history: false,
    });
  });

  it("message with no agentType → agent-equivalent fallback (handler emit)", () => {
    expect(resolveItemVisibility(baseItem())).toEqual({
      client: true,
      history: true,
    });
  });

  it("agent-typed reasoning → client + history", () => {
    const item = baseItem({
      type: "reasoning",
      agentType: "primary",
      summary: [{ type: "reasoning_text", text: "thinking" }],
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: true });
  });

  it("sub-agent reasoning → client only", () => {
    const item = baseItem({
      type: "reasoning",
      agentType: "sub",
      summary: [{ type: "reasoning_text", text: "thinking" }],
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  it("block_tool_output from sub-agent → client only", () => {
    const item = baseItem({
      type: "tool_output",
      agentType: "sub",
      blockName: "search",
      output: {},
      toolCall: { callId: "c1", name: "search", arguments: "{}", generatorBlock: "gen" },
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });
});

describe("resolveItemVisibility — structural types", () => {
  it("component → client, not history", () => {
    const item = baseItem({
      type: "component",
      component: "plan",
      data: {},
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  it("status → client, not history", () => {
    const item = baseItem({
      type: "status",
      message: "Working…",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  it("error → client, not history", () => {
    const item = baseItem({
      type: "error",
      message: "boom",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  // Trace types (block_output, router_decision, state_snapshot, block_debug)
  // are stamped `agentType: "trace"` at emission time and short-circuit to
  // invisible via the agentType branch — they have no entries in the
  // structural defaults table. These tests confirm that contract.
  it("block_output stamped trace → neither client nor history", () => {
    const item = baseItem({
      type: "block_trace",
      agentType: "trace",
      blockName: "b",
      output: {},
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("router_decision stamped trace → neither client nor history", () => {
    const item = baseItem({
      type: "router_decision",
      agentType: "trace",
      routerName: "r",
      selectedRoute: "a",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("state_snapshot stamped trace → neither client nor history", () => {
    const item = baseItem({
      type: "state_snapshot",
      agentType: "trace",
      stepName: "s",
      stepIndex: 0,
      state: {},
      version: 0,
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("trace agentType overrides structural type → always invisible", () => {
    const item = baseItem({
      type: "status",
      agentType: "trace",
      message: "debug observability",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("agent agentType on structural type does not promote to history", () => {
    const item = baseItem({
      type: "status",
      agentType: "primary",
      message: "Working…",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });
});

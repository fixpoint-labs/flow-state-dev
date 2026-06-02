/**
 * Tests for `resolveItemVisibility()` — the pure function that derives
 * `{ client, history }` from `(item.type, item.itemVisibility)`.
 *
 * Rules:
 * - Trace types (`block_trace`, `router_decision`, `state_snapshot`) always
 *   resolve to `{ client: false, history: false }` regardless of any stamp.
 * - Conversational types (`message`, `reasoning`, `tool_output`) use
 *   `item.itemVisibility` if present, else `{ client: true, history: true }`.
 * - Structural types (everything else: `status`, `error`, `component`,
 *   `container`, `resource_change`) default to `{ client: true, history: false }`.
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
  it("message with no itemVisibility → default client + history", () => {
    expect(resolveItemVisibility(baseItem())).toEqual({
      client: true,
      history: true,
    });
  });

  it("message with explicit itemVisibility { client: true, history: true }", () => {
    expect(
      resolveItemVisibility(
        baseItem({ itemVisibility: { client: true, history: true } })
      )
    ).toEqual({ client: true, history: true });
  });

  it("message with itemVisibility { client: true, history: false }", () => {
    expect(
      resolveItemVisibility(
        baseItem({ itemVisibility: { client: true, history: false } })
      )
    ).toEqual({ client: true, history: false });
  });

  it("message with itemVisibility { client: false, history: false }", () => {
    expect(
      resolveItemVisibility(
        baseItem({ itemVisibility: { client: false, history: false } })
      )
    ).toEqual({ client: false, history: false });
  });

  it("reasoning with no itemVisibility → default client + history", () => {
    const item = baseItem({
      type: "reasoning",
      summary: [{ type: "reasoning_text", text: "thinking" }],
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: true });
  });

  it("reasoning with explicit itemVisibility { client: true, history: false }", () => {
    const item = baseItem({
      type: "reasoning",
      itemVisibility: { client: true, history: false },
      summary: [{ type: "reasoning_text", text: "thinking" }],
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  it("tool_output with no itemVisibility → default client + history", () => {
    const item = baseItem({
      type: "tool_output",
      blockName: "search",
      output: {},
      toolCall: { callId: "c1", name: "search", arguments: "{}", generatorBlock: "gen" },
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: true });
  });

  it("tool_output with itemVisibility { client: true, history: false }", () => {
    const item = baseItem({
      type: "tool_output",
      itemVisibility: { client: true, history: false },
      blockName: "search",
      output: {},
      toolCall: { callId: "c1", name: "search", arguments: "{}", generatorBlock: "gen" },
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });
});

describe("resolveItemVisibility — trace types (always invisible)", () => {
  it("block_trace → neither client nor history", () => {
    const item = baseItem({
      type: "block_trace",
      blockName: "b",
      output: {},
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("block_trace with explicit itemVisibility is still invisible (type wins)", () => {
    const item = baseItem({
      type: "block_trace",
      itemVisibility: { client: true, history: true },
      blockName: "b",
      output: {},
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("router_decision → neither client nor history", () => {
    const item = baseItem({
      type: "router_decision",
      routerName: "r",
      selectedRoute: "a",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
  });

  it("state_snapshot → neither client nor history", () => {
    const item = baseItem({
      type: "state_snapshot",
      stepName: "s",
      stepIndex: 0,
      state: {},
      version: 0,
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: false, history: false });
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

  it("container → client, not history", () => {
    const item = baseItem({
      type: "container",
      component: "plan",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  it("resource_change → client, not history", () => {
    const item = baseItem({
      type: "resource_change",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });

  it("structural type ignores itemVisibility stamp — always structural default", () => {
    const item = baseItem({
      type: "status",
      itemVisibility: { client: true, history: true },
      message: "Working…",
    } as unknown as Partial<OutputItem>);
    expect(resolveItemVisibility(item)).toEqual({ client: true, history: false });
  });
});

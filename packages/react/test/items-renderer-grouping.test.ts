/**
 * buildItemRenderStream + ItemsRenderer filter/grouping tests.
 *
 * Regression guard for FIX-384: the grouping path must run AFTER dedup,
 * sub-agent filter, and container-owned suppression — otherwise supervisor /
 * blackboard streams leak sub-agent items and raw JSON for container-owned
 * components into the main conversation.
 */

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type {
  ToolOutputItem,
  ComponentItem,
  ContainerItem,
  MessageItem,
  OutputItem
} from "@flow-state-dev/core/items";
import { buildItemRenderStream, type RendererRegistry } from "../src";

function toolItem(id: string, toolName: string, overrides: Partial<ToolOutputItem> = {}): ToolOutputItem {
  return {
    id,
    type: "tool_output",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
    blockName: "gen",
    output: null,
    toolCall: { callId: `c-${id}`, name: toolName, arguments: "{}", generatorBlock: "gen" },
    ...overrides,
  };
}

function messageItem(id: string, overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    id,
    type: "message",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
    role: "assistant",
    content: [{ type: "output_text", text: "hi" }],
    ...overrides,
  };
}

function componentItem(id: string, component: string, overrides: Partial<ComponentItem> = {}): ComponentItem {
  return {
    id,
    type: "component",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
    component,
    data: {},
    ...overrides,
  };
}

function containerItem(id: string, blockInstanceId: string, component: string): ContainerItem {
  return {
    id,
    type: "container",
    status: "in_progress",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "container", blockInstanceId, phase: "main" },
    component,
  };
}

describe("buildItemRenderStream — tool grouping", () => {
  it("collapses consecutive block_tool_output items into one group segment", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      toolItem("t2", "web_search"),
      toolItem("t3", "write_file"),
    ];
    const stream = buildItemRenderStream(items, undefined, { groupToolCalls: true });
    expect(stream).toHaveLength(1);
    expect(stream[0].kind).toBe("group");
    if (stream[0].kind === "group") {
      expect(stream[0].items.map((i) => i.id)).toEqual(["t1", "t2", "t3"]);
    }
  });

  it("splits groups around non-tool items", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      messageItem("m1"),
      toolItem("t2", "write_file"),
    ];
    const stream = buildItemRenderStream(items, undefined, { groupToolCalls: true });
    expect(stream.map((s) => s.kind)).toEqual(["group", "item", "group"]);
  });

  it("wraps singletons in the group segment for visual consistency", () => {
    const stream = buildItemRenderStream([toolItem("t1", "web_search")], undefined, {
      groupToolCalls: true,
    });
    expect(stream).toHaveLength(1);
    expect(stream[0].kind).toBe("group");
  });

  it("returns per-item segments when groupToolCalls is false", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      toolItem("t2", "web_search"),
    ];
    const stream = buildItemRenderStream(items, undefined);
    expect(stream).toHaveLength(2);
    expect(stream.every((s) => s.kind === "item")).toBe(true);
  });
});

describe("buildItemRenderStream — filters apply before grouping (regression for FIX-384)", () => {
  it("drops sub-agent tool items before they reach the group", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      toolItem("t2", "web_search", { agentType: "sub" }), // must not reach the group
      toolItem("t3", "web_search"),
    ];
    const stream = buildItemRenderStream(items, undefined, { groupToolCalls: true });
    expect(stream).toHaveLength(1);
    if (stream[0].kind === "group") {
      expect(stream[0].items.map((i) => i.id)).toEqual(["t1", "t3"]);
    }
  });

  it("drops sub-agent non-tool items entirely so tools coalesce", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      messageItem("m1", { agentType: "sub" }),
      toolItem("t2", "web_search"),
    ];
    const stream = buildItemRenderStream(items, undefined, { groupToolCalls: true });
    // sub-agent message filtered → both tools are now consecutive → one group
    expect(stream).toHaveLength(1);
    if (stream[0].kind === "group") {
      expect(stream[0].items.map((i) => i.id)).toEqual(["t1", "t2"]);
    }
  });

  it("suppresses container-owned tool items when the container has a registered renderer", () => {
    const containerBlockId = "plan-block-1";
    const items: OutputItem[] = [
      containerItem("c1", containerBlockId, "plan"),
      // Owned by a registered container → must be hidden from the main stream.
      toolItem("t1", "web_search", { ownedBy: containerBlockId }),
      // Not owned → flows through.
      toolItem("t2", "web_search"),
    ];
    const renderers: RendererRegistry = {
      container: { plan: () => createElement("div") },
    };
    const stream = buildItemRenderStream(items, renderers, { groupToolCalls: true });
    const toolSegment = stream.find((s) => s.kind === "group");
    expect(toolSegment).toBeDefined();
    if (toolSegment?.kind === "group") {
      expect(toolSegment.items.map((i) => i.id)).toEqual(["t2"]);
    }
  });

  it("suppresses container-owned component items so raw JSON doesn't leak into the stream", () => {
    const containerBlockId = "plan-block-1";
    const items: OutputItem[] = [
      containerItem("c1", containerBlockId, "plan"),
      componentItem("pt1", "plan-task", { ownedBy: containerBlockId }),
      messageItem("m1"),
    ];
    const renderers: RendererRegistry = {
      container: { plan: () => createElement("div") },
    };
    const stream = buildItemRenderStream(items, renderers);
    // container + message. The owned plan-task is suppressed.
    const types = stream
      .filter((s) => s.kind === "item")
      .map((s) => (s.kind === "item" ? s.item.type : ""));
    expect(types).toEqual(["container", "message"]);
  });

  it("lets non-managed item types (messages, reasoning) through even when container-owned", () => {
    const containerBlockId = "plan-block-1";
    const items: OutputItem[] = [
      containerItem("c1", containerBlockId, "plan"),
      messageItem("m1", { ownedBy: containerBlockId }), // message is NOT container-managed
    ];
    const renderers: RendererRegistry = {
      container: { plan: () => createElement("div") },
    };
    const stream = buildItemRenderStream(items, renderers);
    expect(stream).toHaveLength(2);
  });

  it("deduplicates keyed component items before rendering", () => {
    const items: OutputItem[] = [
      componentItem("c1", "plan-view", { key: "plan", data: { v: 1 } }),
      componentItem("c2", "plan-view", { key: "plan", data: { v: 2 } }),
    ];
    const stream = buildItemRenderStream(items, undefined);
    expect(stream).toHaveLength(1);
    if (stream[0].kind === "item") {
      expect(stream[0].item.id).toBe("c2");
    }
  });

  it("respects showSubAgents: true — sub-agent items flow through", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search", { agentType: "sub" }),
      toolItem("t2", "web_search"),
    ];
    const stream = buildItemRenderStream(items, undefined, {
      showSubAgents: true,
      groupToolCalls: true,
    });
    expect(stream).toHaveLength(1);
    if (stream[0].kind === "group") {
      expect(stream[0].items.map((i) => i.id)).toEqual(["t1", "t2"]);
    }
  });
});

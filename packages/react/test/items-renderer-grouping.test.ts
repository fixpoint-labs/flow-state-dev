/**
 * conversationLines + ItemsRenderer filter/grouping tests.
 *
 * Regression guard for FIX-384: the grouping into steps must run AFTER dedup,
 * sub-agent filter, and container-owned suppression — otherwise supervisor /
 * blackboard streams leak sub-agent items and container-owned data items
 * into the main conversation.
 */

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type {
  ToolOutputItem,
  ContainerItem,
  DataItem,
  MessageItem,
  OutputItem,
  ReasoningItem
} from "@flow-state-dev/core/items";
import { conversationLines, ItemsRenderer, type ItemLine, type RendererRegistry } from "../src";

vi.mock("../src/context/FlowContext", () => ({ useFlowContext: () => ({ renderers: {} }) }));

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

function reasoningItem(id: string, overrides: Partial<ReasoningItem> = {}): ReasoningItem {
  return {
    id,
    type: "reasoning",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
    summary: [{ type: "reasoning_text", text: "hm" }],
    ...overrides,
  };
}

function dataItem(id: string, dataType: string, overrides: Partial<DataItem> = {}): DataItem {
  return {
    id,
    type: "data",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
    dataType,
    value: {},
    ...overrides,
  };
}

function containerItem(id: string, blockInstanceId: string, component: string): ContainerItem {
  return {
    id,
    type: "container",
    blockName: "container",
    status: "in_progress",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "container", blockInstanceId, phase: "main" },
    component,
  };
}

/** Each line's kind, and a steps line's items: what the screen draws, in order. */
const shape = (lines: ItemLine[]) => lines.map((l) => (l.kind === "steps" ? `steps:${l.items.map((i) => i.id).join(",")}` : `${l.kind}:${l.id}`));

describe("conversationLines — steps", () => {
  it("collapses consecutive tool calls into one steps line", () => {
    const items: OutputItem[] = [toolItem("t1", "web_search"), toolItem("t2", "web_search"), toolItem("t3", "write_file")];
    expect(shape(conversationLines(items))).toEqual(["steps:t1,t2,t3"]);
  });

  it("splits steps around what the agent says", () => {
    const items: OutputItem[] = [toolItem("t1", "web_search"), messageItem("m1"), toolItem("t2", "write_file")];
    expect(shape(conversationLines(items))).toEqual(["steps:t1", "assistant:m1", "steps:t2"]);
  });

  it("makes a single call a steps line too, for visual consistency", () => {
    expect(shape(conversationLines([toolItem("t1", "web_search")]))).toEqual(["steps:t1"]);
  });
});

// An agent's working (what it thought, what it called) is one stretch of
// activity between the things it says. Reasoning is part of that stretch, so a
// thought between two calls doesn't split the line in two.
describe("conversationLines — thinking joins the steps", () => {
  it("keeps reasoning and tool calls between messages in one steps line, in order", () => {
    const items: OutputItem[] = [reasoningItem("r1"), toolItem("t1", "shell"), reasoningItem("r2"), toolItem("t2", "read"), messageItem("m1")];
    expect(shape(conversationLines(items))).toEqual(["steps:r1,t1,r2,t2", "assistant:m1"]);
  });

  it("splits activity around what the agent says", () => {
    const items: OutputItem[] = [reasoningItem("r1"), messageItem("m1"), toolItem("t1", "shell"), reasoningItem("r2"), messageItem("m2")];
    expect(shape(conversationLines(items))).toEqual(["steps:r1", "assistant:m1", "steps:t1,r2", "assistant:m2"]);
  });

  it("groups thinking that has no tool call with it, so it doesn't stand alone", () => {
    expect(shape(conversationLines([reasoningItem("r1"), reasoningItem("r2")]))).toEqual(["steps:r1,r2"]);
  });

  it("still hides reasoning the history excludes, before grouping", () => {
    const hidden = reasoningItem("r1", { itemVisibility: { client: true, history: false } });
    expect(shape(conversationLines([hidden, toolItem("t1", "shell")]))).toEqual(["steps:t1"]);
  });
});

describe("conversationLines — filters apply before grouping (regression for FIX-384)", () => {
  it("drops sub-agent tool items before they reach the steps", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      toolItem("t2", "web_search", { itemVisibility: { client: true, history: false } }), // must not reach the steps
      toolItem("t3", "web_search"),
    ];
    expect(shape(conversationLines(items))).toEqual(["steps:t1,t3"]);
  });

  it("drops sub-agent non-tool items entirely so tools coalesce", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      messageItem("m1", { itemVisibility: { client: true, history: false } }),
      toolItem("t2", "web_search"),
    ];
    // sub-agent message filtered → both tools are now consecutive → one steps line
    expect(shape(conversationLines(items))).toEqual(["steps:t1,t2"]);
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
    const renderers: RendererRegistry = { container: { plan: () => createElement("div") } };
    expect(shape(conversationLines(items, [], { renderers }))).toEqual(["item:c1", "steps:t2"]);
  });

  it("suppresses container-owned data items so the container alone draws them", () => {
    const containerBlockId = "plan-block-1";
    const items: OutputItem[] = [
      containerItem("c1", containerBlockId, "plan"),
      dataItem("pt1", "plan-task", { ownedBy: containerBlockId }),
      messageItem("m1"),
    ];
    const renderers: RendererRegistry = { container: { plan: () => createElement("div") } };
    // container + message. The owned plan-task is suppressed.
    expect(shape(conversationLines(items, [], { renderers }))).toEqual(["item:c1", "assistant:m1"]);
  });

  it("lets non-managed item types (messages, reasoning) through even when container-owned", () => {
    const containerBlockId = "plan-block-1";
    const items: OutputItem[] = [
      containerItem("c1", containerBlockId, "plan"),
      messageItem("m1", { ownedBy: containerBlockId }), // message is NOT container-managed
    ];
    const renderers: RendererRegistry = { container: { plan: () => createElement("div") } };
    expect(conversationLines(items, [], { renderers })).toHaveLength(2);
  });

  it("deduplicates keyed data items before rendering", () => {
    const items: OutputItem[] = [
      dataItem("c1", "plan-view", { key: "plan", value: { v: 1 } }),
      dataItem("c2", "plan-view", { key: "plan", value: { v: 2 } }),
    ];
    expect(shape(conversationLines(items))).toEqual(["data:c2"]);
  });

  it("respects showSubAgents: true — sub-agent items flow through", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search", { itemVisibility: { client: true, history: false } }),
      toolItem("t2", "web_search"),
    ];
    expect(shape(conversationLines(items, [], { showSubAgents: true }))).toEqual(["steps:t1,t2"]);
  });
});

describe("ItemsRenderer live", () => {
  const groupProps = (live: boolean | undefined) => {
    const items = [toolItem("a", "read"), messageItem("m"), toolItem("b", "grep")];
    const nodes = ItemsRenderer({ items, toolGroupRenderer: () => null, live }) as any[];
    // Each group is a Fragment wrapping the renderer element.
    return nodes.filter((n) => n.props?.children?.props?.items).map((n) => n.props.children.props.live);
  };

  // A message ends one stretch of work; only the stretch still open at the end
  // of a live stream is the one the agent is working in.
  it("tells only the trailing group the stream is live", () => {
    expect(groupProps(true)).toEqual([false, true]);
  });

  it("tells no group it is live when the stream is over", () => {
    expect(groupProps(false)).toEqual([false, false]);
    expect(groupProps(undefined)).toEqual([false, false]);
  });

  // A data item no renderer draws makes no line, so it can't take the trailing
  // place from the steps the agent is still working in.
  it("keeps the trailing group live past a data item nothing draws", () => {
    const items = [toolItem("a", "read"), messageItem("m"), toolItem("b", "grep"), dataItem("d", "progress")];
    const nodes = ItemsRenderer({ items, toolGroupRenderer: () => null, live: true }) as any[];
    expect(nodes.filter((n) => n.props?.children?.props?.items).map((n) => n.props.children.props.live)).toEqual([false, true]);
  });
});

// FIX-2848: ItemsRenderer draws the model's lines, and hands each registered renderer its line.
describe("ItemsRenderer lines", () => {
  const failure = { ...messageItem("e1"), type: "error", message: "boom" } as unknown as OutputItem;

  it("hands a failed line's renderer the line, so Retry shows from the model's retryable", () => {
    const lines = conversationLines([failure], [{ id: "req", status: "failed", retryable: true }]);
    const [node] = ItemsRenderer({ lines }) as any[];
    expect(node.props.line).toMatchObject({ kind: "failed", retryable: true });
  });

  it("draws a stopped turn's line, a plain one when the registry has none", () => {
    const lines = conversationLines([messageItem("u1", { role: "user" })], [{ id: "req", status: "aborted" }]);
    const nodes = ItemsRenderer({ lines }) as any[];
    expect(nodes).toHaveLength(2);
    expect(nodes[1].props.children.props["data-line"]).toBe("stopped");
  });

  // A steps renderer reads what the model decided of its line too: a call still marked running in a turn that ended never finished.
  it("hands the steps renderer its line, ended once its turn is over", () => {
    const lines = conversationLines([toolItem("t1", "read", { status: "in_progress" })], [{ id: "req", status: "failed" }]);
    const [node] = ItemsRenderer({ lines, toolGroupRenderer: () => null }) as any[];
    expect(node.props.children.props.line).toMatchObject({ kind: "steps", ended: true });
  });
});

import { describe, it, expect } from "vitest";
import { buildTraceTree, type TraceNode } from "@/lib/trace-tree";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestGroup } from "@/components/workspace/stream-view";

// ── Fixtures ──────────────────────────────────────────────────

function makeProvenance(
  blockName: string,
  blockInstanceId: string,
  parentBlockInstanceId?: string,
) {
  return {
    blockName,
    blockInstanceId,
    parentBlockInstanceId,
    phase: "main" as const,
  };
}

function makeItem(
  overrides: Partial<OutputItem> & { id: string; type: string },
): OutputItem {
  return {
    status: "completed",
    requestId: "req-1",
    itemIndex: 0,
    ts: Date.now(),
    provenance: makeProvenance("testBlock", "inst-1"),
    ...overrides,
  } as OutputItem;
}

function makeGroup(overrides: Partial<RequestGroup> = {}): RequestGroup {
  return {
    requestId: "req-1",
    action: "sendMessage",
    status: "completed",
    startedAt: Date.now(),
    items: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("buildTraceTree", () => {
  it("returns empty array for no request groups", () => {
    expect(buildTraceTree([])).toEqual([]);
  });

  it("creates a request node for each group", () => {
    const groups = [
      makeGroup({ requestId: "r1", action: "hello" }),
      makeGroup({ requestId: "r2", action: "world" }),
    ];

    const tree = buildTraceTree(groups);

    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe("request");
    expect(tree[0].requestId).toBe("r1");
    expect(tree[0].action).toBe("hello");
    expect(tree[1].requestId).toBe("r2");
  });

  it("groups items under their block by blockInstanceId", () => {
    const items = [
      makeItem({ id: "i1", type: "message", provenance: makeProvenance("chatBlock", "block-A") }),
      makeItem({ id: "i2", type: "status", provenance: makeProvenance("chatBlock", "block-A") }),
      makeItem({ id: "i3", type: "message", provenance: makeProvenance("otherBlock", "block-B") }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const requestNode = tree[0];

    expect(requestNode.children).toHaveLength(2); // two block nodes
    const blockA = requestNode.children.find((n) => n.blockName === "chatBlock");
    const blockB = requestNode.children.find((n) => n.blockName === "otherBlock");

    expect(blockA).toBeDefined();
    expect(blockA!.children).toHaveLength(2);
    expect(blockB).toBeDefined();
    expect(blockB!.children).toHaveLength(1);
  });

  it("treats items without provenance as orphans at root level", () => {
    const orphanItem = {
      id: "orphan-1",
      type: "status",
      status: "completed",
      requestId: "req-1",
      itemIndex: 0,
      ts: Date.now(),
      provenance: undefined,
      message: "test",
    } as unknown as OutputItem;

    const tree = buildTraceTree([makeGroup({ items: [orphanItem] })]);
    const requestNode = tree[0];

    expect(requestNode.children).toHaveLength(1);
    expect(requestNode.children[0].type).toBe("item");
    expect(requestNode.children[0].id).toBe("orphan-1");
  });

  it("nests child blocks inside parent blocks", () => {
    const items = [
      makeItem({
        id: "i1",
        type: "message",
        provenance: makeProvenance("parent", "parent-inst"),
      }),
      makeItem({
        id: "i2",
        type: "message",
        provenance: makeProvenance("child", "child-inst", "parent-inst"),
      }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const requestNode = tree[0];

    // Only the parent block should be at root level
    const rootBlocks = requestNode.children.filter((n) => n.type === "block");
    expect(rootBlocks).toHaveLength(1);
    expect(rootBlocks[0].blockName).toBe("parent");

    // Child block should be nested inside parent
    const childBlock = rootBlocks[0].children.find((n) => n.type === "block");
    expect(childBlock).toBeDefined();
    expect(childBlock!.blockName).toBe("child");
  });

  it("nests multiple child blocks inside a router parent", () => {
    const items = [
      // Router parent with a routing decision item
      makeItem({
        id: "i1",
        type: "router_decision",
        provenance: makeProvenance("thinking-style-router", "rtr-inst"),
      }),
      // First child: generator nested under router
      makeItem({
        id: "i2",
        type: "message",
        provenance: makeProvenance("assistant-generator", "gen-inst-1", "rtr-inst"),
      }),
      // Second child: another generator nested under router
      makeItem({
        id: "i3",
        type: "message",
        provenance: makeProvenance("pae-thinking-executor", "gen-inst-2", "rtr-inst"),
      }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const requestNode = tree[0];

    // Only the router should be at root level
    const rootBlocks = requestNode.children.filter((n) => n.type === "block");
    expect(rootBlocks).toHaveLength(1);
    expect(rootBlocks[0].blockName).toBe("thinking-style-router");

    // Both child blocks should be nested inside router
    const childBlocks = rootBlocks[0].children.filter((n) => n.type === "block");
    expect(childBlocks).toHaveLength(2);
    const childNames = childBlocks.map((n) => n.blockName).sort();
    expect(childNames).toEqual(["assistant-generator", "pae-thinking-executor"]);
  });

  it("nests child blocks even when trace item appears before regular items", () => {
    // Simulates the scenario where a block_output trace item (from
    // emitNestedBlockTrace) is the first item for a child block. The
    // parentBlockInstanceId must still be resolved from subsequent items.
    const items = [
      // Parent router
      makeItem({
        id: "i1",
        type: "router_decision",
        provenance: makeProvenance("router", "rtr-inst"),
      }),
      // Child trace item appears first — has correct parentBlockInstanceId
      makeItem({
        id: "i2",
        type: "block_output",
        provenance: makeProvenance("child-gen", "gen-inst", "rtr-inst"),
        trace: true,
        blockKind: "generator",
      } as Partial<OutputItem> & { id: string; type: string }),
      // Child's regular item
      makeItem({
        id: "i3",
        type: "message",
        provenance: makeProvenance("child-gen", "gen-inst", "rtr-inst"),
      }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const requestNode = tree[0];

    const rootBlocks = requestNode.children.filter((n) => n.type === "block");
    expect(rootBlocks).toHaveLength(1);
    expect(rootBlocks[0].blockName).toBe("router");

    const childBlocks = rootBlocks[0].children.filter((n) => n.type === "block");
    expect(childBlocks).toHaveLength(1);
    expect(childBlocks[0].blockName).toBe("child-gen");
  });

  it("marks the last request group as expanded", () => {
    const groups = [
      makeGroup({ requestId: "r1" }),
      makeGroup({ requestId: "r2" }),
      makeGroup({ requestId: "r3" }),
    ];

    const tree = buildTraceTree(groups);

    expect(tree[0].isExpanded).toBe(false);
    expect(tree[1].isExpanded).toBe(false);
    expect(tree[2].isExpanded).toBe(true);
  });

  it("marks block_output items with toolCall as generator kind", () => {
    const items = [
      makeItem({
        id: "i1",
        type: "block_output",
        blockName: "gen",
        provenance: makeProvenance("gen", "gen-inst"),
        output: "hello",
        toolCall: { callId: "tc-1", arguments: "{}", generatorBlock: "gen" },
      } as Partial<OutputItem> & { id: string; type: string }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const blockNode = tree[0].children[0];

    expect(blockNode.blockKind).toBe("generator");
  });

  it("sets block status to failed when an error item is present", () => {
    const items = [
      makeItem({
        id: "i1",
        type: "error",
        provenance: makeProvenance("failBlock", "fail-inst"),
        message: "boom",
      } as Partial<OutputItem> & { id: string; type: string }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const blockNode = tree[0].children[0];

    expect(blockNode.blockStatus).toBe("failed");
  });

  it("computes block duration from item timestamps", () => {
    const items = [
      makeItem({
        id: "i1",
        type: "status",
        ts: 1000,
        provenance: makeProvenance("timed", "timed-inst"),
        message: "start",
      } as Partial<OutputItem> & { id: string; type: string }),
      makeItem({
        id: "i2",
        type: "status",
        ts: 3500,
        provenance: makeProvenance("timed", "timed-inst"),
        message: "end",
      } as Partial<OutputItem> & { id: string; type: string }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const blockNode = tree[0].children[0];

    expect(blockNode.blockDuration).toBe(2500);
  });
});

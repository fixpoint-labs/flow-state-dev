import { describe, it, expect } from "vitest";
import { buildTraceTree, type TraceNode } from "../src/react/lib/trace-tree";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { RequestGroup } from "../src/react/components/workspace/stream-view";

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
      makeItem({ id: "i2", type: "status", message: "working", provenance: makeProvenance("chatBlock", "block-A") } as Partial<OutputItem> & { id: string; type: string }),
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
        type: "block_trace",
        provenance: makeProvenance("child-gen", "gen-inst", "rtr-inst"),
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
        type: "block_trace",
        blockName: "gen",
        provenance: makeProvenance("gen", "gen-inst"),
        // FIX-413: BlockTraceItem.output is now a BlockValue<T> union.
        output: { kind: "inline", value: "hello" },
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

  it("collapses keyed state_snapshot items to the latest frame per sequencer", () => {
    // FIX-401: snapshots emitted with `key === blockInstanceId` are
    // in-place updates of the same logical sequencer, not separate rows.
    // The trace tree retains the latest frame per key so the panel renders
    // the current state of each sequencer.
    const items = [
      makeItem({
        id: "snap-init",
        type: "state_snapshot",
        transient: true,
        provenance: makeProvenance("research", "seq-inst"),
        key: "seq-inst",
        stepName: "__initial__",
        stepIndex: -1,
        state: { progress: 0, phase: "planning" },
        version: 0,
        durable: true,
      } as Partial<OutputItem> & { id: string; type: string }),
      makeItem({
        id: "msg-1",
        type: "message",
        provenance: makeProvenance("research", "seq-inst"),
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
      } as Partial<OutputItem> & { id: string; type: string }),
      makeItem({
        id: "snap-step0",
        type: "state_snapshot",
        transient: true,
        ts: 2000,
        provenance: makeProvenance("research", "seq-inst"),
        key: "seq-inst",
        stepName: "analyze",
        stepIndex: 0,
        state: { progress: 50, phase: "analyzing" },
        version: 1,
        durable: true,
      } as Partial<OutputItem> & { id: string; type: string }),
      makeItem({
        id: "snap-step1",
        type: "state_snapshot",
        transient: true,
        ts: 3000,
        provenance: makeProvenance("research", "seq-inst"),
        key: "seq-inst",
        stepName: "summarize",
        stepIndex: 1,
        state: { progress: 100, phase: "done" },
        version: 2,
        durable: true,
      } as Partial<OutputItem> & { id: string; type: string }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const blockNode = tree[0].children[0];

    expect(blockNode.blockName).toBe("research");
    expect(blockNode.stateSnapshots).toBeDefined();
    expect(blockNode.stateSnapshots).toHaveLength(1);
    expect(blockNode.stateSnapshots![0].stepName).toBe("summarize");
    expect(blockNode.stateSnapshots![0].state).toEqual({ progress: 100, phase: "done" });
    expect(blockNode.stateSnapshots![0].version).toBe(2);

    // Snapshots should not appear as visible item children.
    const itemChildren = blockNode.children.filter((c) => c.type === "item");
    expect(itemChildren).toHaveLength(1);
    expect(itemChildren[0].item!.type).toBe("message");
  });


  it("captures phase from provenance onto the block node", () => {
    // Blocks dispatched via `.work()` / `.workIf()` / `.forEachBackground()`
    // (and any descendants) carry `phase: "work"` in their provenance. The
    // trace tree surfaces this on the block node so the trace view can
    // render a sidechain badge.
    const items = [
      makeItem({
        id: "i1",
        type: "message",
        provenance: {
          blockName: "main-block",
          blockInstanceId: "main-inst",
          phase: "main",
        },
      }),
      makeItem({
        id: "i2",
        type: "message",
        provenance: {
          blockName: "bg-block",
          blockInstanceId: "bg-inst",
          phase: "work",
        },
      }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const requestNode = tree[0];
    const mainBlock = requestNode.children.find((n) => n.blockName === "main-block");
    const bgBlock = requestNode.children.find((n) => n.blockName === "bg-block");

    expect(mainBlock?.phase).toBe("main");
    expect(bgBlock?.phase).toBe("work");
  });

  it("handles nested sequencer state snapshots independently", () => {
    const items = [
      makeItem({
        id: "parent-snap",
        type: "state_snapshot",
        provenance: makeProvenance("outer", "outer-inst"),
        sequencerName: "outer",
        sequencerInstanceId: "outer-inst",
        stepName: "__initial__",
        stepIndex: -1,
        state: { count: 0 },
        version: 0,
      } as Partial<OutputItem> & { id: string; type: string }),
      makeItem({
        id: "child-snap",
        type: "state_snapshot",
        provenance: makeProvenance("inner", "inner-inst", "outer-inst"),
        sequencerName: "inner",
        sequencerInstanceId: "inner-inst",
        stepName: "__initial__",
        stepIndex: -1,
        state: { value: "hello" },
        version: 0,
      } as Partial<OutputItem> & { id: string; type: string }),
    ];

    const tree = buildTraceTree([makeGroup({ items })]);
    const outerBlock = tree[0].children.find((n) => n.blockName === "outer");
    const innerBlock = outerBlock?.children.find((n) => n.blockName === "inner");

    expect(outerBlock?.stateSnapshots).toHaveLength(1);
    expect(outerBlock?.stateSnapshots![0].state).toEqual({ count: 0 });
    expect(innerBlock?.stateSnapshots).toHaveLength(1);
    expect(innerBlock?.stateSnapshots![0].state).toEqual({ value: "hello" });
  });
});

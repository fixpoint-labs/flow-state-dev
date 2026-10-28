/**
 * Tests for `resolveBlockValue` ref-target broadening (FIX-480 §3.2).
 *
 * The resolver now accepts refs targeting `MessageItem` ids in addition
 * to `BlockTraceItem` ids — joins the message's `output_text` content
 * and returns it as the resolved value. Existing `block_output` ref
 * resolution is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { BlockTraceItem, MessageItem, OutputItem, ToolOutputItem } from "../../src/items";
import { buildItemLookup } from "../../src/items";
// A `ref` is executor-written, so this calls the internal resolver.
import { resolveBlockValueInternal } from "../../src/items/internal";

const baseProvenance = {
  blockName: "x",
  blockInstanceId: "x#1",
  phase: "main" as const,
};

function makeMessage(id: string, text: string): MessageItem {
  return {
    id,
    type: "message",
    role: "assistant",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    provenance: baseProvenance,
    ts: 0,
    content: [{ type: "output_text", text }],
  };
}

function makeBlockOutput(
  id: string,
  output: BlockTraceItem["output"],
): BlockTraceItem {
  return {
    id,
    type: "block_trace",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    provenance: baseProvenance,
    ts: 0,
    blockName: "b",
    blockKind: "handler",
    blockInstanceId: "b_inst",
    output,
  };
}

describe("resolveBlockValue (FIX-480 ref-to-message)", () => {
  it("resolves a ref pointing at a message to the joined output_text", () => {
    const msg = makeMessage("item_msg_1", "hello world");
    const items: OutputItem[] = [msg];
    const lookup = buildItemLookup(items);
    const out = resolveBlockValueInternal<string>(
      { kind: "ref", sourceItemId: "item_msg_1" },
      lookup,
    );
    expect(out).toBe("hello world");
  });

  it("concatenates multiple output_text blocks", () => {
    const msg: MessageItem = {
      ...makeMessage("item_msg_2", ""),
      content: [
        { type: "output_text", text: "foo" },
        { type: "output_text", text: " bar" },
      ],
    };
    const lookup = buildItemLookup([msg]);
    const out = resolveBlockValueInternal<string>(
      { kind: "ref", sourceItemId: "item_msg_2" },
      lookup,
    );
    expect(out).toBe("foo bar");
  });

  it("preserves backward compat: refs pointing at block_output still resolve through their inner value", () => {
    const inner = makeBlockOutput("item_block_output_inner", {
      kind: "inline",
      value: { y: 42 },
    });
    const items = [inner];
    const lookup = buildItemLookup(items);
    const out = resolveBlockValueInternal<{ y: number }>(
      { kind: "ref", sourceItemId: "item_block_output_inner" },
      lookup,
    );
    expect(out).toEqual({ y: 42 });
  });

  it("returns undefined when the ref target is missing", () => {
    const lookup = buildItemLookup([]);
    const out = resolveBlockValueInternal<string>(
      { kind: "ref", sourceItemId: "missing" },
      lookup,
    );
    expect(out).toBeUndefined();
  });

  it("returns undefined for a ref pointing at an unsupported item type", () => {
    // An item whose type is neither block_output nor message — e.g. a
    // status item. The resolver returns undefined rather than throwing.
    const status: OutputItem = {
      id: "item_status_1",
      type: "status",
      status: "completed",
      requestId: "req",
      itemIndex: 0,
      provenance: baseProvenance,
      ts: 0,
      message: "x",
    };
    const lookup = buildItemLookup([status]);
    const out = resolveBlockValueInternal(
      { kind: "ref", sourceItemId: "item_status_1" },
      lookup,
    );
    expect(out).toBeUndefined();
  });

  it("resolves inline values without lookup interaction", () => {
    const out = resolveBlockValueInternal(
      { kind: "inline", value: { hello: "world" } },
      buildItemLookup([]),
    );
    expect(out).toEqual({ hello: "world" });
  });
});

describe("resolveBlockValue (ref to a tool result)", () => {
  function makeToolOutput(id: string, fields: Partial<ToolOutputItem>): ToolOutputItem {
    return {
      id,
      type: "tool_output",
      status: "completed",
      requestId: "req",
      itemIndex: 0,
      provenance: baseProvenance,
      ts: 0,
      blockName: "readFiles",
      output: undefined,
      toolCall: { callId: "c1", name: "readFiles", arguments: "{}" },
      ...fields,
    } as ToolOutputItem;
  }

  it("resolves a ref pointing at a tool_output to its recorded output", () => {
    const tool = makeToolOutput("item_tool_1", { output: { files: ["a.ts"] } });
    const out = resolveBlockValueInternal({ kind: "ref", sourceItemId: "item_tool_1" }, buildItemLookup([tool]));
    expect(out).toEqual({ files: ["a.ts"] });
  });

  it("resolves a ref through a block_trace that itself refs the tool_output", () => {
    const tool = makeToolOutput("item_tool_1", { output: 42 });
    const inner = makeBlockOutput("item_bo_inner", { kind: "ref", sourceItemId: "item_tool_1" } as BlockTraceItem["output"]);
    const out = resolveBlockValueInternal({ kind: "ref", sourceItemId: "item_bo_inner" }, buildItemLookup([tool, inner]));
    expect(out).toBe(42);
  });
});

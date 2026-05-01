/**
 * Tests for `resolveBlockValue` ref-target broadening (FIX-480 §3.2).
 *
 * The resolver now accepts refs targeting `MessageItem` ids in addition
 * to `BlockOutputItem` ids — joins the message's `output_text` content
 * and returns it as the resolved value. Existing `block_output` ref
 * resolution is unchanged.
 */
import { describe, expect, it } from "vitest";
import type { BlockOutputItem, MessageItem, OutputItem } from "../../src/items";
import {
  buildItemLookup,
  resolveBlockValue,
} from "../../src/items";

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
  output: BlockOutputItem["output"],
): BlockOutputItem {
  return {
    id,
    type: "block_output",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    provenance: baseProvenance,
    ts: 0,
    blockName: "b",
    output,
  };
}

describe("resolveBlockValue (FIX-480 ref-to-message)", () => {
  it("resolves a ref pointing at a message to the joined output_text", () => {
    const msg = makeMessage("item_msg_1", "hello world");
    const items: OutputItem[] = [msg];
    const lookup = buildItemLookup(items);
    const out = resolveBlockValue<string>(
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
    const out = resolveBlockValue<string>(
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
    const items: OutputItem[] = [inner];
    const lookup = buildItemLookup(items);
    const out = resolveBlockValue<{ y: number }>(
      { kind: "ref", sourceItemId: "item_block_output_inner" },
      lookup,
    );
    expect(out).toEqual({ y: 42 });
  });

  it("returns undefined when the ref target is missing", () => {
    const lookup = buildItemLookup([]);
    const out = resolveBlockValue<string>(
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
    const out = resolveBlockValue(
      { kind: "ref", sourceItemId: "item_status_1" },
      lookup,
    );
    expect(out).toBeUndefined();
  });

  it("resolves inline values without lookup interaction", () => {
    const out = resolveBlockValue(
      { kind: "inline", value: { hello: "world" } },
      buildItemLookup([]),
    );
    expect(out).toEqual({ hello: "world" });
  });
});

/**
 * Tests for the tool-call grouping helpers: label composition and consecutive
 * grouping. Pure functions — no DOM rendering required here.
 */

import { describe, it, expect } from "vitest";
import type { BlockToolOutputItem, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import {
  composeToolGroupLabel,
  groupConsecutiveToolCalls,
  TOOL_GROUP_DISTINCT_CAP,
} from "../registry/components/tool-grouping";

function toolItem(id: string, toolName: string): BlockToolOutputItem {
  return {
    id,
    type: "block_tool_output",
    status: "completed",
    requestId: "req",
    itemIndex: 0,
    ts: 0,
    provenance: { blockName: "gen", blockInstanceId: "b1", phase: "main" },
    blockName: "gen",
    output: null,
    toolCall: {
      callId: `c-${id}`,
      name: toolName,
      arguments: "{}",
      generatorBlock: "gen",
    },
  };
}

function messageItem(id: string): MessageItem {
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
  };
}

describe("composeToolGroupLabel", () => {
  it("returns an empty string for no calls", () => {
    expect(composeToolGroupLabel([])).toBe("");
  });

  it("uses the singular phrase for a single mapped call", () => {
    expect(composeToolGroupLabel(["web_search"])).toBe("Ran a search");
  });

  it("uses the plural phrase for multiple calls of one tool", () => {
    expect(composeToolGroupLabel(["web_search", "web_search", "web_search"])).toBe(
      "Ran 3 searches"
    );
  });

  it("merges tools that share a singular phrase", () => {
    // web_search and search both → "ran a search"
    expect(composeToolGroupLabel(["web_search", "search"])).toBe("Ran 2 searches");
  });

  it("composes two distinct clauses with 'and' and no Oxford comma", () => {
    expect(composeToolGroupLabel(["write_file", "web_search", "web_search"])).toBe(
      "Wrote a file and ran 2 searches"
    );
  });

  it("composes three distinct clauses with Oxford comma", () => {
    expect(
      composeToolGroupLabel(["write_file", "web_search", "web_search", "fetch"])
    ).toBe("Wrote a file, ran 2 searches, and fetched a page");
  });

  it("collapses to 'Ran N tools' above the distinct-clause cap", () => {
    const names = [
      "web_search",
      "write_file",
      "fetch",
      "bash",
      "read_file", // 5 distinct clauses > cap of 4
    ];
    expect(names.length).toBeGreaterThan(TOOL_GROUP_DISTINCT_CAP);
    expect(composeToolGroupLabel(names)).toBe(`Ran ${names.length} tools`);
  });

  it("falls back to a generic phrase for unknown tool names", () => {
    expect(composeToolGroupLabel(["my_custom_tool"])).toBe("Ran `my_custom_tool`");
  });

  it("pluralises unknown tools using the generic phrase", () => {
    expect(composeToolGroupLabel(["my_custom_tool", "my_custom_tool"])).toBe(
      "Ran `my_custom_tool` 2 times"
    );
  });

  it("capitalises only the first word", () => {
    const label = composeToolGroupLabel(["web_search", "write_file"]);
    expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
    expect(label).toBe("Ran a search and wrote a file");
  });
});

describe("groupConsecutiveToolCalls", () => {
  it("returns an empty array for no items", () => {
    expect(groupConsecutiveToolCalls([])).toEqual([]);
  });

  it("wraps a singleton tool call in a group segment", () => {
    const items: OutputItem[] = [toolItem("t1", "web_search")];
    const segments = groupConsecutiveToolCalls(items);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("group");
    if (segments[0].kind === "group") {
      expect(segments[0].items.map((i) => i.id)).toEqual(["t1"]);
    }
  });

  it("collapses consecutive tool calls into one group", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      toolItem("t2", "web_search"),
      toolItem("t3", "write_file"),
    ];
    const segments = groupConsecutiveToolCalls(items);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("group");
    if (segments[0].kind === "group") {
      expect(segments[0].items.map((i) => i.id)).toEqual(["t1", "t2", "t3"]);
    }
  });

  it("splits groups when a non-tool item is interleaved", () => {
    const items: OutputItem[] = [
      toolItem("t1", "web_search"),
      toolItem("t2", "web_search"),
      messageItem("m1"),
      toolItem("t3", "write_file"),
    ];
    const segments = groupConsecutiveToolCalls(items);
    expect(segments).toHaveLength(3);
    expect(segments[0].kind).toBe("group");
    expect(segments[1].kind).toBe("item");
    expect(segments[2].kind).toBe("group");
    if (segments[0].kind === "group") {
      expect(segments[0].items.map((i) => i.id)).toEqual(["t1", "t2"]);
    }
    if (segments[1].kind === "item") {
      expect(segments[1].item.id).toBe("m1");
    }
    if (segments[2].kind === "group") {
      expect(segments[2].items.map((i) => i.id)).toEqual(["t3"]);
    }
  });

  it("preserves non-tool items that straddle multiple groups", () => {
    const items: OutputItem[] = [
      messageItem("m1"),
      toolItem("t1", "web_search"),
      messageItem("m2"),
    ];
    const segments = groupConsecutiveToolCalls(items);
    expect(segments.map((s) => s.kind)).toEqual(["item", "group", "item"]);
  });
});

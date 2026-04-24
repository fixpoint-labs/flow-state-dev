import type { BlockToolOutputItem, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import {
  getToolGroupSummaryLabel,
} from "../components/flow-state/tool";
import {
  segmentToolGroups,
} from "../components/flow-state/request-group";

function toolItem(
  id: string,
  name: string,
  index: number,
  status: BlockToolOutputItem["status"] = "completed"
): BlockToolOutputItem {
  return {
    id,
    type: "block_tool_output",
    blockName: name,
    output: { ok: true },
    toolCall: {
      callId: `call-${id}`,
      name,
      arguments: "{}",
      generatorBlock: "assistant",
    },
    status,
    requestId: "req_1",
    itemIndex: index,
    provenance: { blockName: name, blockInstanceId: id, phase: "main" },
    ts: index,
  };
}

function messageItem(id: string, index: number): MessageItem {
  return {
    id,
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "Done" }],
    status: "completed",
    requestId: "req_1",
    itemIndex: index,
    provenance: { blockName: "assistant", blockInstanceId: id, phase: "main" },
    ts: index,
  };
}

describe("tool group rendering helpers", () => {
  it("groups consecutive tool output items and breaks on non-tool items", () => {
    const items: OutputItem[] = [
      toolItem("tool_1", "search", 1),
      toolItem("tool_2", "search", 2),
      messageItem("msg_1", 3),
      toolItem("tool_3", "write_file", 4),
    ];

    const segments = segmentToolGroups(items);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ type: "tool-group" });
    expect(segments[0].items.map((item) => item.id)).toEqual(["tool_1", "tool_2"]);
    expect(segments[1]).toMatchObject({ type: "items" });
    expect(segments[2]).toMatchObject({ type: "tool-group" });
    expect(segments[2].items.map((item) => item.id)).toEqual(["tool_3"]);
  });

  it("composes known tool names into natural summary labels", () => {
    const label = getToolGroupSummaryLabel([
      toolItem("tool_1", "write_file", 1),
      toolItem("tool_2", "search", 2),
      toolItem("tool_3", "search", 3),
      toolItem("tool_4", "fetch", 4),
    ]);

    expect(label).toBe("Wrote a file, ran 2 searches, and fetched a page");
  });

  it("falls back to generic labels for unknown or overly broad groups", () => {
    expect(getToolGroupSummaryLabel([toolItem("tool_1", "custom_tool", 1)])).toBe("Ran 1 tools");
    expect(
      getToolGroupSummaryLabel([
        toolItem("tool_1", "search", 1),
        toolItem("tool_2", "fetch", 2),
        toolItem("tool_3", "read_file", 3),
        toolItem("tool_4", "write_file", 4),
        toolItem("tool_5", "bash", 5),
      ])
    ).toBe("Ran 5 tools");
  });
});

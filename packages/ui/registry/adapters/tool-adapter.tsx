"use client";

import type { BlockOutputItem, BlockToolOutputItem } from "@flow-state-dev/core/items";
import type { ToolState } from "@/components/ai-elements/tool";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

type ToolItem = BlockOutputItem | BlockToolOutputItem;

function mapStatus(status: string): ToolState {
  switch (status) {
    case "in_progress": return "running";
    case "completed": return "completed";
    case "failed": return "error";
    case "incomplete": return "pending";
    default: return "pending";
  }
}

function getToolName(item: ToolItem): string {
  if (item.type === "block_tool_output") {
    return item.toolCall.name;
  }
  return item.blockName;
}

function getToolArgs(item: ToolItem): unknown {
  const raw = item.toolCall?.arguments;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getToolOutput(item: ToolItem): unknown {
  if (item.type === "block_tool_output" && item.status === "failed" && item.error) {
    return item.error.message;
  }
  return item.output;
}

function getErrorText(item: ToolItem): string | undefined {
  if (item.status !== "failed") return undefined;
  if (item.type === "block_tool_output" && item.error) {
    return item.error.message;
  }
  return String(item.output);
}

export function ToolAdapter({ item }: { item: ToolItem }) {
  if (!item.toolCall) return null;

  const state = mapStatus(item.status);
  const toolName = getToolName(item);
  const parsedArgs = getToolArgs(item);

  return (
    <Tool>
      <ToolHeader name={toolName} state={state} title={toolName} />
      <ToolContent>
        <ToolInput input={parsedArgs} />
        {item.status !== "in_progress" && (
          <ToolOutput
            output={getToolOutput(item)}
            errorText={getErrorText(item)}
          />
        )}
      </ToolContent>
    </Tool>
  );
}

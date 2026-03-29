"use client";

import type { BlockOutputItem, BlockToolOutputItem } from "@flow-state-dev/core/items";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/src/components/ai-elements/tool";

type ToolItem = BlockOutputItem | BlockToolOutputItem;

// Maps flow-state item status to AI SDK tool states for the AI Elements Tool component.
function mapToolState(status: ToolItem["status"]) {
  switch (status) {
    case "in_progress":
      return "input-available" as const;
    case "completed":
      return "output-available" as const;
    case "failed":
      return "output-error" as const;
    default:
      return "output-available" as const;
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

export function KitchenSinkToolCall({ item }: { item: ToolItem }) {
  if (!item.toolCall) return null;

  const state = mapToolState(item.status);
  const toolName = getToolName(item);
  const parsedArgs = getToolArgs(item);

  return (
    <Tool>
      <ToolHeader
        title={toolName}
        type="dynamic-tool"
        state={state}
        toolName={toolName}        
      />
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

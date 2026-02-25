"use client";

import type { BlockOutputItem } from "@flow-state-dev/core/items";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/src/components/ai-elements/tool";

// Maps flow-state item status to AI SDK tool states for the AI Elements Tool component.
function mapToolState(status: BlockOutputItem["status"]) {
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

export function KitchenSinkToolCall({ item }: { item: BlockOutputItem }) {
  if (!item.toolCall) return null;

  const state = mapToolState(item.status);
  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(item.toolCall.arguments);
  } catch {
    parsedArgs = item.toolCall.arguments;
  }

  return (
    <Tool>
      <ToolHeader
        title={item.blockName}
        type="dynamic-tool"
        state={state}
        toolName={item.blockName}
      />
      <ToolContent>
        <ToolInput input={parsedArgs} />
        {item.status !== "in_progress" && (
          <ToolOutput
            output={item.output}
            errorText={item.status === "failed" ? String(item.output) : undefined}
          />
        )}
      </ToolContent>
    </Tool>
  );
}

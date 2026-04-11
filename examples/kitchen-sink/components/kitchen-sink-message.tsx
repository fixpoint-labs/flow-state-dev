"use client";

import { useMemo } from "react";
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import { Message } from "@/components/flow-state/message";
import { useSessionItems } from "@/components/flow-state/session-items-context";
import { useModelPreset } from "@/components/model-preset-context";
import { getPresetOption } from "@/components/model-preset-selector";
import { getStyleOption, type ThinkingStyle } from "@/components/thinking-style-selector";
import { cn } from "@/lib/utils";

type ComponentItem = OutputItem & { type: "component"; component: string; key?: string };
type BlockOutputItem = OutputItem & { type: "block_output"; blockName: string };

function inferThinkingStyle(items: OutputItem[]): ThinkingStyle | null {
  const planItems = items.filter(
    (i) => i.type === "component" && (i as ComponentItem).component === "plan",
  ) as ComponentItem[];

  if (planItems.length > 0) {
    // Supervisor plan snapshots use keys like "supervisor-thinking:iter-1"
    const isSupervisor = planItems.some((i) => i.key?.includes("supervisor"));
    return isSupervisor ? "supervisor" : "plan-and-execute";
  }

  const hasSupervisor = items.some(
    (i) =>
      i.type === "block_output" &&
      (i as BlockOutputItem).blockName.includes("supervisor"),
  );
  if (hasSupervisor) return "supervisor";

  return null;
}

function StyleBadge({ style }: { style: ThinkingStyle }) {
  const option = getStyleOption(style);
  const Icon = option.icon;

  return (
    <div
      className={cn(
        "mb-1 inline-flex items-center gap-1 rounded-full",
        "border border-border/50 bg-muted/50 px-2 py-0.5",
        "text-[10px] font-medium leading-none text-muted-foreground",
        "animate-in fade-in-0 slide-in-from-top-1 duration-200",
      )}
    >
      <Icon className={cn("size-2.5", option.color)} />
      {option.label}
    </div>
  );
}

function ModelBadge({ preset }: { preset: string }) {
  const option = getPresetOption(preset);
  const Icon = option.icon;

  return (
    <div
      className={cn(
        "mb-1 inline-flex items-center gap-1 rounded-full",
        "border border-border/50 bg-muted/50 px-2 py-0.5",
        "text-[10px] font-medium leading-none text-muted-foreground",
        "animate-in fade-in-0 slide-in-from-top-1 duration-200",
      )}
    >
      <Icon className={cn("size-2.5", option.color)} />
      {option.label}
    </div>
  );
}

export function KitchenSinkMessage({ item }: { item: MessageItem }) {
  const allItems = useSessionItems();
  const modelPreset = useModelPreset();

  const style = useMemo(() => {
    if (item.role !== "assistant") return null;
    const siblingItems = allItems.filter((i) => i.requestId === item.requestId);
    return inferThinkingStyle(siblingItems);
  }, [item.role, item.requestId, allItems]);

  if (item.role !== "user" && item.role !== "assistant") return null;

  // Check if message has text content
  const hasText = (item.content ?? []).some(
    (c) => c.type === "output_text" && c.text,
  );
  if (!hasText) return null;

  const isAssistant = item.role === "assistant";

  return (
    <div>
      {isAssistant && (
        <div className="flex items-center gap-1.5">
          {style && <StyleBadge style={style} />}
          <ModelBadge preset={modelPreset} />
        </div>
      )}
      <Message item={item} />
    </div>
  );
}

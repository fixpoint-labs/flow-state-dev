"use client";

import { useMemo } from "react";
import type { MessageItem } from "@flow-state-dev/core/items";
import { ModelBadge } from "@flow-state-dev/react";
import { Message } from "@/components/flow-state/message";
import { useSessionItems } from "@/components/flow-state/session-items-context";
import { getStyleOption, type ThinkingStyle } from "@/components/thinking-style-selector";
import { inferThinkingStyle } from "@/lib/item-inference";
import { cn } from "@/lib/utils";

function StyleBadge({ style }: { style: ThinkingStyle }) {
  const option = getStyleOption(style);
  const Icon = option.icon;

  return (
    <div
      className={cn(
        "mb-2 inline-flex items-center gap-1 rounded-full",
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

export function ChatAgentMessage({ item }: { item: MessageItem }) {
  const allItems = useSessionItems();

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
          <ModelBadge
            model={item.model}
            className={cn(
              "mb-2 inline-flex items-center gap-1 rounded-full",
              "border border-border/50 bg-muted/50 px-2 py-0.5",
              "text-[10px] font-medium leading-none text-muted-foreground",
            )}
            style={{}}
          />
        </div>
      )}
      <Message item={item} />
    </div>
  );
}

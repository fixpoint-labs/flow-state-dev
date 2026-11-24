"use client";

import type { MessageItem } from "@flow-state-dev/core/items";
import { ModelBadge } from "@/components/flow-state/model-badge";
import { Message } from "@/components/flow-state/message";
import { cn } from "@/lib/utils";
import { BASE_PATH } from "@/lib/base-path";

export function ChatAgentMessage({ item }: { item: MessageItem }) {
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
          <ModelBadge
            model={item.model}
            className={cn(
              "mb-2 inline-flex items-center gap-1 rounded-md",
              "border border-border/50 bg-muted/50 px-2 py-0.5",
              "text-[10px] font-medium leading-none text-muted-foreground",
            )}
          />
        </div>
      )}
      {/* A line's files are read from this app's server, under its base path. */}
      <Message item={item} readBase={BASE_PATH} />
    </div>
  );
}

"use client";

import type { MessageItem } from "@flow-state-dev/core/items";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";

function extractText(item: MessageItem): string {
  return (item.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n\n");
}

export function MessageAdapter({ item }: { item: MessageItem }) {
  // Only render user and assistant messages — system/tool/developer roles are internal
  if (item.role !== "user" && item.role !== "assistant") return null;

  const text = extractText(item);
  if (!text) return null;

  return (
    <Message from={item.role as "user" | "assistant"}>
      <MessageContent>
        {item.role === "user" ? (
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        ) : (
          <MessageResponse>{text}</MessageResponse>
        )}
      </MessageContent>
    </Message>
  );
}

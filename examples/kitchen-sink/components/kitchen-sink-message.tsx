"use client";

import type { MessageItem } from "@flow-state-dev/core/items";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/src/components/ai-elements/message";
import { Bot, User } from "lucide-react";

function extractText(item: MessageItem): string {
  return (item.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
}

export function KitchenSinkMessage({ item }: { item: MessageItem }) {
  // Only render user and assistant messages — system/tool/developer roles are internal
  if (item.role !== "user" && item.role !== "assistant") return null;

  const text = extractText(item);
  if (!text) return null;

  return (
    <Message from={item.role as "user" | "assistant"}>
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {item.role === "user" ? (
            <User className="h-3.5 w-3.5" />
          ) : (
            <Bot className="h-3.5 w-3.5" />
          )}
        </div>
        <MessageContent>
          {item.role === "user" ? (
            <p className="whitespace-pre-wrap text-sm">{text}</p>
          ) : (
            <MessageResponse>{text}</MessageResponse>
          )}
        </MessageContent>
      </div>
    </Message>
  );
}

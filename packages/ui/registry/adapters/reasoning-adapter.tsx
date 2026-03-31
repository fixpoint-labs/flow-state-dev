"use client";

import type { ReasoningItem } from "@flow-state-dev/core/items";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/flow-state/reasoning";

function extractReasoningText(item: ReasoningItem): string {
  return (item.summary ?? [])
    .filter((c) => c.type === "reasoning_text" || c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
}

export function ReasoningAdapter({ item }: { item: ReasoningItem }) {
  const text = extractReasoningText(item);
  if (!text) return null;

  return (
    <Reasoning isStreaming={item.status === "in_progress"}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

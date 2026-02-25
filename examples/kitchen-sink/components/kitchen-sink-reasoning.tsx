"use client";

import type { ReasoningItem } from "@flow-state-dev/core/items";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  useReasoning,
} from "@/src/components/ai-elements/reasoning";
import { Shimmer } from "@/src/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";

function ReasoningLabel() {
  const { isStreaming, isOpen, duration } = useReasoning();

  const label =
    isStreaming || duration === 0 ? (
      <Shimmer duration={1}>Thinking...</Shimmer>
    ) : duration === undefined ? (
      <span>Thought for a few seconds</span>
    ) : (
      <span>Thought for {duration} seconds</span>
    );

  return (
    <>
      {label}
      <ChevronDownIcon
        className={cn(
          "size-3 transition-transform",
          isOpen ? "rotate-180" : "rotate-0"
        )}
      />
    </>
  );
}

function extractReasoningText(item: ReasoningItem): string {
  return (item.summary ?? [])
    .filter((c) => c.type === "reasoning_text" || c.type === "output_text")
    .map((c) => c.text)
    .join("\n");
}

export function KitchenSinkReasoning({ item }: { item: ReasoningItem }) {
  const text = extractReasoningText(item);
  if (!text) return null;

  return (
    <Reasoning isStreaming={item.status === "in_progress"} className="-mb-2">
      <ReasoningTrigger className="text-xs!">
        <ReasoningLabel />
      </ReasoningTrigger>
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}

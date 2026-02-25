"use client";

import { cn } from "@/lib/utils";
import { Brain, ChevronRight } from "lucide-react";
import type { ReasoningItem } from "@flow-state-dev/core/items";

function extractText(item: ReasoningItem): string {
  return (item.summary ?? [])
    .filter((c) => c.type === "reasoning_text")
    .map((c) => c.text)
    .join("\n");
}

export function ReasoningMessage({ item }: { item: ReasoningItem }) {
  const text = extractText(item);

  if (text.length === 0) return null;

  return (
    <details className="group mx-4 my-2">
      <summary className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs",
        "text-muted-foreground hover:bg-muted/50 transition-colors"
      )}>
        <Brain className="h-3.5 w-3.5" />
        <span>Reasoning</span>
        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
      </summary>
      <div className={cn(
        "mx-3 mt-1 rounded-lg bg-muted/30 px-4 py-3",
        "text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap"
      )}>
        {text}
      </div>
    </details>
  );
}

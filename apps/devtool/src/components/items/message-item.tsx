import type { MessageItem } from "@flow-state-dev/core/items";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function MessageItemView({ item }: { item: MessageItem }) {
  const textParts = item.content
    .filter((c) => c.type === "output_text" || c.type === "reasoning_text" || c.type === "refusal")
    .map((c) => ("text" in c ? c.text : ""));
  const text = textParts.join("");
  const isStreaming = item.status === "in_progress";

  return (
    <div className="flex items-start gap-2">
      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-500 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Badge variant="outline" className="text-[10px] px-1 py-0 border-slate-700 text-slate-500">
            {item.role}
          </Badge>
        </div>
        <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
          {text}
          {isStreaming && <span className="inline-block w-1.5 h-3.5 bg-slate-400 animate-pulse ml-0.5 align-text-bottom" />}
        </div>
      </div>
    </div>
  );
}

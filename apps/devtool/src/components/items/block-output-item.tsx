import type { BlockOutputItem } from "@flow-state-dev/core/items";
import { Braces, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/shared/json-viewer";

export function BlockOutputItemView({ item }: { item: BlockOutputItem }) {
  const isToolCall = !!item.toolCall;
  const isInProgress = item.status === "in_progress";

  if (isToolCall) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Braces className="h-3.5 w-3.5 shrink-0 text-purple-400" />
          <Badge variant="outline" className="text-[10px] px-1 py-0 bg-purple-900/30 text-purple-300 border-purple-800">
            function_call
          </Badge>
          <span className="text-xs text-slate-300 font-mono">{item.blockName}</span>
          {isInProgress && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
        </div>
        <div className="ml-5">
          <div className="text-[10px] text-slate-500 font-mono mb-0.5">
            args: {item.toolCall!.arguments.slice(0, 100)}
            {item.toolCall!.arguments.length > 100 ? "..." : ""}
          </div>
          {!isInProgress && item.output !== undefined && (
            <JsonViewer data={item.output} className="mt-1" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Braces className="h-3.5 w-3.5 shrink-0 text-green-400" />
        <Badge variant="outline" className="text-[10px] px-1 py-0 bg-slate-800 text-green-300 border-slate-700">
          block_output
        </Badge>
        <span className="text-xs text-slate-400 font-mono">{item.blockName}</span>
      </div>
      {item.output !== undefined && (
        <div className="ml-5">
          <JsonViewer data={item.output} />
        </div>
      )}
    </div>
  );
}

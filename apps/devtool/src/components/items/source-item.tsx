/**
 * Renders a source reference from a provider-native tool (e.g., web search).
 * Displays as a compact clickable link with title and URL.
 */
import type { SourceItem } from "@flow-state-dev/core/items";
import { Globe } from "lucide-react";

export function SourceItemView({ item }: { item: SourceItem }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400 py-0.5">
      <Globe className="h-3 w-3 shrink-0 text-blue-400" />
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate hover:text-blue-300 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {item.title ?? item.url}
      </a>
    </div>
  );
}

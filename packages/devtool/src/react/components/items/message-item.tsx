/**
 * Chat-style message renderer.
 * User messages align right, assistant messages align left.
 * Assistant messages show an identity badge when itemVisibility/agentName are present.
 */
import type { MessageItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";

function IdentityBadge({ item }: { item: MessageItem }) {
  const vis = resolveItemVisibility(item);
  const visLabel = vis.history ? undefined : "sub-agent";
  if (visLabel === undefined && item.agentName === undefined) return null;
  return (
    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex gap-1.5">
      {item.agentName !== undefined && <span className="font-mono">{item.agentName}</span>}
      {visLabel !== undefined && (
        <span className="px-1 rounded-sm bg-slate-800/70 text-slate-400">{visLabel}</span>
      )}
    </div>
  );
}

export function MessageItemView({ item }: { item: MessageItem }) {
  const textParts = item.content
    .filter((c) => c.type === "output_text" || c.type === "reasoning_text" || c.type === "refusal")
    .map((c) => ("text" in c ? c.text : ""));
  const text = textParts.join("");
  const isStreaming = item.status === "in_progress";
  const isUser = item.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600/20 border border-blue-500/20 px-3.5 py-2">
          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
            {text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[95%]">
      <IdentityBadge item={item} />
      <div className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
        {text}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-green-400/80 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
        )}
      </div>
    </div>
  );
}

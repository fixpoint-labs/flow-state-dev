/**
 * Chat-style message renderer.
 * User messages align right, assistant messages align left.
 * No role badges — position implies role.
 */
import type { MessageItem } from "@flow-state-dev/core/items";

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
      <div className="text-sm text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
        {text}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-green-400/80 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
        )}
      </div>
    </div>
  );
}

/**
 * Chat-style message renderer.
 * User messages align right, assistant messages align left.
 * Assistant messages carry a mono label line above the text: the agent name
 * (or the emitting block when no agent name is set), the model that answered
 * when known, and a sub-agent tag when itemVisibility hides it from history.
 */
import type { MessageItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";

function IdentityBadge({ item }: { item: MessageItem }) {
  const vis = resolveItemVisibility(item);
  const visLabel = vis.history ? undefined : "sub-agent";
  const name = item.agentName ?? item.provenance?.blockName ?? item.role;
  return (
    <div className="mb-1.5 flex items-center gap-2.5 font-fs-mono text-[10.5px] font-medium tracking-[.06em]">
      <span className="uppercase text-fs-ink2">{name}</span>
      {item.model?.actual !== undefined && <span className="text-fs-ink4">{item.model.actual}</span>}
      {visLabel !== undefined && (
        <span className="border border-dashed border-fs-ink/45 px-1 text-[9.5px] uppercase tracking-[.08em] text-fs-ink3">{visLabel}</span>
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
        <div className="max-w-[70%] border border-fs-ink bg-fs-card px-[13px] py-[9px]">
          <p className="text-[14px] text-fs-ink whitespace-pre-wrap break-words leading-normal">
            {text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[78%]">
      <IdentityBadge item={item} />
      <div className="text-[14.5px] text-fs-ink whitespace-pre-wrap break-words leading-[1.55]">
        {text}
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-fs-blue animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}

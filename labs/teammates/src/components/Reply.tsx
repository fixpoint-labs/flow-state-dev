import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { replyPreview } from "../lib/reply-preview";
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";

/** A reply stays readable until folded by its reader; long worker results start with an excerpt. */
export function Reply({ text, label = "reply", defaultExpanded = true, streaming = false }: { text: string; label?: string; defaultExpanded?: boolean; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const id = useId();
  return (
    <>
      <div id={id} hidden={!expanded}>
        {expanded ? <MarkdownText text={text} /> : null}
      </div>
      {expanded ? null : <p data-reply-preview className="text-sm leading-relaxed text-muted-foreground">{replyPreview(text)}</p>}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((open) => !open)}
        className="mt-2 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ChevronDownIcon aria-hidden="true" className={cn("size-3.5", expanded && "rotate-180")} />
        {expanded ? `Collapse ${label}` : `Expand ${label} · full details`}
      </button>
      {streaming ? <span role="status" className="ml-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden="true" data-typing-dots data-active="true" className="inline-flex items-center gap-1"><span /><span /><span /></span>
        <span className="sr-only">Reply in progress</span>
      </span> : null}
    </>
  );
}

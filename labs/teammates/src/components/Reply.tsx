import { ChevronDownIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { isLongReply, replyPreview } from "../lib/reply-preview";
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";
import { TypingDots } from "./TypingDots";

/**
 * A reply in the thread. A short one is just its text. A long one gets a fold
 * control: open, or folded to an excerpt of its own words when `foldLong` (a
 * teammate's message or a task's result). The fold follows the reader once
 * they use it; it is set again only when the text crosses the long/short line,
 * so a reply that grows long while it arrives still gets its excerpt.
 */
export function Reply({ text, label = "reply", foldLong = false, streaming = false, stale = false }: {
  text: string;
  label?: string;
  /** A long reply starts folded to its excerpt. */
  foldLong?: boolean;
  /** Still arriving: dots beside it say so. */
  streaming?: boolean;
  /** The feed stopped hearing from the server: the dots hold still. */
  stale?: boolean;
}) {
  const long = isLongReply(text);
  const [fold, setFold] = useState({ long, expanded: !(long && foldLong) });
  if (fold.long !== long) setFold({ long, expanded: !(long && foldLong) });
  const expanded = !long || fold.expanded;
  const id = useId();
  const preview = useMemo(() => (expanded ? "" : replyPreview(text)), [expanded, text]);
  return (
    <>
      {/* Always in the page, so the control's aria-controls names a real element; the Markdown mounts only when open. */}
      <div id={id} hidden={!expanded}>
        {expanded ? <MarkdownText text={text} /> : null}
      </div>
      {expanded ? null : <p data-reply-preview className="text-base leading-relaxed text-muted-foreground">{preview}</p>}
      {long ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setFold({ long, expanded: !expanded })}
          className="mt-2 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronDownIcon aria-hidden="true" className={cn("size-3.5", expanded && "rotate-180")} />
          {expanded ? `Collapse ${label}` : `Expand ${label} · full details`}
        </button>
      ) : null}
      {streaming ? (
        <span role="status" className="ml-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <TypingDots active={!stale} />
          <span className="sr-only">Reply in progress</span>
        </span>
      ) : null}
    </>
  );
}

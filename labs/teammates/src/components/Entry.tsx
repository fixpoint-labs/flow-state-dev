import { useState } from "react";
import type { ConversationEntry } from "../adapter";
import { cn } from "../lib/utils";

/**
 * One entry of a conversation. Your lines sit on the right; the worker's
 * answers on the left. A message the worker sent another worker is a one-line
 * card that opens to its full text; a message it received, or a task it
 * filed coming back, lands under the sender's name.
 */
export function Entry({ entry, workerName, nameOf }: { entry: ConversationEntry; workerName: string; nameOf: (id: string) => string }) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-accent px-3 py-2 text-sm whitespace-pre-wrap" data-entry="user">
            {entry.text}
            {entry.queued ? <span className="mt-1 block text-xs text-muted-foreground">waits for {workerName}'s answer</span> : null}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="max-w-[85%] rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap" data-entry="assistant">
          {entry.text}
        </div>
      );
    case "sent":
      return <SentCard to={nameOf(entry.to)} text={entry.text} />;
    case "received":
      return (
        <section
          aria-label={`From ${nameOf(entry.from)}`}
          data-entry="received"
          className="max-w-[85%] rounded-md border border-dashed border-info/60 bg-info/5 px-3 py-2"
        >
          <div className="font-mono text-[10px] tracking-widest text-info uppercase">
            ← {nameOf(entry.from)}
            {entry.inReplyTo ? " · reply" : ""}
          </div>
          <p className="mt-0.5 text-sm whitespace-pre-wrap">{entry.text}</p>
        </section>
      );
    case "result":
      return (
        <section aria-label={`From ${nameOf(entry.from)}`} data-entry="result" className="max-w-[85%] rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-2">
          <div className="font-mono text-[10px] tracking-widest text-success uppercase">← {nameOf(entry.from)} · task done</div>
          <p className="mt-0.5 text-sm whitespace-pre-wrap">{entry.text}</p>
        </section>
      );
    case "task":
      // Drawn by the conversation, from the board's row.
      return null;
  }
}

/** A message to another worker: one line until opened. */
function SentCard({ to, text }: { to: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`To ${to}: ${text}`}
      data-entry="sent"
      onClick={() => setOpen((o) => !o)}
      className="flex max-w-[85%] items-start gap-2 rounded-md border border-dashed border-success/60 px-3 py-1.5 text-left font-mono text-xs text-success hover:bg-success/5"
    >
      <span className="shrink-0">→ to {to} ·</span>
      <span className={cn("min-w-0 flex-1 text-foreground", open ? "whitespace-pre-wrap" : "truncate")}>{text}</span>
      <span aria-hidden className="shrink-0 text-muted-foreground">
        {open ? "▾" : "▸"}
      </span>
    </button>
  );
}

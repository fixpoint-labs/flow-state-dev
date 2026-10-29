import { useState } from "react";
import type { ConversationEntry } from "../adapter";
import { useSubmit } from "../lib/use-submit";
import { cn } from "../lib/utils";
import { AgentMarkdown } from "./flow-state/message-response";

/**
 * One entry of a conversation. Your lines sit on the right; the worker's
 * answers on the left. A message the worker sent another worker is a one-line
 * card that opens to its full text; a message it received, or a task it
 * filed coming back, lands under the sender's name. A worker's text is
 * Markdown; your own lines are shown as typed. A tool that waits for your yes
 * is a card with Approve and Deny until you answer.
 */
export function Entry({
  entry,
  workerName,
  nameOf,
  isCoding = () => false,
  onAnswer,
}: {
  entry: ConversationEntry;
  workerName: string;
  nameOf: (id: string) => string;
  /** The worker coding tasks run on: its results are the task's, not a teammate's. */
  isCoding?: (id: string) => boolean;
  onAnswer?: (approve: boolean) => Promise<void>;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-lg bg-accent px-4 py-2.5 text-sm whitespace-pre-wrap" data-entry="user">
            {entry.text}
            {entry.queued ? <span className="mt-1 block text-xs text-muted-foreground">waits for {workerName}'s answer</span> : null}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="max-w-[85%] py-1 text-sm leading-relaxed" data-entry="assistant">
          <AgentMarkdown text={entry.text} />
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
          <AgentMarkdown className="mt-0.5 text-sm" text={entry.text} />
        </section>
      );
    case "result": {
      // A coding task's result is the task's, not a teammate's.
      const from = isCoding(entry.from) ? "the coding task" : nameOf(entry.from);
      return (
        <section aria-label={`From ${from}`} data-entry="result" className="max-w-[85%] rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-2">
          <div className="font-mono text-[10px] tracking-widest text-success uppercase">
            ← {isCoding(entry.from) ? "coding task" : nameOf(entry.from)} · {entry.failed ? "task failed" : "task done"}
          </div>
          <AgentMarkdown className="mt-0.5 text-sm" text={entry.text} />
        </section>
      );
    }
    case "task":
      // Drawn by the conversation, from the board's row.
      return null;
    case "approval":
      return <ApprovalCard workerName={workerName} text={entry.text} resolution={entry.resolution} onAnswer={onAnswer} />;
  }
}

/** What a worker's tool waits on you for. Once answered it says how. */
function ApprovalCard({
  workerName,
  text,
  resolution,
  onAnswer,
}: {
  workerName: string;
  text: string;
  resolution?: string;
  onAnswer?: (approve: boolean) => Promise<void>;
}) {
  const { error, busy, submit } = useSubmit((approve: boolean) => onAnswer?.(approve) ?? Promise.resolve());
  return (
    <section aria-label={`${workerName} asks`} data-entry="approval" className="max-w-[85%] rounded-md border border-attention bg-attention/10 px-3 py-2 text-sm">
      <div className="font-mono text-[10px] tracking-widest text-attention uppercase">{workerName} asks · {resolution ?? "waiting for you"}</div>
      <p className="mt-0.5 whitespace-pre-wrap">{text}</p>
      {resolution === undefined ? (
        <div className="mt-2 flex gap-2 text-xs">
          <button type="button" disabled={busy} onClick={() => void submit(undefined, true)} className="rounded-sm bg-primary px-2 py-1 font-semibold text-primary-foreground disabled:opacity-40">
            Approve
          </button>
          <button type="button" disabled={busy} onClick={() => void submit(undefined, false)} className="rounded-sm border border-border px-2 py-1 hover:bg-accent disabled:opacity-40">
            Deny
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
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

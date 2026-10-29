import { memo } from "react";
import type { ConversationEntry } from "../adapter";
import { AgentMarkdown } from "./flow-state/message-response";

/**
 * One entry of a conversation. Your lines sit on the right; the worker's
 * answers on the left. A message the worker sent another worker is one line,
 * "Messaged researcher", that opens the exchange in a popup; a message it
 * received, or a task it filed coming back, lands under the sender's name,
 * and a task's result opens that task's popup. A worker's text is
 * Markdown; your own lines are shown as typed. Memoized: a streamed chunk
 * redraws only the entry that changed.
 */
export const Entry = memo(function Entry({
  entry,
  workerName,
  nameOf,
  isCoding = () => false,
  replied = false,
  onOpenMessage,
  onOpenTask,
}: {
  entry: ConversationEntry;
  workerName: string;
  nameOf: (id: string) => string;
  /** The worker coding tasks run on: its results are the task's, not a teammate's. */
  isCoding?: (id: string) => boolean;
  /** For a sent message: it was answered. */
  replied?: boolean;
  /** Open the exchange a sent message started. */
  onOpenMessage?: (entry: Extract<ConversationEntry, { kind: "sent" }>) => void;
  /** Open the task a result came from. */
  onOpenTask?: (taskId: string) => void;
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
        <div className="py-1 text-sm leading-relaxed" data-entry="assistant">
          <AgentMarkdown text={entry.text} />
        </div>
      );
    case "sent":
      return <SentLine to={nameOf(entry.to)} text={entry.text} replied={replied} onOpen={onOpenMessage ? () => onOpenMessage(entry) : undefined} />;
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
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-success uppercase">
            <span className="flex-1">
              ← {isCoding(entry.from) ? "coding task" : nameOf(entry.from)} · {entry.failed ? "task failed" : "task done"}
            </span>
            {entry.taskId !== "" && onOpenTask ? (
              <button type="button" onClick={() => onOpenTask(entry.taskId)} className="text-muted-foreground normal-case hover:text-foreground">
                Open
              </button>
            ) : null}
          </div>
          <AgentMarkdown className="mt-0.5 text-sm" text={entry.text} />
        </section>
      );
    }
    case "task":
      // Drawn by the conversation, from the board's row.
      return null;
  }
});

/** A message to another worker: one line, "Messaged researcher", that opens the exchange. */
function SentLine({ to, text, replied, onOpen }: { to: string; text: string; replied: boolean; onOpen?: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Messaged ${to}: ${text}`}
      data-entry="sent"
      onClick={onOpen}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      <span aria-hidden className="shrink-0 text-muted-foreground">
        ↗
      </span>
      <span className="shrink-0">Messaged {to}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>
      <span className="shrink-0 text-xs text-muted-foreground" data-sent-status>
        {replied ? "replied" : "working"}
      </span>
    </button>
  );
}

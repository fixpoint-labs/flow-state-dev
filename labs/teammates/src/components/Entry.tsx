import { memo } from "react";
import type { ConversationEntry } from "../adapter";
import type { Look } from "../lib/looks";
import { Avatar } from "./Avatar";
import type { AnswerState } from "./Popups";
import { useSubmit } from "../lib/use-submit";
import { AgentMarkdown } from "./flow-state/message-response";

/**
 * One entry of a conversation. Your lines sit on the right; the worker's
 * answers on the left. A message the worker sent another worker is one line,
 * "Messaged researcher", that opens the exchange in a popup; a message it
 * received, or a task it filed coming back, lands under the sender's name,
 * and a task's result opens that task's popup. A worker's text is
 * Markdown; your own lines are shown as typed. A worker that waits for your
 * yes (`waitForUser` with an approval) is a card with Approve and Deny until
 * you answer. Memoized: a streamed chunk redraws only the entry that changed.
 */
export const Entry = memo(function Entry({
  entry,
  workerName,
  nameOf,
  lookOf,
  isCoding = () => false,
  answer = "working",
  onOpenMessage,
  onOpenTask,
  onAnswer,
}: {
  entry: ConversationEntry;
  workerName: string;
  nameOf: (id: string) => string;
  /** A teammate's icon and color, the same as in the list. */
  lookOf: (id: string) => Look;
  /** The worker coding tasks run on: its results are the task's, not a teammate's. */
  isCoding?: (id: string) => boolean;
  /** For a sent message: how it stands. */
  answer?: AnswerState;
  /** Open the exchange a sent message started. */
  onOpenMessage?: (entry: Extract<ConversationEntry, { kind: "sent" }>) => void;
  /** Open the task a result came from. */
  onOpenTask?: (taskId: string) => void;
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
        <div className="py-1 text-sm leading-relaxed" data-entry="assistant">
          <AgentMarkdown text={entry.text} />
        </div>
      );
    case "sent":
      return <SentLine to={nameOf(entry.to)} look={lookOf(entry.to)} text={entry.text} answer={answer} onOpen={onOpenMessage ? () => onOpenMessage(entry) : undefined} />;
    case "received":
      return (
        <section
          aria-label={`From ${nameOf(entry.from)}`}
          data-entry="received"
          className="max-w-[85%] rounded-md border border-dashed border-info/60 bg-info/5 px-3 py-2"
        >
          <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-info uppercase">
            <Avatar look={lookOf(entry.from)} size="sm" />← {nameOf(entry.from)}
            {entry.noAnswer ? " · no answer" : entry.inReplyTo ? " · reply" : ""}
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
    case "approval":
      return <ApprovalCard workerName={workerName} text={entry.text} resolution={entry.resolution} onAnswer={onAnswer} />;
  }
});

/** What a worker waits on you for. Once answered it says how. */
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

/** A message to another worker: one line, "Messaged researcher", that opens the exchange. */
function SentLine({ to, look, text, answer, onOpen }: { to: string; look: Look; text: string; answer: AnswerState; onOpen?: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Messaged ${to}: ${text}`}
      data-entry="sent"
      onClick={onOpen}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      <Avatar look={look} size="sm" />
      <span className="shrink-0">Messaged {to}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>
      <span className="shrink-0 text-xs text-muted-foreground" data-sent-status>
        {answer}
      </span>
    </button>
  );
}

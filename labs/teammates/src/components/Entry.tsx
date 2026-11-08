import { memo } from "react";
import type { ConversationEntry } from "../adapter";
import type { Look } from "../lib/looks";
import { Avatar } from "./Avatar";
import type { AnswerStatus } from "./Popups";
import { useSubmit } from "@flow-state-dev/react";
import { MarkdownText } from "./flow-state/message-response";
import { RequestRecovery } from "./flow-state/request-recovery";
import { ToolRun } from "./ToolRun";

/**
 * One entry of a conversation. Your lines sit on the right; the worker's
 * answers on the left. A message the worker sent another worker is one line,
 * "Messaged researcher", that opens the exchange in a popup; a message it
 * received lands under the sender's name. A task it filed coming back is one
 * line, "researcher finished: …", that opens the task's popup, where its
 * result is; a routed answer, which names no task, is shown as said. A worker's text is
 * Markdown; your own lines are shown as typed. A worker that waits for your
 * yes (`suspendForUser` with an approval) is a card with Approve and Deny until
 * you answer. The tool calls a turn makes show inline as it makes them, a run
 * of them as one line that is open while it runs and folds once it is done.
 * A failed turn is the registry's `request-recovery` line under the worker's
 * name, with its reason; `onRetry` draws its Retry, so pass it only for the
 * newest turn while nothing runs. A reply its turn never finished is marked
 * incomplete. A turn you stopped is its stopped line, with the background work
 * still running (`stillRunning`) when the conversation passes it, and View
 * (`onViewTasks`) to where the tasks are listed.
 * Memoized: a streamed chunk redraws only the entry that changed.
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
  onRetry,
  stillRunning,
  onViewTasks,
}: {
  entry: ConversationEntry;
  workerName: string;
  nameOf: (id: string) => string;
  /** A teammate's icon and color, the same as in the list. */
  lookOf: (id: string) => Look;
  /** The worker coding tasks run on: its results are the task's, not a teammate's. */
  isCoding?: (id: string) => boolean;
  /** For a sent message: how it stands. */
  answer?: AnswerStatus;
  /** Open the exchange a sent message started. */
  onOpenMessage?: (entry: Extract<ConversationEntry, { kind: "sent" }>) => void;
  /** Open the task a result came from. */
  onOpenTask?: (taskId: string) => void;
  onAnswer?: (approve: boolean) => Promise<void>;
  /** Run a failed turn again. */
  onRetry?: () => Promise<void>;
  /** For a stopped turn's line: the background work still running, when this line may say it. */
  stillRunning?: number;
  /** Show where the conversation's tasks are listed. */
  onViewTasks?: () => void;
}) {
  switch (entry.kind) {
    case "stopped":
      return (
        <div data-entry="stopped">
          <RequestRecovery stopped stillRunning={stillRunning} onView={onViewTasks} />
        </div>
      );
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
        <div className="py-1 text-sm leading-relaxed" data-entry="assistant" data-incomplete={entry.incomplete ? "true" : undefined}>
          <MarkdownText text={entry.text} />
          {entry.incomplete ? <span className="mt-1 block text-xs text-muted-foreground">Incomplete</span> : null}
        </div>
      );
    case "failed":
      return (
        <div data-entry="failed">
          <RequestRecovery who={workerName} reason={entry.reason} code={entry.code} details={entry.details} onRetry={onRetry} />
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
          <MarkdownText className="mt-0.5 text-sm" text={entry.text} />
        </section>
      );
    case "result": {
      // A coding task's result is the task's, not a teammate's.
      const from = isCoding(entry.from) ? "the coding task" : nameOf(entry.from);
      if (entry.taskId !== "" && onOpenTask) {
        return (
          <ResultLine
            who={isCoding(entry.from) ? "Coding task" : nameOf(entry.from)}
            look={isCoding(entry.from) ? undefined : lookOf(entry.from)}
            entry={entry}
            onOpen={() => onOpenTask(entry.taskId)}
          />
        );
      }
      return (
        <section aria-label={`From ${from}`} data-entry="result" className="max-w-[85%] rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-2">
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-success uppercase">
            <span className="flex-1">
              ← {isCoding(entry.from) ? "coding task" : nameOf(entry.from)} · {entry.failed ? "task failed" : entry.cancelled ? "task cancelled" : "task done"}
            </span>
            {entry.taskId !== "" && onOpenTask ? (
              <button type="button" onClick={() => onOpenTask(entry.taskId)} className="text-muted-foreground normal-case hover:text-foreground">
                Open
              </button>
            ) : null}
          </div>
          <MarkdownText className="mt-0.5 text-sm" text={entry.text} />
        </section>
      );
    }
    case "task":
      // Drawn by the conversation, from the board's row.
      return null;
    case "steps":
      return <ToolRun steps={entry.steps} run={entry} />;
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

/** A filed task coming back: one line, "researcher finished: Draft the post", that opens its popup. */
function ResultLine({ who, look, entry, onOpen }: { who: string; look?: Look; entry: Extract<ConversationEntry, { kind: "result" }>; onOpen: () => void }) {
  const said = `${who} ${entry.failed ? "couldn't finish" : entry.cancelled ? "was cancelled" : "finished"}`;
  const line = entry.title === undefined ? said : `${said}: ${entry.title}`;
  return (
    <button
      type="button"
      aria-label={line}
      data-entry="result"
      data-status={entry.failed ? "failed" : entry.cancelled ? "cancelled" : "done"}
      onClick={onOpen}
      className="flex w-full max-w-[85%] items-center gap-2 rounded-md border border-dashed border-success/60 bg-success/5 px-3 py-1.5 text-left text-sm hover:bg-accent"
    >
      {look === undefined ? (
        <span aria-hidden className="shrink-0 text-muted-foreground">
          ⚙
        </span>
      ) : (
        <Avatar look={look} size="sm" />
      )}
      <span className={entry.failed ? "min-w-0 truncate text-destructive" : "min-w-0 truncate"}>{line}</span>
      {/* What it came back with, cut to the line; the whole of it is in the popup. */}
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.text}</span>
    </button>
  );
}

/** A message to another worker: one line, "Messaged researcher", that opens the exchange. */
function SentLine({ to, look, text, answer, onOpen }: { to: string; look: Look; text: string; answer: AnswerStatus; onOpen?: () => void }) {
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

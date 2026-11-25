/**
 * What a task waits on you for, as a card in the conversation: the whole
 * question, Markdown drawn, and a way to answer it there. A question takes a
 * reply. A coding run's review takes your words back as Request changes, and
 * Open review opens the task's popup, where its verdict, checks and ways to
 * land are, to accept it. The card reads the hold the board's task holds (the
 * coding board view's `asks`, the one Inbox reads) and answers through the
 * Inbox client (`useTaskActions`), so an answer from here, the popup or Inbox
 * clears it everywhere. Answered here, it keeps one line saying what you
 * answered.
 */
import { useState, type ReactNode } from "react";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { useTaskActions } from "../app";
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";

/** A button on the card. */
const BUTTON =
  "h-8 rounded-md border border-border-strong px-3 text-xs font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring";
/** The card's main button. */
const PRIMARY = cn(BUTTON, "border-transparent bg-primary text-primary-foreground hover:bg-primary hover:opacity-90");

/**
 * One hold of a task, open or answered here. `answered` is what you answered
 * from this card: the card then shows only that line. `onAnswered` is called
 * with that line once an answer went through.
 */
export function WaitingCard({
  task,
  hold,
  sessionId,
  who,
  answered,
  onAnswered,
  onOpen,
}: {
  task: CodingBoardTask;
  /** The open hold, as the board read it; absent once it is answered. */
  hold: InboxHold | undefined;
  /** The conversation whose board holds the task. */
  sessionId: string;
  /** Who waits on you, as the card names it: the teammate, or the coding task. */
  who: string;
  answered: string | undefined;
  onAnswered: (line: string) => void;
  /** Open the task's popup: its steps, its whole run, and a review's ways to land. */
  onOpen: () => void;
}) {
  const kind = hold === undefined ? undefined : hold.ask.kind;
  const title = kind === "review" ? `Review: ${task.title}` : `${who} asks`;
  return (
    <section aria-label="Asks you" data-waiting={answered === undefined ? "open" : "answered"} className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3 text-sm shadow-(--shadow-card)">
      {answered !== undefined ? (
        <p className="truncate text-xs text-muted-foreground" title={answered}>
          You answered: {answered}
        </p>
      ) : hold === undefined ? null : (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full bg-attention px-1.5 font-mono text-xs leading-4 font-semibold text-attention-foreground">Needs you</span>
            <span className="min-w-0 flex-1 truncate font-semibold" title={title}>
              {title}
            </span>
          </div>
          <MarkdownText text={hold.ask.prompt} />
          {hold.unanswerable !== null ? (
            <p className="text-xs text-muted-foreground">{hold.unanswerable}</p>
          ) : kind === "question" || kind === "review" ? (
            <Reply task={task} sessionId={sessionId} review={kind === "review"} onAnswered={onAnswered} onOpen={onOpen} />
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-1">Teammates can't answer this kind of wait yet.</span>
              <button type="button" onClick={onOpen} className={BUTTON}>
                Open task
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The card's answer: a reply box. On a question, Send reply (or Cmd/Ctrl+Enter)
 * answers with its words. On a review, the words go back as Request changes,
 * and Open review leads to the popup to accept.
 */
function Reply({ task, sessionId, review, onAnswered, onOpen }: { task: CodingBoardTask; sessionId: string; review: boolean; onAnswered: (line: string) => void; onOpen: () => void }) {
  const actions = useTaskActions(sessionId);
  const [words, setWords] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = words.trim();
  const send = async () => {
    if (text === "" || pending) return;
    setPending(true);
    setError(null);
    try {
      await actions.answer(task, review ? { verdict: "revise", words: text } : { text });
      onAnswered(review ? `Asked for changes: ${text}` : text);
    } catch (failed) {
      setError(failed instanceof Error ? failed.message : String(failed));
    } finally {
      setPending(false);
    }
  };
  const alert: ReactNode =
    error === null ? null : (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label={review ? "What should change" : "Your reply"}
        value={words}
        rows={2}
        disabled={pending}
        onChange={(e) => setWords(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className="w-full rounded-md border border-border-strong bg-background p-2 text-sm focus-visible:border-ring focus-visible:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || text === ""} onClick={() => void send()} className={review ? BUTTON : PRIMARY}>
          {review ? "Request changes" : "Send reply"}
        </button>
        {review ? (
          <button type="button" onClick={onOpen} className={PRIMARY}>
            Open review
          </button>
        ) : null}
      </div>
      {alert}
    </div>
  );
}

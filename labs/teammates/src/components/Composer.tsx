import { clearDraft, isSendKey, useDraft } from "@flow-state-dev/react";
import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { useSubmit } from "../lib/use-submit";

/**
 * Where you type to the open worker. Enter or Cmd+Enter (Ctrl+Enter) sends,
 * Shift+Enter is a new line.
 * A line sent while the worker answers waits for that answer. It sits in the
 * conversation's column (`--thread-width`), and the box grows with what you
 * type up to a cap, then scrolls.
 *
 * A line stays in the box until its send lands, so a failed send loses
 * nothing: the box keeps it and says why, with Retry. A send that lands clears
 * the box, unless something else was typed meanwhile. The draft is kept per
 * conversation across a reload.
 */
export function Composer({
  sessionId,
  workerName,
  running,
  onSend,
}: {
  sessionId: string;
  workerName: string;
  running: boolean;
  /** Resolves once the line has landed; rejects with why it didn't. */
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useDraft("teammates:draft", sessionId);
  const current = useRef(text);
  current.current = text;
  const { error, busy, submit } = useSubmit(async (typed: string) => {
    await onSend(typed.trim());
    // The box may have closed and reopened while it ran: the stored draft goes only if it is still this line.
    clearDraft("teammates:draft", sessionId, typed);
    if (current.current === typed) setText("");
  });
  const send = (event?: FormEvent) => {
    if (!text.trim() || busy) {
      event?.preventDefault();
      return;
    }
    void submit(event, text);
  };
  const onSubmit = (event: FormEvent) => send(event);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendKey(event, { enterSends: true })) {
      event.preventDefault();
      send();
    }
  };
  return (
    <form onSubmit={onSubmit} className="px-6 pb-4">
      <div data-column className="mx-auto max-w-(--thread-width)">
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-card px-3 py-2 focus-within:border-ring">
          <textarea
            aria-label={`Message ${workerName}`}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message ${workerName}…`}
            className="block field-sizing-content max-h-48 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        {error !== undefined ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Not sent: {error} ·{" "}
            <button type="button" className="underline" onClick={() => send()}>
              Retry
            </button>
          </p>
        ) : null}
        {running ? <p className="mt-1 text-xs text-muted-foreground">{workerName} is answering · a line you send now waits for it</p> : null}
      </div>
    </form>
  );
}

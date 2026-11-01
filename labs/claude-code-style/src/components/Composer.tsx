import { interruptChordLabel, isSendKey } from "@flow-state-dev/react";
import type { FormEvent, KeyboardEvent } from "react";
import { useDraftSend } from "../lib/use-draft-send";

/**
 * The only place you type to the main session. Enter or Cmd+Enter (Ctrl+Enter)
 * sends, Shift+Enter is a new line. While a
 * turn runs, Send becomes Stop; a line you send then waits for the turn. Esc
 * here is the text box's: the stop keys are the thread's (Esc Esc, Cmd/Ctrl+.).
 *
 * A line stays in the box until its send lands ({@link useDraftSend}): a
 * failed one says why, with Retry. The draft is kept per session across a
 * reload.
 */
export function Composer({
  sessionId,
  running,
  armed = false,
  onSend,
  onStop,
}: {
  sessionId: string;
  running: boolean;
  /** A first Esc is waiting for its second: say so under the box. */
  armed?: boolean;
  /** Resolves once the line has landed; rejects with why it didn't. */
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const { text, setText, sending, failure, submit } = useDraftSend("claude-code-style:draft", sessionId);
  const send = () => submit(onSend);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // A key that ends an IME composition is the input method's, not a send or a stop (229: Safari's keydown for it).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (isSendKey(event, { enterSends: true })) {
      event.preventDefault();
      void send();
    }
  };
  return (
    <form onSubmit={onSubmit} className="px-6 pb-4">
      <div className="border border-border bg-card focus-within:border-ring">
        <textarea
          aria-label="Message the main session"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply to the main session…"
          className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          {running ? (
            <button
              type="button"
              onClick={onStop}
              className="border border-border px-3 py-1 text-sm font-semibold text-destructive hover:bg-accent"
            >
              Stop
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      {failure !== undefined ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Not sent: {failure} ·{" "}
          <button type="button" className="underline" onClick={() => void send()}>
            Retry
          </button>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">You talk only to the main session{running ? (armed ? " · press Esc again to stop the turn" : ` · Esc Esc or ${interruptChordLabel()} to stop the turn`) : ""}</p>
    </form>
  );
}

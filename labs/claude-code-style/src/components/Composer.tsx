import { interruptChordLabel, isSendKey } from "@flow-state-dev/react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useDraftSend } from "../lib/use-draft-send";

/**
 * Which coder a code change goes to, as the composer's chip offers it. *Auto* leaves the main
 * session's own pick (Claude Code); each other choice names the worker its `Coder:` line routes to
 * (the main and lead `WORKER.md` files read that line).
 */
export const CODER_CHOICES = ["Auto", "Plan first", "Codex", "Cursor"] as const;
export type CoderChoice = (typeof CODER_CHOICES)[number];

/**
 * The line you send, with the chip's choice on it: one plain `Coder: <choice>` line at the end, so
 * what the main session reads is what your line shows. *Auto* adds nothing.
 *
 * @param text What you typed, trimmed.
 * @param coder The chip's choice.
 */
export function withCoder(text: string, coder: CoderChoice): string {
  return coder === "Auto" ? text : `${text}\n\nCoder: ${coder}`;
}

/**
 * The only place you type to the main session. Enter or Cmd+Enter (Ctrl+Enter)
 * sends, Shift+Enter is a new line. While a
 * turn runs, Send becomes Stop; a line you send then waits for the turn. Esc
 * here is the text box's: the stop keys are the thread's (Esc Esc, Cmd/Ctrl+.).
 * The *Coder* chip picks who makes a code change you ask for: it holds for the
 * session while it is open, and rides on each line as {@link withCoder} writes it.
 *
 * A line stays in the box until its send lands ({@link useDraftSend}): a
 * failed one says why, with Retry. The draft is kept per session across a
 * reload.
 */
export function Composer({
  sessionId,
  running,
  armed = false,
  seed,
  onSend,
  onStop,
}: {
  /** A line to put in the box, as a starter line's click hands it; `at` makes a second click of the same line count. Never sent by itself. */
  seed?: { text: string; at: number };
  /** The session it types to; `/` and a session switch find its composer by it. */
  sessionId: string;
  running: boolean;
  /** A first Esc is waiting for its second: say so under the box. */
  armed?: boolean;
  /** Resolves once the line has landed; rejects with why it didn't. */
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [coder, setCoder] = useState<CoderChoice>("Auto");
  const { text, setText, sending, failure, submit } = useDraftSend("claude-code-style:draft", sessionId);
  const send = () => submit((line) => onSend(withCoder(line, coder)));
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (seed === undefined) return;
    setText(seed.text);
    box.current?.focus();
    // Only a new seed puts its line in the box; setText is the draft's own setter.
  }, [seed]);
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
          ref={box}
          aria-label="Message the main session"
          data-composer
          data-session-id={sessionId}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Reply to the main session…"
          className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <label className="mr-auto flex items-center gap-1 border border-border px-2 py-0.5 text-xs text-muted-foreground">
            Coder
            <select
              aria-label="Coder"
              value={coder}
              onChange={(event) => setCoder(event.target.value as CoderChoice)}
              className="bg-transparent text-foreground outline-none"
            >
              {CODER_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
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

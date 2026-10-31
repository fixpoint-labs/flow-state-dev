import { interruptChordLabel, isSendKey } from "@flow-state-dev/react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

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
 */
export function Composer({
  running,
  armed = false,
  onSend,
  onStop,
}: {
  running: boolean;
  /** A first Esc is waiting for its second: say so under the box. */
  armed?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [coder, setCoder] = useState<CoderChoice>("Auto");
  const send = () => {
    const line = text.trim();
    if (!line) return;
    setText("");
    onSend(withCoder(line, coder));
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // A key that ends an IME composition is the input method's, not a send or a stop (229: Safari's keydown for it).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (isSendKey(event, { enterSends: true })) {
      event.preventDefault();
      send();
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
            disabled={!text.trim()}
            className="bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">You talk only to the main session{running ? (armed ? " · press Esc again to stop the turn" : ` · Esc Esc or ${interruptChordLabel()} to stop the turn`) : ""}</p>
    </form>
  );
}

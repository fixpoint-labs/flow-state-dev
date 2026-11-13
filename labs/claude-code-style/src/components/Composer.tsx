import { interruptChordLabel, isSendKey, useDraftSend } from "@flow-state-dev/react";
import type { FileContent } from "@flow-state-dev/core/items";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "../lib/utils";
import { AttachButton, AttachmentStrip, useAttachments, type AttachmentUploader } from "./flow-state/attachments";

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
 * turn runs, Stop sits beside Send; a line you send then gets its own answer at
 * once, beside the running turn, as the main session's door starts every line. Esc
 * here is the text box's: the stop keys are the thread's (Esc Esc, Cmd/Ctrl+.).
 * The *Coder* chip picks who makes a code change you ask for: it holds for the
 * session while it is open, and rides on each line as {@link withCoder} writes it.
 *
 * Files come in by paste, the + button or a drop on the box, and show above
 * the text with a remove button each (the registry's `attachments`); a file
 * refused says why under them. Each uploads as it is added, so Send carries
 * references; Backspace in an empty box removes the last one.
 *
 * A line stays in the box until its send lands ({@link useDraftSend}): a
 * failed one says why, with Retry, and keeps its files. The text draft is kept
 * per session across a reload; files are not, and a session switch drops them.
 */
export function Composer({
  sessionId,
  running,
  stopping = false,
  stopRefused,
  armed = false,
  seed,
  uploader,
  onSend,
  onStop,
}: {
  /** A line to put in the box, as a starter line's click hands it; `at` makes a second click of the same line count. Never sent by itself. */
  seed?: { text: string; at: number };
  /** The session it types to; `/` and a session switch find its composer by it. */
  sessionId: string;
  running: boolean;
  /** A Stop is under way: the button waits until the turn has ended. */
  stopping?: boolean;
  /** Why the server refused the last Stop, shown beside the button. */
  stopRefused?: string;
  /** A first Esc is waiting for its second: say so under the box. */
  armed?: boolean;
  /** Where an attached file is stored. With none, a file is refused with a line that says so. */
  uploader?: AttachmentUploader;
  /** Resolves once the line has landed; rejects with why it didn't. */
  onSend: (text: string, attachments: FileContent[]) => Promise<void>;
  onStop: () => void;
}) {
  const [coder, setCoder] = useState<CoderChoice>("Auto");
  const attachments = useAttachments({ client: uploader, sessionId });
  const { text, setText, sending, failure, submit, canSend } = useDraftSend("claude-code-style:draft", sessionId, attachments);
  const send = () => submit((line, files) => onSend(withCoder(line, coder), files));
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
      return;
    }
    const last = attachments.files.at(-1);
    if (event.key === "Backspace" && event.currentTarget.value === "" && last !== undefined) {
      event.preventDefault();
      attachments.remove(last.id);
    }
  };
  return (
    <form onSubmit={onSubmit} className="px-6 pb-4">
      {/* The feed's own column, so the box and the lines above it share their edges. */}
      <div className="mx-auto max-w-2xl">
      <div
        {...attachments.dropTarget}
        data-dragging={attachments.dragging ? "true" : undefined}
        className={cn("rounded-xl border border-border/60 bg-card transition-colors focus-within:border-ring", attachments.dragging && "border-ring bg-accent/40")}
      >
        <AttachmentStrip attachments={attachments} className="px-3 empty:hidden" />
        <textarea
          ref={box}
          aria-label="Message the main session"
          data-composer
          data-session-id={sessionId}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={attachments.onPaste}
          placeholder="Reply to the main session…"
          className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <AttachButton attachments={attachments} className="size-7" />
          <label className="mr-auto flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
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
          {running && stopRefused !== undefined ? (
            <span role="alert" className="text-xs text-destructive">
              Not stopped: {stopRefused}
            </span>
          ) : null}
          {running || stopping ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className="rounded-md border border-border px-3 py-1 text-sm font-semibold text-destructive hover:bg-accent disabled:opacity-60"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!canSend || sending}
            className="rounded-md bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-40"
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
      <p className="mt-1.5 text-xs text-muted-foreground">You talk only to the main session{running ? (armed ? " · press Esc again to stop the turn" : ` · Esc Esc or ${interruptChordLabel()} to stop the turn`) : ""}</p>
      </div>
    </form>
  );
}

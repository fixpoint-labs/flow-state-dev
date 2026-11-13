import type { FileContent } from "@flow-state-dev/core/items";
import { interruptChordLabel, isSendKey, useDraftSend } from "@flow-state-dev/react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "../lib/utils";
import { AttachButton, AttachmentStrip, useAttachments, type AttachmentUploader } from "./flow-state/attachments";

/**
 * Where you type to the open worker. Enter or Cmd+Enter (Ctrl+Enter) sends,
 * Shift+Enter is a new line.
 * A line sent while the worker answers gets its own answer at once, beside
 * the one already running: the worker's door starts every line you send. It sits in the
 * conversation's column (`--thread-width`), and the box grows with what you
 * type up to a cap, then scrolls.
 *
 * Files come in by paste, the + button or a drop on the box, and show above
 * the text with a remove button each (the registry's `attachments`); a file
 * refused says why under them. Each uploads as it is added, so Send carries
 * references; Backspace in an empty box removes the last one. A box with
 * files and no text sends too.
 *
 * A line stays in the box until its send lands, so a failed send loses
 * nothing: the box keeps it and its files and says why, with Retry. A send
 * that lands clears the box, unless something else was typed meanwhile. The
 * text draft is kept per conversation across a reload; files are not, and a
 * switch drops them.
 *
 * While the worker answers, Stop sits beside Send and stops every turn it is
 * answering; it reads *Stopping…* until they have ended, and a refused stop
 * says why beside it.
 *
 * A `prefill` (a popup's "Ask … to follow up") adds its words to the box,
 * after a blank line when something is already typed, and puts the cursor at
 * the end; nothing is sent. It calls `onPrefilled` once the words are in, so
 * the parent drops them: a box that closes and reopens (a switch away and
 * back) must not add them again.
 */
export function Composer({
  sessionId,
  workerName,
  running,
  stopping = false,
  stopRefused,
  armed = false,
  onStop,
  seed,
  uploader,
  onSend,
  prefill,
  onPrefilled,
}: {
  /** A line to put in the box, as a starter line's click hands it; `at` makes a second click of the same line count. Never sent by itself. */
  seed?: { text: string; at: number };
  /** The conversation it types to; `/` and a switch find its composer by it. */
  sessionId: string;
  workerName: string;
  running: boolean;
  /** A Stop is under way: the button waits until the turns have ended. */
  stopping?: boolean;
  /** Why the server refused the last Stop, shown beside the button. */
  stopRefused?: string;
  /** A first Esc is waiting for its second: say so under the box. */
  armed?: boolean;
  /** Stop the worker's answering turns. */
  onStop: () => void;
  /** Where an attached file is stored. With none, a file is refused with a line that says so. */
  uploader?: AttachmentUploader;
  /** Resolves once the line has landed; rejects with why it didn't. */
  onSend: (text: string, attachments: FileContent[]) => Promise<void>;
  /** Words to add to the box, once per `n`. */
  prefill?: { text: string; n: number };
  /** Called once `prefill`'s words are in the box, for the parent to drop them. */
  onPrefilled?: () => void;
}) {
  const attachments = useAttachments({ client: uploader, sessionId });
  const { text, setText, sending: busy, failure: error, submit, canSend } = useDraftSend("teammates:draft", sessionId, attachments);
  const current = useRef(text);
  current.current = text;
  const box = useRef<HTMLTextAreaElement>(null);
  const applied = useRef(0);
  const toEnd = useRef(false);
  useEffect(() => {
    if (prefill === undefined || prefill.n === applied.current) return;
    applied.current = prefill.n;
    const typed = current.current.trimEnd();
    toEnd.current = true;
    setText(typed === "" ? prefill.text : `${typed}\n\n${prefill.text}`);
    onPrefilled?.();
  }, [prefill, setText, onPrefilled]);
  useEffect(() => {
    if (!toEnd.current) return;
    toEnd.current = false;
    box.current?.focus();
    box.current?.setSelectionRange(text.length, text.length);
  }, [text]);
  useEffect(() => {
    if (seed === undefined) return;
    setText(seed.text);
    box.current?.focus();
  }, [seed]);
  const send = () => {
    if (!canSend || busy) return;
    void submit(onSend);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSendKey(event, { enterSends: true })) {
      event.preventDefault();
      send();
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
      <div data-column className="mx-auto max-w-(--thread-width)">
        <div
          {...attachments.dropTarget}
          data-dragging={attachments.dragging ? "true" : undefined}
          className={cn("rounded-3xl border border-border bg-card px-3 py-2 focus-within:border-ring", attachments.dragging && "border-ring bg-accent/40")}
        >
          <AttachmentStrip attachments={attachments} className="px-1 pb-1 empty:hidden" />
          <div className="flex items-end gap-2">
          <AttachButton attachments={attachments} className="rounded-full" />
          <textarea
            ref={box}
            aria-label={`Message ${workerName}`}
            data-composer
            data-session-id={sessionId}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={attachments.onPaste}
            placeholder={`Message ${workerName}…`}
            className="block field-sizing-content max-h-48 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          {running || stopping ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className="rounded-full border border-border px-3 py-1 text-sm font-semibold text-destructive hover:bg-accent disabled:opacity-60"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!canSend || busy}
            className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Sending…" : "Send"}
          </button>
          </div>
        </div>
        {running && stopRefused !== undefined ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Not stopped: {stopRefused}
          </p>
        ) : null}
        {error !== undefined ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Not sent: {error} ·{" "}
            <button type="button" className="underline" onClick={() => send()}>
              Retry
            </button>
          </p>
        ) : null}
        {running ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {workerName} is answering · a line you send now gets its own answer at once ·{" "}
            {armed ? "press Esc again to stop" : `Esc Esc or ${interruptChordLabel()} to stop`}
          </p>
        ) : null}
      </div>
    </form>
  );
}

import type { FileContent } from "@flow-state-dev/core/items";
import { interruptChordLabel, isSendKey, useDraftSend } from "@flow-state-dev/react";
import { ArrowUpIcon, ChevronDownIcon, TerminalIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { harnessName, harnessState, harnessWarning, withHarness, type HarnessState } from "../lib/harness";
import { cn } from "../lib/utils";
import { AttachButton, AttachmentStrip, useAttachments, type AttachmentUploader } from "./flow-state/attachments";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";

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
 *
 * The toolbar under the text picks the harness a coding task you ask for runs
 * on: the lab's default until you pick another, which then rides on each line
 * as one `Coding harness: …` line (`withHarness`) while the conversation is
 * open. When that harness can't run here, a warning under the box says why
 * before you send and offers the harnesses that can; nothing is blocked, since
 * most lines ask for no coding at all.
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
  harnesses,
  defaultHarness,
  replyModel,
}: {
  /** Which coding harnesses can run here, or `undefined` while the first read is out. No rows: no harness picker. */
  harnesses?: readonly HarnessReadinessChipRow[];
  /** The harness a coding task runs on when none is picked (the lab's default). */
  defaultHarness?: string;
  /** The model the teammate's own replies run on, so the picker can say it doesn't choose that. */
  replyModel?: string;
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
  // The harness picked for this conversation; a switch to another conversation starts from the default again.
  const [pick, setPick] = useState<{ sessionId: string; harness: string }>();
  const picked = pick?.sessionId === sessionId ? pick.harness : undefined;
  const choose = (harness: string) => setPick({ sessionId, harness });
  const coding = picked ?? defaultHarness;
  const warning = harnessWarning(harnesses, coding);
  const labelId = useId();
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
    void submit((typed, files) => onSend(withHarness(typed, picked, defaultHarness), files));
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
          className={cn(
            "rounded-xl border border-border-strong bg-surface shadow-[0_8px_28px_-12px_rgb(0_0_0/0.7)] focus-within:border-ring",
            attachments.dragging && "border-ring bg-accent/40",
          )}
        >
          <AttachmentStrip attachments={attachments} className="px-3 pt-3 empty:hidden" />
          <label htmlFor={labelId} className="sr-only">
            Message {workerName}
          </label>
          <textarea
            ref={box}
            id={labelId}
            data-composer
            data-session-id={sessionId}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={attachments.onPaste}
            placeholder={`Message ${workerName}…`}
            className="block field-sizing-content max-h-48 min-h-14 w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-[14.5px] leading-[1.6] outline-none placeholder:text-text-3"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <AttachButton
              attachments={attachments}
              className="size-8 rounded-sm text-text-2 hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
            {harnesses !== undefined && harnesses.length > 0 ? (
              <HarnessPicker rows={harnesses} current={coding} fallback={defaultHarness} onPick={choose} workerName={workerName} replyModel={replyModel} />
            ) : null}
            <span className="ml-auto hidden font-mono text-[11px] text-text-3 sm:inline">⏎ send · ⇧⏎ newline</span>
            {running || stopping ? (
              <button
                type="button"
                onClick={onStop}
                disabled={stopping}
                className="h-8 rounded-sm border border-border-strong px-3 text-xs font-semibold text-destructive hover:bg-surface-raised disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {stopping ? "Stopping…" : "Stop"}
              </button>
            ) : null}
            <button
              type="submit"
              aria-label={busy ? "Sending…" : "Send"}
              title={busy ? "Sending…" : "Send"}
              disabled={!canSend || busy}
              className="grid size-8 place-items-center rounded-sm bg-brand text-brand-foreground hover:brightness-110 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowUpIcon className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        {warning === undefined ? null : (
          <p role="status" data-testid="harness-warning" className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-warning-text">
            <span>
              {warning.label} can't run coding tasks here{warning.why === null ? "" : `: ${warning.why}`}.
            </span>
            {warning.ready.length === 0 ? (
              <span>No coding harness is ready.</span>
            ) : (
              <>
                <span>Use</span>
                {warning.ready.map((row) => (
                  <button
                    key={row.harness}
                    type="button"
                    onClick={() => choose(row.harness)}
                    className="rounded-sm border border-warning-line bg-warning-soft px-2 py-0.5 font-medium text-warning-text hover:brightness-125 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {row.label}
                  </button>
                ))}
              </>
            )}
          </p>
        )}
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

const DOT: Record<HarnessState, string> = { ready: "bg-success", "not-ready": "bg-warning", unknown: "bg-presence-idle" };
const STATE_WORDS: Record<HarnessState, string> = { ready: "ready", "not-ready": "not ready", unknown: "not checked" };

/**
 * The toolbar's harness picker: a dot for whether the current harness can run
 * here and its name; opens a list of every harness with the same dot, the
 * default marked. Esc or a click elsewhere closes it, and Esc there never
 * counts toward the composer's Esc Esc stop.
 */
function HarnessPicker({
  rows,
  current,
  fallback,
  onPick,
  workerName,
  replyModel,
}: {
  rows: readonly HarnessReadinessChipRow[];
  current: string | undefined;
  fallback: string | undefined;
  onPick: (harness: string) => void;
  workerName: string;
  replyModel: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const row = rows.find((r) => r.harness === current);
  const state = row === undefined ? "unknown" : harnessState(row);
  const name = row?.label ?? (current === undefined ? "Harness" : harnessName(current));
  // It picks where coding tasks start, never what the teammate itself answers on: say both.
  const replies = replyModel === undefined ? `${workerName}'s own replies don't use it.` : `${workerName}'s replies use ${replyModel.slice(replyModel.lastIndexOf("/") + 1) || replyModel}.`;
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Code with ${name}, ${STATE_WORDS[state]}`}
        title={`Coding tasks start on this harness. ${replies}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-text-2 hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        {/* The task cards' terminal mark: this picks where coding tasks start. */}
        <TerminalIcon aria-hidden className="size-3.5 text-text-3" />
        <span className="text-text-3">Code with</span>
        <span aria-hidden className={cn("size-1.5 rounded-full", DOT[state])} />
        <span className="text-foreground">{name}</span>
        <ChevronDownIcon aria-hidden className="size-3.5" />
      </button>
      {open ? (
        <div role="menu" aria-label="Start coding tasks on" className="absolute bottom-full left-0 z-20 mb-1 min-w-52 rounded-md border border-border-strong bg-surface p-1 shadow-lg">
          <div aria-hidden className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-text-3 uppercase">
            Start coding tasks on
          </div>
          {rows.map((r) => {
            const s = harnessState(r);
            return (
              <button
                key={r.harness}
                type="button"
                role="menuitemradio"
                aria-checked={r.harness === current}
                onClick={() => {
                  onPick(r.harness);
                  setOpen(false);
                  button.current?.focus();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-ring",
                  r.harness === current && "bg-surface-raised",
                )}
              >
                <span aria-hidden className={cn("size-1.5 rounded-full", DOT[s])} />
                <span className="text-foreground">{r.label}</span>
                {r.harness === fallback ? <span className="text-text-3">default</span> : null}
                <span className="ml-auto text-text-3">{STATE_WORDS[s]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

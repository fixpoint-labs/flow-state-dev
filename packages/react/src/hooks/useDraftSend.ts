/**
 * `useDraftSend`: a message box's text and its send. The text stays in the box
 * until the send lands, so a failed send loses nothing. Composed from
 * {@link useDraft} (the text, kept per id across a reload) and
 * {@link useSubmit} (the hold and the refusal). Given the box's files, they go
 * with the line the same way.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { useRef } from "react";
import { clearDraft, useDraft } from "./useDraft";
import { useSubmit } from "./useSubmit";

/** Where a box's line goes: resolves once the line has landed, rejects with why it didn't. */
export type DraftSendFn = (line: string, files: FileContent[]) => Promise<unknown>;

/**
 * The box's files, as its attachment strip holds them: only what a send reads.
 * `R` is the strip's refusal line, handed back to `consume` as it was read.
 */
export interface DraftSendAttachments<R = unknown> {
  /** The files in the box. A `"refused"` one is shown, never sent. */
  files: readonly { id: string; status: string }[];
  /** The refusal lines on screen. */
  refusals: R[];
  /** Waits for the uploads in flight, then resolves to the uploaded files' references. */
  settle: () => Promise<FileContent[]>;
  /** After a send landed: removes the files in `ids` that went, and the refusal lines in `shown`. */
  consume: (ids: string[], shown: R[]) => void;
}

/** What `useDraftSend` returns. */
export interface DraftSend {
  /** The box's text. */
  text: string;
  /** Sets the box's text, storing it as the draft. */
  setText: (text: string) => void;
  /** `true` while a send runs. A second `submit` meanwhile does nothing. */
  sending: boolean;
  /** Why the last send failed, or `undefined`. The text and files stay in the box, for a Retry. */
  failure: string | undefined;
  /** Send the box's text and files through `send`. A box with nothing to send sends nothing. Never throws. */
  submit: (send: DraftSendFn) => Promise<void>;
  /** `true` when the box holds text, or a file that isn't refused. */
  canSend: boolean;
}

/**
 * A message box's text and its send, for the box at `namespace`/`id` (see
 * {@link useDraft}). A send that lands clears the box, unless something else
 * was typed while it ran; one that fails keeps the text and holds why in
 * `failure`.
 *
 * With `attachments`, the send waits for the box's uploads and carries their
 * references; the files leave the box only once it lands. A box with files and
 * no text sends too. A file added while a send waits stays for the next one.
 */
export function useDraftSend<R>(namespace: string, id: string, attachments?: DraftSendAttachments<R>): DraftSend {
  const [text, setText] = useDraft(namespace, id);
  const current = useRef(text);
  current.current = text;
  const run = useSubmit(async (typed: string, send: DraftSendFn) => {
    // The files on screen at the press: one added while this send waits stays for the next.
    const ids = attachments?.files.map((file) => file.id) ?? [];
    const shown = attachments?.refusals ?? [];
    // A line with no files goes at once, with nothing to wait on.
    const files = attachments === undefined || ids.length === 0 ? [] : await attachments.settle();
    // Every file was refused while it uploaded: with no text there is nothing to send, and the lines say why.
    if (!typed.trim() && files.length === 0) return;
    await send(typed.trim(), files);
    attachments?.consume(ids, shown);
    // The box may have closed and reopened while it ran: the stored draft goes only if it is still this line.
    clearDraft(namespace, id, typed);
    if (current.current === typed) setText("");
  });
  const hasFiles = (attachments?.files ?? []).some((file) => file.status !== "refused");
  const submit = async (send: DraftSendFn) => {
    if (!text.trim() && !hasFiles) return;
    await run.submit(undefined, text, send);
  };
  return { text, setText, sending: run.busy, failure: run.error, submit, canSend: text.trim() !== "" || hasFiles };
}

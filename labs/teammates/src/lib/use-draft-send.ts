/**
 * A message box's text and its send: the text stays in the box until the send
 * lands, so a failed send loses nothing. A send that lands clears the box,
 * unless something else was typed while it ran; one that fails keeps the text
 * and holds why, for the box to show with Retry. The draft is kept per `id`
 * (a session, a task) across a reload. The hold and the refusal are react's
 * `useSubmit`, so a second send while one runs does nothing.
 *
 * With `attachments`, the box's files go with its text the same way: the send
 * waits for their uploads and carries their references, and they leave the box
 * only once it lands. A box with files and no text sends too.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { clearDraft, useDraft, useSubmit } from "@flow-state-dev/react";
import { useRef } from "react";
import type { Attachments } from "../components/flow-state/attachments";

export function useDraftSend(namespace: string, id: string, attachments?: Attachments) {
  const [text, setText] = useDraft(namespace, id);
  const current = useRef(text);
  current.current = text;
  const run = useSubmit(async (typed: string, send: (line: string, files: FileContent[]) => Promise<unknown>) => {
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
  /** Send the box's text and files through `send`, which resolves once the line has landed. */
  const submit = async (send: (line: string, files: FileContent[]) => Promise<unknown>) => {
    if (!text.trim() && !hasFiles) return;
    await run.submit(undefined, text, send);
  };
  return { text, setText, sending: run.busy, failure: run.error, submit, canSend: text.trim() !== "" || hasFiles };
}

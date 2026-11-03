/**
 * A message box's text and its send: the text stays in the box until the send
 * lands, so a failed send loses nothing. A send that lands clears the box,
 * unless something else was typed while it ran; one that fails keeps the text
 * and holds why, for the box to show with Retry. The draft is kept per `id`
 * (a session, a task) across a reload. The hold and the refusal are react's
 * `useSubmit`, so a second send while one runs does nothing.
 */
import { clearDraft, useDraft, useSubmit } from "@flow-state-dev/react";
import { useRef } from "react";

export function useDraftSend(namespace: string, id: string) {
  const [text, setText] = useDraft(namespace, id);
  const current = useRef(text);
  current.current = text;
  const run = useSubmit(async (typed: string, send: (line: string) => Promise<unknown>) => {
    await send(typed.trim());
    // The box may have closed and reopened while it ran: the stored draft goes only if it is still this line.
    clearDraft(namespace, id, typed);
    if (current.current === typed) setText("");
  });
  /** Send the box's text through `send`, which resolves once the line has landed. */
  const submit = async (send: (line: string) => Promise<unknown>) => {
    if (!text.trim()) return;
    await run.submit(undefined, text, send);
  };
  return { text, setText, sending: run.busy, failure: run.error, submit };
}

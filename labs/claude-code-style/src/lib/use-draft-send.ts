/**
 * A message box's text and its send: the text stays in the box until the send
 * lands, so a failed send loses nothing. A send that lands clears the box,
 * unless something else was typed while it ran; one that fails keeps the text
 * and holds why, for the box to show with Retry. The draft is kept per `id`
 * (a session, a task) across a reload.
 */
import { clearDraft, useDraft } from "@flow-state-dev/react";
import { useRef, useState } from "react";

export function useDraftSend(namespace: string, id: string) {
  const [text, setText] = useDraft(namespace, id);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const current = useRef(text);
  current.current = text;
  /** Send the box's text through `send`, which resolves once the line has landed. */
  const submit = async (send: (line: string) => Promise<unknown>) => {
    const typed = text;
    const line = typed.trim();
    if (!line || sending) return;
    setSending(true);
    setFailure(undefined);
    try {
      await send(line);
      // The box may have closed and reopened while it ran: the stored draft goes only if it is still this line.
      clearDraft(namespace, id, typed);
      if (current.current === typed) setText("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
  return { text, setText, sending, failure, submit };
}

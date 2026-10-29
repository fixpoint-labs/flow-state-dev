import { useState, type FormEvent, type KeyboardEvent } from "react";

/**
 * Where you type to the open worker. Enter sends, Shift+Enter is a new line.
 * A line sent while the worker answers waits for that answer.
 */
export function Composer({ workerName, running, onSend }: { workerName: string; running: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const line = text.trim();
    if (!line) return;
    setText("");
    onSend(line);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter that ends an input method's composition (CJK and the like) picks the text; it doesn't send.
    // Safari fires that Enter after compositionend, so isComposing is false there; keyCode 229 still marks it.
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <form onSubmit={onSubmit} className="px-6 pb-4">
      <div className="flex items-end gap-2 rounded-3xl border border-border bg-card px-3 py-2 focus-within:border-ring">
        <textarea
          aria-label={`Message ${workerName}`}
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message ${workerName}…`}
          className="block flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {running ? <p className="mt-1 text-xs text-muted-foreground">{workerName} is answering · a line you send now waits for it</p> : null}
    </form>
  );
}

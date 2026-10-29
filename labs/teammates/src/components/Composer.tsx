import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

/**
 * Where you type to the open worker. Enter sends, Shift+Enter is a new line.
 * A line sent while the worker answers waits for that answer. It sits in the
 * conversation's column (`--thread-width`), and the box grows with what you
 * type up to a cap, then scrolls.
 */
export function Composer({ workerName, running, onSend }: { workerName: string; running: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // Fit the box to its text: shrink to one line, then grow to the content (the CSS caps it).
  useLayoutEffect(() => {
    if (box.current) fitToText(box.current);
  }, [text]);
  // The column narrows or widens when Talk toggles, which rewraps the draft: fit again on a width change.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitToText(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
      <div data-column className="mx-auto max-w-(--thread-width)">
        <div className="flex items-end gap-2 rounded-3xl border border-border bg-card px-3 py-2 focus-within:border-ring">
          <textarea
            ref={box}
            aria-label={`Message ${workerName}`}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Message ${workerName}…`}
            className="block max-h-48 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
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
      </div>
    </form>
  );
}

function fitToText(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

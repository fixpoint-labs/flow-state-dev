import { useState, type FormEvent, type KeyboardEvent } from "react";

/**
 * The only place you type. Enter sends, Shift+Enter is a new line. While a
 * turn runs, Send becomes Stop; a line you send then waits for the turn.
 */
export function Composer({
  running,
  onSend,
  onStop,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
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
    // Enter that confirms an IME composition is not a send (229: Safari's keydown for it).
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape" && running) {
      onStop();
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
      <p className="mt-1 text-xs text-muted-foreground">You talk only to the main session{running ? " · Esc to stop the turn" : ""}</p>
    </form>
  );
}

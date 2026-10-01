/**
 * A composer that sends a person's line to a worker (S11): a task's, Inbox's
 * reply box, and the workstream composer when its line starts with `@`.
 *
 * It only draws. Where the line goes, and whether it can go at all, is the
 * caller's; the send itself is {@link sendTurn}'s, the one send path. The
 * composer shows *sending* until that resolves, and *delivered* only when it
 * does (BR-4). A refusal keeps the draft and shows the worker's reason
 * (BR-5); a line that never got there keeps the draft and offers Retry.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { TurnNotDelivered } from "../lib/send";

/** Where the last send stands. */
type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "delivered" }
  | { kind: "refused"; reason: string }
  | { kind: "not-sent"; reason: string };

export function TurnComposer({
  testId,
  label,
  placeholder,
  blocked,
  send,
  onDelivered,
  extra,
}: {
  testId: string;
  label: string;
  placeholder: string;
  /** Why nothing can be sent right now, or `null` when it can. */
  blocked: string | null;
  /** Send the line; resolves once it is delivered. */
  send: (message: string) => Promise<void>;
  onDelivered?: (message: string) => void;
  /** Controls drawn beside Send. */
  extra?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const sending = state.kind === "sending";
  const canSend = blocked === null && draft.trim().length > 0 && !sending;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const message = draft.trim();
    setState({ kind: "sending" });
    try {
      await send(message);
      if (!mounted.current) return;
      setDraft("");
      setState({ kind: "delivered" });
      onDelivered?.(message);
    } catch (error) {
      if (!mounted.current) return;
      const reason = error instanceof Error ? error.message : String(error);
      setState(error instanceof TurnNotDelivered && error.kind === "refused" ? { kind: "refused", reason } : { kind: "not-sent", reason });
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="border-t p-3" data-testid={testId}>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (state.kind === "delivered") setState({ kind: "idle" });
        }}
        disabled={blocked !== null}
        rows={2}
        placeholder={placeholder}
        aria-label={label}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
        data-testid={`${testId}-input`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-status`} data-state={blocked !== null ? "blocked" : state.kind}>
          {blocked !== null ? (
            <span data-testid={`${testId}-blocked`}>{blocked}</span>
          ) : state.kind === "sending" ? (
            "Sending… shown as delivered once the worker's session holds it."
          ) : state.kind === "delivered" ? (
            "Delivered."
          ) : state.kind === "refused" ? (
            <span role="alert" className="text-destructive" data-testid={`${testId}-error`}>
              {state.reason}
            </span>
          ) : state.kind === "not-sent" ? (
            <span role="alert" className="text-destructive" data-testid={`${testId}-error`}>
              Not sent: {state.reason}{" "}
              <button type="button" className="underline" onClick={() => void submit()} data-testid={`${testId}-retry`}>
                Retry
              </button>
            </span>
          ) : null}
        </p>
        {extra}
        <button
          type="submit"
          disabled={!canSend}
          data-testid={`${testId}-send`}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </form>
  );
}

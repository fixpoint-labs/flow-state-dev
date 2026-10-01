/**
 * A composer that sends a person's line to a worker (S11): a task's, and
 * Inbox's reply box. The workstream composer, which also posts to its channel,
 * uses the same send state for its `@worker` lines: {@link useTurnSend} and
 * {@link TurnSendStatus}.
 *
 * It only draws. Where the line goes, and whether it can go at all, is the
 * caller's; the send itself is {@link sendTurn}'s, the one send path. The
 * composer shows *sending* until that resolves, and *delivered* only when it
 * does (BR-4). A refusal keeps the draft and shows the worker's reason
 * (BR-5). A line that never got there keeps the draft and offers Retry. A line
 * that may have arrived keeps the draft and offers no Retry, so it isn't sent
 * twice.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { TurnNotDelivered } from "../lib/send";

/** Where the last send stands. */
export type TurnSendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "delivered" }
  | { kind: "refused"; reason: string }
  | { kind: "not-sent"; reason: string }
  | { kind: "unconfirmed"; reason: string };

/**
 * The send state one composer keeps: run a send, and land on *delivered* or
 * on why not. `run` resolves `true` once the line is delivered.
 */
export function useTurnSend() {
  const [state, setState] = useState<TurnSendState>({ kind: "idle" });
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const run = useCallback(async (send: () => Promise<void>): Promise<boolean> => {
    setState({ kind: "sending" });
    try {
      await send();
      if (mounted.current) setState({ kind: "delivered" });
      return mounted.current;
    } catch (error) {
      if (!mounted.current) return false;
      const reason = error instanceof Error ? error.message : String(error);
      // Anything else is a fault in shift-manager, not an answer about the line,
      // which may have gone: say so, and offer no resend.
      if (!(error instanceof TurnNotDelivered)) console.error("shift-manager: sending a line failed", error);
      setState({ kind: error instanceof TurnNotDelivered ? error.kind : "unconfirmed", reason });
      return false;
    }
  }, []);
  /** Drop a *delivered* once the person starts a new line; a failure stays until the next send. */
  const reset = useCallback(() => setState((s) => (s.kind === "delivered" ? { kind: "idle" } : s)), []);
  /** Forget the last send, whatever it came to. */
  const clear = useCallback(() => setState({ kind: "idle" }), []);
  return { state, run, reset, clear };
}

/** What a send's state says, with Retry only for a line that never got there. */
export function TurnSendStatus({ state, testId, onRetry }: { state: TurnSendState; testId: string; onRetry: () => void }) {
  if (state.kind === "sending") return <>Sending… shown as delivered once the worker's session holds it.</>;
  if (state.kind === "delivered") return <>Delivered.</>;
  if (state.kind === "idle") return null;
  return (
    <span role="alert" className="text-destructive" data-testid={`${testId}-error`}>
      {state.kind === "not-sent" ? `Not sent: ${state.reason}` : state.reason}
      {state.kind === "not-sent" ? (
        <>
          {" "}
          <button type="button" className="underline" onClick={onRetry} data-testid={`${testId}-retry`}>
            Retry
          </button>
        </>
      ) : null}
    </span>
  );
}

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
  const { state, run, reset } = useTurnSend();

  const sending = state.kind === "sending";
  const canSend = blocked === null && draft.trim().length > 0 && !sending;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const message = draft.trim();
    if (await run(() => send(message))) {
      setDraft("");
      onDelivered?.(message);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="border-t p-3" data-testid={testId}>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          reset();
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
          ) : (
            <TurnSendStatus state={state} testId={testId} onRetry={() => void submit()} />
          )}
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

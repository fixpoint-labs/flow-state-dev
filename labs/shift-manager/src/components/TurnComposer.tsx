/**
 * A composer that sends a person's line to a worker (S11): a task's, and
 * Inbox's reply box. The workstream composer, which also posts to its mailbox,
 * uses the same send state for its `@worker` lines: {@link useTurnSend} and
 * {@link TurnSendStatus}.
 *
 * It only draws. Where the line goes, and whether it can go at all, is the
 * caller's; the send itself is {@link sendTurn}'s, the one send path. The
 * composer shows *sending* until the worker's session holds the line. Then the
 * line leaves the draft, since the conversation now holds it, and the composer
 * says the worker is on it until the send resolves. It shows *delivered* only
 * when it does (BR-4), noting Inbox when the worker stopped on a person's ask
 * (a chief of staff's fire, say), or that it waits when it stopped on anything else. A refusal keeps the draft and shows the worker's reason
 * (BR-5). A line that never got there keeps the draft and offers Retry. A line
 * that may have arrived keeps the draft and offers no Retry, so it isn't sent
 * twice. A line that failed after it left the draft is put back, unless the
 * person has started another.
 *
 * Every composer draws through {@link ComposerShell}, v2's composer: one line,
 * sent with ⏎ (Enter). Most composers are a
 * 14px input over a mono footer that holds the send state and ⏎ (v2:305-309,
 * 430-433, 639-644); Chief of Staff's is the larger one, a 16px input in a
 * 1.5px ink box with ⏎ beside it and the send state under it (v2:175-178).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { TurnNotDelivered, type TurnStop } from "../lib/send";

/** Where the last send stands. */
export type TurnSendState =
  | { kind: "idle" }
  | { kind: "sending" }
  /** The session holds the line; the worker's turn on it hasn't ended. */
  | { kind: "held" }
  /** `stopped`: what the worker's turn stopped on, as {@link sendTurn} says. */
  | { kind: "delivered"; stopped: TurnStop }
  | { kind: "refused"; reason: string }
  | { kind: "not-sent"; reason: string }
  | { kind: "unconfirmed"; reason: string };

/**
 * The send state one composer keeps: run a send, and land on *delivered* or
 * on why not. `run` resolves `true` once the line is delivered. A send may
 * resolve `{ stopped }`, as {@link sendTurn} does, to say what the worker stopped on,
 * and may call the `held` it is handed once the session holds the line.
 */
export function useTurnSend() {
  const [state, setState] = useState<TurnSendState>({ kind: "idle" });
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const run = useCallback(async (send: (held: () => void) => Promise<void | { stopped: TurnStop }>): Promise<boolean> => {
    setState({ kind: "sending" });
    try {
      const sent = await send(() => {
        if (mounted.current) setState((s) => (s.kind === "sending" ? { kind: "held" } : s));
      });
      if (mounted.current) setState({ kind: "delivered", stopped: sent?.stopped ?? null });
      return mounted.current;
    } catch (error) {
      if (!mounted.current) return false;
      const reason = error instanceof Error ? error.message : String(error);
      // Anything else is a fault in Shift Manager, not an answer about the line,
      // which may have gone: say so, and offer no resend.
      if (!(error instanceof TurnNotDelivered)) console.error("Shift Manager: sending a line failed", error);
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
  if (state.kind === "sending") return <>Sending…</>;
  if (state.kind === "held") return <>Sent. Waiting on the worker's reply…</>;
  if (state.kind === "delivered") {
    if (state.stopped === "ask") return <>Delivered. The worker stopped to ask you something; it's in Inbox.</>;
    if (state.stopped === "wait") return <>Delivered. The worker is waiting on something before it carries on.</>;
    return <>Delivered.</>;
  }
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

/**
 * The one composer markup every composer draws through: v2's one-line input
 * over a mono footer (or Chief of Staff's larger box), with the send state in
 * the footer and ⏎ at its end. It only draws: the draft, what Send does and
 * the state shown are the caller's. `lead` sits before the status in the
 * footer (the workstream's `@name` chips and task picker); `extra` sits beside
 * ⏎ (a task's also-post toggle).
 */
export function ComposerShell({
  testId,
  label,
  placeholder,
  draft,
  onDraft,
  disabled = false,
  canSend,
  onSubmit,
  sendLabel = "Send",
  status,
  statusState,
  lead,
  extra,
  above,
  scale = "default",
}: {
  testId: string;
  label: string;
  placeholder: string;
  draft: string;
  onDraft: (draft: string) => void;
  disabled?: boolean;
  canSend: boolean;
  onSubmit: (event: FormEvent) => void;
  /** The send button's accessible name. */
  sendLabel?: string;
  status: ReactNode;
  /** `data-state` on the status: what the composer is doing. */
  statusState: string;
  lead?: ReactNode;
  extra?: ReactNode;
  /** Drawn above Chief of Staff's box: its suggestions (v2:174). */
  above?: ReactNode;
  /** `cos`: Chief of Staff's larger composer (v2:175-178). */
  scale?: "default" | "cos";
}) {
  const input = (
    <input
      type="text"
      value={draft}
      onChange={(e) => onDraft(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={label}
      className={`block w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground disabled:opacity-60 ${
        scale === "cos" ? "p-4 text-base" : "px-3 py-[11px] text-sm"
      }`}
      data-testid={`${testId}-input`}
      data-look="composer-input"
    />
  );
  const statusLine = (
    <span className="min-w-0" data-testid={`${testId}-status`} data-state={statusState}>
      {status}
    </span>
  );
  const sendButton = (
    <button
      type="submit"
      disabled={!canSend}
      aria-label={sendLabel}
      data-testid={`${testId}-send`}
      data-look="composer-send"
      className={`shrink-0 bg-primary font-mono font-medium text-primary-foreground hover:bg-info disabled:opacity-50 ${
        scale === "cos" ? "m-2 px-3 py-2 text-xs" : "px-[9px] py-1"
      }`}
    >
      ⏎
    </button>
  );

  return (
    <form onSubmit={onSubmit} className={scale === "cos" ? "flex flex-col gap-2.5" : "px-[22px] pt-2.5 pb-4"} data-testid={testId}>
      {scale === "cos" ? (
        <>
          {above}
          <div className="flex items-center border-[1.5px] border-foreground bg-card" data-look="composer">
            {input}
            {extra}
            {sendButton}
          </div>
          <div className="font-mono text-[11px] font-medium text-muted-foreground" data-look="composer-footer">
            {lead}
            {statusLine}
          </div>
        </>
      ) : (
        <div className="border border-foreground bg-card" data-look="composer">
          {input}
          <div
            className="flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1 border-t border-foreground/10 py-1.5 pr-2 pl-3 font-mono text-[11px] font-medium text-muted-foreground"
            data-look="composer-footer"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-3.5">
              {lead}
              {statusLine}
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              {extra}
              {sendButton}
            </span>
          </div>
        </div>
      )}
    </form>
  );
}

/** A composer whose line goes to one worker: {@link ComposerShell} with {@link useTurnSend}'s state. */
export function TurnComposer({
  testId,
  label,
  placeholder,
  blocked,
  send,
  onHeld,
  onDelivered,
  extra,
  suggestions,
  scale = "default",
}: {
  testId: string;
  label: string;
  placeholder: string;
  /** Why nothing can be sent right now, or `null` when it can. */
  blocked: string | null;
  /**
   * Send the line; resolves once it is delivered, with {@link sendTurn}'s `stopped` when it has it.
   * Call `held` once the worker's session holds the line ({@link sendTurn}'s `onHeld`).
   */
  send: (message: string, held: () => void) => Promise<void | { stopped: TurnStop }>;
  /** The line has left the draft: the worker's session holds it, or it was delivered. */
  onHeld?: (message: string) => void;
  onDelivered?: (message: string) => void;
  /** Controls drawn beside Send. */
  extra?: ReactNode;
  /**
   * Lines offered above Chief of Staff's box as v2's dashed chips (v2:174).
   * A click only puts the line in the draft; nothing is sent until Send.
   */
  suggestions?: readonly string[];
  /** `cos`: Chief of Staff's larger composer (v2:175-178). */
  scale?: "default" | "cos";
}) {
  const [draft, setDraft] = useState("");
  const { state, run, reset } = useTurnSend();

  const sending = state.kind === "sending" || state.kind === "held";
  const canSend = blocked === null && draft.trim().length > 0 && !sending;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const submitted = draft;
    const message = draft.trim();
    let left = false;
    // The line leaves the draft once the session holds it: only the line that
    // was sent goes, and anything typed since stays.
    const leave = () => {
      if (left) return;
      left = true;
      setDraft((current) => (current === submitted ? "" : current));
      onHeld?.(message);
    };
    if (await run((held) => send(message, () => {
      held();
      leave();
    }))) {
      leave();
      onDelivered?.(message);
    } else if (left) {
      // It failed after it left: put it back, unless another line was started.
      setDraft((current) => (current === "" ? submitted : current));
    }
  };

  return (
    <ComposerShell
      testId={testId}
      label={label}
      placeholder={placeholder}
      draft={draft}
      onDraft={(next) => {
        setDraft(next);
        reset();
      }}
      disabled={blocked !== null}
      canSend={canSend}
      onSubmit={(e) => void submit(e)}
      statusState={blocked !== null ? "blocked" : state.kind}
      status={
        blocked !== null ? (
          <span data-testid={`${testId}-blocked`}>{blocked}</span>
        ) : (
          <TurnSendStatus state={state} testId={testId} onRetry={() => void submit()} />
        )
      }
      extra={extra}
      above={
        suggestions === undefined || suggestions.length === 0 ? undefined : (
          <div className="flex flex-wrap gap-1.5" data-testid={`${testId}-suggestions`}>
            {suggestions.map((line) => (
              <button
                key={line}
                type="button"
                disabled={blocked !== null}
                onClick={() => {
                  setDraft(line);
                  reset();
                }}
                className="border border-dashed border-foreground/45 px-[9px] py-[5px] font-mono text-[11.5px] font-medium text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-60"
                data-testid={`${testId}-suggestion`}
                data-look="suggestion"
              >
                {line}
              </button>
            ))}
          </div>
        )
      }
      scale={scale}
    />
  );
}

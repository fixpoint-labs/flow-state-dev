/**
 * A composer that sends a user's line to a worker (S11): a task's, and
 * Inbox's reply box. Its send state is {@link useTurnSend} and
 * {@link TurnSendStatus}.
 *
 * It only draws. Where the line goes, and whether it can go at all, is the
 * caller's; the send itself is {@link sendTurn}'s, the one send path. The
 * composer shows *sending* until the worker's session holds the line. Then the
 * line leaves the draft, since the conversation now holds it, and the composer
 * says the worker is on it until the send resolves. It shows *delivered* only
 * when it does (BR-4), noting Inbox when the worker stopped on a user's ask
 * (a Shift Coordinator's fire, say), or that it waits when it stopped on anything else. A refusal keeps the draft and shows the worker's reason
 * (BR-5). A line that never got there keeps the draft and offers Retry. A line
 * that may have arrived keeps the draft and offers no Retry, so it isn't sent
 * twice. A line that failed after it left the draft is put back, unless the
 * user has started another. Given a `draftKey`, the draft and an
 * *unconfirmed* warning are kept across a reload (`useDraft`), so `--dev`'s
 * reload on save neither loses a half-written line nor invites a second send.
 *
 * Every composer draws through {@link ComposerShell}, v2's composer: one line,
 * sent with ⏎ (Enter). Most composers are a
 * 14px input over a mono footer that holds the send state and ⏎ (v2:305-309,
 * 430-433, 639-644); Shift Coordinator's is the larger one, a 16px input in a
 * 1.5px ink box with ⏎ beside it and the send state under it (v2:175-178).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { clearDraft, readDraft, saveDraft, useDraft } from "@flow-state-dev/react";
import { TurnNotDelivered, type TurnStop } from "../lib/send";

/** Where a composer's unsent line is kept (`useDraft`), and beside it an *unconfirmed* send's warning. */
const DRAFT = "shift-manager:draft";
const UNCONFIRMED = "shift-manager:unconfirmed";

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
 * on why not. `initial` is where it starts, such as an *unconfirmed* line kept
 * across a reload. `run` resolves `true` once the line is delivered. A send may
 * resolve `{ stopped }`, as {@link sendTurn} does, to say what the worker stopped on,
 * and may call the `held` it is handed once the session holds the line.
 */
export function useTurnSend(initial: TurnSendState = { kind: "idle" }) {
  const [state, setState] = useState<TurnSendState>(initial);
  const mounted = useRef(true);
  // Set on every mount, not just the first: StrictMode unmounts and remounts once in dev.
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  /**
   * Send through `send`; resolves `true` once it is delivered and the composer is still open.
   * `closed` hears how a send that fails after the composer closed ended, since no state is left to show it.
   */
  const run = useCallback(async (
    send: (held: () => void) => Promise<void | { stopped: TurnStop }>,
    closed?: (failed: Extract<TurnSendState, { reason: string }>) => void,
  ): Promise<boolean> => {
    setState({ kind: "sending" });
    try {
      const sent = await send(() => {
        if (mounted.current) setState((s) => (s.kind === "sending" ? { kind: "held" } : s));
      });
      if (mounted.current) setState({ kind: "delivered", stopped: sent?.stopped ?? null });
      return mounted.current;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Anything else is a fault in Shift Manager, not an answer about the line,
      // which may have gone: say so, and offer no resend.
      const failed = { kind: error instanceof TurnNotDelivered ? error.kind : "unconfirmed", reason } as const;
      if (!mounted.current) {
        closed?.(failed);
        return false;
      }
      if (!(error instanceof TurnNotDelivered)) console.error("Shift Manager: sending a line failed", error);
      setState(failed);
      return false;
    }
  }, []);
  /** Drop a *delivered* once the user starts a new line; a failure stays until the next send. */
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
 * over a mono footer (or Shift Coordinator's larger box), with the send state in
 * the footer and ⏎ at its end. It only draws: the draft, what Send does and
 * the state shown are the caller's. `lead` sits before the status in the
 * footer; `extra` sits beside
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
  /** `shift-coordinator`: Shift Coordinator's larger composer (v2:175-178). */
  scale?: "default" | "shift-coordinator";
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
        scale === "shift-coordinator" ? "p-4 text-base" : "px-3 py-[11px] text-sm"
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
        scale === "shift-coordinator" ? "m-2 px-3 py-2 text-xs" : "px-[9px] py-1"
      }`}
    >
      ⏎
    </button>
  );

  return (
    <form onSubmit={onSubmit} className={scale === "shift-coordinator" ? "flex flex-col gap-2.5" : "px-[22px] pt-2.5 pb-4"} data-testid={testId}>
      {scale === "shift-coordinator" ? (
        <>
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
  scale = "default",
  autoSend,
  onAutoSend,
  draftKey,
}: {
  testId: string;
  label: string;
  placeholder: string;
  /**
   * What the line is written to (a conversation's worker, a task, an ask), so
   * the draft and an *unconfirmed* warning survive a reload. Without one the
   * draft lives only as long as the composer.
   */
  draftKey?: string;
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
  /** `shift-coordinator`: Shift Coordinator's larger composer (v2:175-178). */
  scale?: "default" | "shift-coordinator";
  /**
   * A line handed in from elsewhere (the palette): sent as if typed, as soon as
   * the composer isn't blocked. `onAutoSend` fires when it is taken.
   */
  autoSend?: string | null;
  onAutoSend?: () => void;
}) {
  const [draft, setDraftText] = useDraft(DRAFT, draftKey);
  // Kept beside the draft, so a reload doesn't offer to send twice a line that may have arrived.
  const [unconfirmed, setUnconfirmed] = useDraft(UNCONFIRMED, draftKey);
  const { state, run, reset } = useTurnSend(unconfirmed === "" ? undefined : { kind: "unconfirmed", reason: unconfirmed });
  useEffect(() => {
    if (state.kind === "unconfirmed") setUnconfirmed(state.reason);
    // Cleared only once the next send has ended: a reload mid-send still warns.
    else if (state.kind !== "idle" && state.kind !== "sending" && state.kind !== "held" && unconfirmed !== "") setUnconfirmed("");
  }, [state, unconfirmed, setUnconfirmed]);
  // The draft as last drawn: a send that settles later decides against what is in the box now.
  const current = useRef(draft);
  current.current = draft;
  const setDraft = useCallback(
    (text: string) => {
      current.current = text;
      setDraftText(text);
    },
    [setDraftText],
  );

  const sending = state.kind === "sending" || state.kind === "held";
  const canSend = blocked === null && draft.trim().length > 0 && !sending;

  const submit = async (event?: FormEvent, line: string = draft) => {
    event?.preventDefault();
    if (blocked !== null || line.trim().length === 0 || sending) return;
    const submitted = line;
    const message = line.trim();
    // The warning this line was sent under: a send that ends after the composer closed clears only that one.
    const warned = readDraft(UNCONFIRMED, draftKey);
    let left = false;
    // The line leaves the draft once the session holds it: only the line that
    // was sent goes, and anything typed since stays.
    const leave = () => {
      if (left) return;
      left = true;
      // The composer may have closed and reopened meanwhile: the stored draft goes only if it is still this line.
      clearDraft(DRAFT, draftKey, submitted);
      if (current.current === submitted) setDraft("");
      onHeld?.(message);
    };
    let delivered = false;
    const sent = await run(async (held) => {
      const result = await send(message, () => {
        held();
        leave();
      });
      delivered = true;
      return result;
    }, (failed) => {
      // It may have arrived, and the box that would say so is closed: keep the warning beside the
      // draft, unless the draft is no longer this line (a newer send, or a newer line, owns it).
      if (failed.kind !== "unconfirmed") clearDraft(UNCONFIRMED, draftKey, warned);
      else if (readDraft(DRAFT, draftKey).trim() === submitted.trim()) saveDraft(UNCONFIRMED, draftKey, failed.reason);
    });
    if (sent) {
      leave();
      onDelivered?.(message);
    } else if (delivered) {
      // Delivered after the composer closed: only what is stored is left to clear, the draft and
      // the warning it was sent under (a warning a newer send left is not that one).
      clearDraft(DRAFT, draftKey, submitted);
      clearDraft(UNCONFIRMED, draftKey, warned);
    } else if (left) {
      // It failed after it left: put it back, unless another line was started.
      // A composer that has closed puts nothing back (its draft setter does nothing then).
      if (current.current === "") setDraft(submitted);
    }
  };

  useEffect(() => {
    if (autoSend == null || blocked !== null || sending) return;
    onAutoSend?.();
    // In the draft first, so a line that fails to send is kept there like a typed one.
    setDraft(autoSend);
    void submit(undefined, autoSend);
    // Taken once: `onAutoSend` clears the line, so a re-run finds nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, blocked, sending]);

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
      scale={scale}
    />
  );
}

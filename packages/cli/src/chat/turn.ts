/**
 * Turn execution for `fsdev chat` — the I/O core that runs one flow action via
 * the engine's in-process `runAction`, bridges its stream to the renderer, and
 * carries the true-abort path.
 *
 * Each turn gets a fresh `requestId` (threaded into `runAction`, unlike
 * `fsdev run`) and a fresh `ResponseEmitter` — reusing an emitter corrupts
 * sequence numbers. Abort is the real thing: patch the request record's
 * `abortRequested` flag first, THEN call `abortRequest(requestId)`, so the run
 * settles `"aborted"` (a persistent "Request was stopped." status) rather than
 * `"interrupted"` (which the engine treats as a resumable disconnect).
 */
import {
  runAction,
  createResponseEmitter,
  abortRequest,
  type RuntimeConfig,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { FlowActionTarget } from "./targets";
import type { ChatRenderer } from "./render";

/** Retry cadence for the abort record-patch and controller lookup. */
const ABORT_RETRY_MS = 25;

/** Nudge shown when an action's schema rejects the `{ message }` a turn sends. */
const NOT_CHAT_SHAPED_HINT =
  "That target isn't chat-shaped (its action rejected { message }). Pick another with /use, or /targets to list them.";

export interface ExecuteTurnParams {
  /** The resolved flow instance for the target (registry-default for its kind). */
  flow: FlowInstance;
  target: FlowActionTarget;
  /** The message text (chat text, or the raw line for a `/name` fall-through). */
  text: string;
  /** Stable session id for this flow kind — never undefined (seeded at bind). */
  sessionId: string;
  userId: string;
  stores: StoreRegistry;
  /** Base runtime config with the CLI logger + model resolver already applied. */
  runtimeConfig: RuntimeConfig;
  renderer: ChatRenderer;
}

export interface TurnResult {
  aborted: boolean;
  errored: boolean;
  durationMs: number;
}

/** A running turn: its settlement, plus a trigger for the true-abort path. */
export interface RunningTurn {
  done: Promise<TurnResult>;
  /** Idempotently request an abort of this turn (patch flag, then signal). */
  requestAbort(): void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True for the engine's input-schema-mismatch error (a non-chat-shaped action).
 * Matches on the message so it holds whether the error arrives thrown (an
 * `Error`) or as `result.error` (a serialized FlowError-shaped object).
 */
function isInputValidationError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  return /input validation failed/i.test(message);
}

/**
 * Start a turn. Returns immediately with a `done` promise (the turn's outcome,
 * after the renderer has been driven start→end) and a `requestAbort` trigger the
 * loop's SIGINT handler calls.
 */
export function executeTurn(params: ExecuteTurnParams): RunningTurn {
  const { flow, target, text, sessionId, userId, stores, runtimeConfig, renderer } = params;
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  let settled = false;
  let abortRequested = false;
  // Track the last request-level status so an aborted turn is recognized
  // authoritatively (the engine emits request.aborted on the abort path).
  let terminalStatus: string | undefined;

  const responseEmitter = createResponseEmitter({
    requestId,
    onEvent: (event) => {
      const status = (event as { status?: unknown }).status;
      if (typeof status === "string" && event.type.startsWith("request.")) {
        terminalStatus = status;
      }
      renderer.onEvent(event);
    },
  });

  async function requestAbort(): Promise<void> {
    if (abortRequested) return;
    abortRequested = true;
    // 1. Persist abortRequested=true first. Retry until the record materializes
    //    (fast Ctrl-C, slow setup) or the turn settles — so the run's catch reads
    //    the flag and settles "aborted", never "interrupted".
    while (!settled) {
      const record = await stores.request.get(requestId).catch(() => undefined);
      if (record !== undefined) {
        await stores.request.set(requestId, { ...record, abortRequested: true }, "any").catch(() => {});
        break;
      }
      await delay(ABORT_RETRY_MS);
    }
    // 2. Then fire the abort, retrying until the controller is registered or the
    //    turn settles. Never fires before the flag is written (step 1 above).
    while (!settled) {
      if (abortRequest(requestId)) break;
      await delay(ABORT_RETRY_MS);
    }
  }

  const done = (async (): Promise<TurnResult> => {
    renderer.onTurnStart(target);
    const startMs = Date.now();
    let errored = false;
    try {
      const result = await runAction({
        flow,
        actionName: target.actionName,
        input: { message: text },
        userId,
        sessionId,
        requestId,
        stores,
        responseEmitter,
        runtimeConfig,
      });
      if (result.error !== undefined) {
        errored = true;
        // The engine already emitted an error item (rendered via onEvent); add
        // the chat-shape hint when the action's schema rejected { message }.
        if (isInputValidationError(result.error)) renderer.onSystem(NOT_CHAT_SHAPED_HINT);
      }
    } catch (err) {
      errored = true;
      // Thrown before/around emission (e.g. input validation) — no error item was
      // streamed, so surface it ourselves.
      renderer.onSystem(`Error: ${err instanceof Error ? err.message : String(err)}`);
      if (isInputValidationError(err)) renderer.onSystem(NOT_CHAT_SHAPED_HINT);
    } finally {
      settled = true;
    }

    const durationMs = Date.now() - startMs;
    const aborted = terminalStatus === "aborted";
    if (aborted) errored = false; // an abort is not an error
    renderer.onTurnEnd({ success: !aborted && !errored, durationMs, aborted });
    return { aborted, errored, durationMs };
  })();

  return { done, requestAbort: () => void requestAbort() };
}

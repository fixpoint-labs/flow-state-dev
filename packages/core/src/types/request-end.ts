/**
 * The request-end seam (FIX-2077): a framework package asks the runtime to
 * call it back once a request's work is over.
 *
 * "Over" is later than the action's return and later than `onFinished`. The
 * runtime drains the request's background work, runs `onFinished`, and then
 * drains what `onFinished` and `onErrored` started. A hook registered here runs
 * after that last drain, on every way a request can end: completed,
 * incomplete, failed, aborted, interrupted, and suspended. It is the one place
 * that can say "nothing this request started is still writing".
 *
 * Framework-facing, not a flow-author hook. A flow author's `onFinished` keeps
 * running where it does, and a throw from it cannot skip a hook registered
 * here. The slot is a symbol key, as the dispatch seam's is, so no handler body
 * reaches it by name.
 */

/** How a request ended, as a request-end hook is told. */
export type RequestEndStatus = "completed" | "incomplete" | "failed" | "aborted" | "interrupted" | "suspended";

/** One step of a request's background work that failed (FIX-2088). */
export interface BackgroundFailure {
  /** The step's name, as `.sideChain()` recorded it. */
  readonly step: string;
  /** Its error's message. */
  readonly message: string;
}

/** What a request-end hook is handed. */
export interface RequestEnding {
  /** How the request ended. */
  readonly status: RequestEndStatus;
  /**
   * On `suspended`: the suspension it parked on. `reason` is why
   * (`human_approval`, `human_input`, `external_event`, or a flow's own); the
   * rest is what a reader of a task waiting on it shows (FIX-2129): its id,
   * its kind when `waitForUser` set one, what it asks (`title`, `message`),
   * and its deadline (`expiresAt`), absent when it has none.
   */
  readonly suspension?: {
    readonly reason: string;
    readonly suspensionId?: string;
    readonly kind?: import("./suspension").WaitForUserKind;
    readonly title?: string;
    readonly message?: string;
    readonly expiresAt?: number;
  };
  /** On `failed`: the request's error message, as its record carries it. */
  readonly error?: { readonly message: string };
  /**
   * The steps of the request's background work that failed, gathered across
   * every drain, in the order they were drained: work the action started,
   * work its end hooks started, and work a default `.waitForSideChain()`
   * drained. Absent when none failed.
   *
   * Never handed on for a request whose cancel fired (the explicit abort),
   * whatever its steps did after it; a dropped connection is not a cancel.
   * Never handed on at `suspended` either: the resume reruns a step that has
   * no completed trace, and the rerun's outcome is the one handed on.
   *
   * The request's own status never depends on these: the runtime only hands
   * them on. A hook that must fail something on them (the claim gate fails a
   * task's attempt) does so itself.
   */
  readonly backgroundFailures?: readonly BackgroundFailure[];
}

/**
 * What a request-end hook may hand back: a failure that is the request's own.
 * On a request that completed, the runtime then records the request as failed
 * with this error (the record it already wrote is patched), so its status
 * never reads as success for work a framework package could not record.
 *
 * A request with a hook still owed holds back its terminal status event until
 * its hooks have run, and then emits the status they leave it with, so a
 * stream client is told once: `failed` here, never `completed` first.
 * `onFinished` and the lifecycle seams run before the hooks (the hooks wait
 * for what `onFinished` starts), so they report the request's own end; the
 * recorded status may then be failed by a request-end hook.
 */
export interface RequestEndVerdict {
  readonly fail: Error;
}

/**
 * A request-end hook. Runs once per request end, after the last drain. A
 * rejection is logged by the runtime and does not change how the request
 * ended; a hook that must fail the request returns a {@link RequestEndVerdict}.
 */
export type RequestEndHook = (ending: RequestEnding) => void | RequestEndVerdict | Promise<void | RequestEndVerdict>;

/** The per-request registry the runtime attaches under {@link REQUEST_END_SEAM}. */
export interface RequestEndSeam {
  /** Add a hook for the running request. Hooks run in the order they were added. */
  add(hook: RequestEndHook): void;
}

/** The context slot the runtime attaches its request-end registry under. */
export const REQUEST_END_SEAM: unique symbol = Symbol.for("@flow-state-dev/request-end-seam");

/**
 * Ask to be called once the running request's work is over (see the module
 * header for what "over" means).
 *
 * @returns `false` when the context carries no seam: a hand-built test
 *   context, or a block run outside a request. The caller decides what that
 *   means for it.
 */
export function onRequestEnded(ctx: { readonly [REQUEST_END_SEAM]?: RequestEndSeam }, hook: RequestEndHook): boolean {
  const seam = ctx[REQUEST_END_SEAM];
  if (seam == null) return false;
  seam.add(hook);
  return true;
}

// FIX-2849.
/**
 * A refusal a session gives every run of it, by its error `code`: the run's
 * start was refused for good, so retrying it can never get further.
 *
 * Read in two places. A request whose start is refused this way ends `failed`
 * even when it is a replay continuation, which another failure at its start
 * leaves for the stale sweep to re-drive. And a wake whose run is refused this
 * way is cleared rather than fired again.
 */

/**
 * The codes: Workforce's `WorkerTurnRefusedError`, thrown at the start of
 * every turn of a session whose worker was fired or can no longer run there.
 */
const TERMINAL_START_REFUSALS: ReadonlySet<string> = new Set(["worker-turn-refused"]);

/**
 * Whether `error` is a refusal its session will give every run: on the error,
 * or on one it wraps as its `cause` (a block's throw reaches the run's caller
 * as a `FlowError` around it).
 */
export function isTerminalStartRefusal(error: unknown): boolean {
  for (let current = error, depth = 0; current != null && depth < 4; depth += 1) {
    const code = (current as { readonly code?: unknown }).code;
    if (typeof code === "string" && TERMINAL_START_REFUSALS.has(code)) return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
}

/**
 * Abort-error introspection helpers. Used to walk wrapped error chains
 * (e.g. the AI Gateway's doubly-wrapped abort error) back to their root
 * and to discriminate abort-like failures from genuine errors so the
 * block-failure surface can present a legible message instead of opaque
 * gateway noise. See FIX-663.
 */

/**
 * Walk the `cause` chain to the root error. Stops at the first non-Error
 * or when `cause` is undefined. Returns the original value when it has no
 * walkable cause.
 */
export function rootCause(err: unknown): unknown {
  let e: unknown = err;
  while (e instanceof Error && (e as Error & { cause?: unknown }).cause !== undefined) {
    e = (e as Error & { cause: unknown }).cause;
  }
  return e;
}

/**
 * True if the **root** error in the `cause` chain looks like an AbortError —
 * by name, DOMException code, or Node's `ABORT_ERR` code. Calls `rootCause`
 * first, so a wrapper that loses `e.name` is transparent as long as the
 * innermost cause is the abort. An `AbortError` that is not at the root of the
 * chain is not detected.
 */
export function isAbortLike(err: unknown): boolean {
  const root = rootCause(err);
  if (!(root instanceof Error)) {
    return false;
  }
  if (root.name === "AbortError") {
    return true;
  }
  const code = (root as Error & { code?: unknown }).code;
  if (code === "ABORT_ERR" || code === 20) {
    return true;
  }
  return false;
}

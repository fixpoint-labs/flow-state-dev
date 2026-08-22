/**
 * Coerce an unknown thrown value to `Error`.
 */

const DEFAULT_FALLBACK = "Unknown block execution error";

/**
 * Pass an `Error` through. A non-empty string becomes `new Error(value)`.
 * Anything else becomes `new Error(fallback)`.
 *
 * `fallback` defaults to `"Unknown block execution error"` so existing
 * block-runtime callers keep their message. Hosts that normalize throws
 * outside a block (the engine route layer) pass their own fallback.
 */
export function toError(
  value: unknown,
  fallback: string = DEFAULT_FALLBACK
): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error(fallback);
}

/**
 * How a request ends, and the action result its record stores (FIX-1661).
 *
 * Every writer of a request record's final status describes the ending as a
 * {@link RequestSettlement} and builds the stored `result` from it here. The
 * union is what makes that total: a terminal status is only expressible
 * together with what its result needs (an output, or an error), so a new
 * terminal write that forgets its result does not compile.
 *
 * The engine stores the action's value and never interprets it. Whether an
 * output is a refusal is the reader's call.
 */
import type { RequestActionResult } from "../stores/types";

/**
 * A failure cause, as a normalized `FlowError` carries it. A missing `code`
 * is stored as `execution_error`, the code `normalizeError` infers by default.
 */
export type SettlementError = { code?: string; message: string };

/**
 * How a request ended, with what its record's `result` is built from.
 *
 * - `completed` / `incomplete` — the action's own return value (`undefined`
 *   when it returned nothing).
 * - `failed` — the cause, when the writer has one, and `answered` when the
 *   action had returned before something after it (a completion hook) failed
 *   the request.
 * - `aborted` / `interrupted` / `suspended` — no result, by design.
 */
export type RequestSettlement =
  | { status: "completed" | "incomplete"; output: unknown }
  | { status: "failed"; error?: SettlementError; answered?: { output: unknown } }
  | { status: "aborted" }
  | { status: "interrupted" }
  | { status: "suspended" };

/**
 * The `result` a record stores for `settlement`, or `undefined` for an ending
 * that carries none (aborted, interrupted, suspended).
 */
export function buildRequestActionResult(settlement: RequestSettlement): RequestActionResult | undefined {
  switch (settlement.status) {
    case "completed":
    case "incomplete":
      return recordableOutput(settlement.output);
    case "failed":
      return {
        ...(settlement.answered !== undefined ? recordableOutput(settlement.answered.output) : {}),
        ...(settlement.error !== undefined
          ? { error: { code: settlement.error.code ?? "execution_error", message: settlement.error.message } }
          : {})
      };
    case "aborted":
    case "interrupted":
    case "suspended":
      return undefined;
  }
}

/**
 * The final-status half of a request record write: the status and the
 * `result` built for it, together. Every writer of a final status spreads
 * this into its record write, whether through `settleRequestRecord`, a CAS
 * loop, or a whole-record `set`, so the pairing lives in one place.
 */
export function settledRecordFields(settlement: RequestSettlement): {
  status: RequestSettlement["status"];
  result: RequestActionResult | undefined;
} {
  return { status: settlement.status, result: buildRequestActionResult(settlement) };
}

/**
 * The output as the record stores it: a JSON copy, so every adapter holds the
 * same value and a later mutation of the live object cannot reach the record.
 * A value JSON cannot hold (a `BigInt`, a cycle, a throwing `toJSON`), one
 * JSON would silently change (`NaN` or `±Infinity` read back as `null`, a
 * function or symbol dropped, an `undefined` array slot read back as `null`,
 * a `Map`, `Set`, `Error` or other built-in container read back as `{}` or a
 * different shape), is dropped with a marker rather than failing the write it
 * rides on, or storing a different value. Size is not capped: listings return
 * the output only to a caller that opts in. A `toJSON` result (a `Date`'s ISO string) is the value as stored, and
 * an object key whose value is `undefined` is left out, which reads back the
 * same.
 */
function recordableOutput(output: unknown): RequestActionResult {
  if (output === undefined) return {};
  let text: string | undefined;
  let lossy = false;
  try {
    text = JSON.stringify(output, function (this: unknown, _key: string, value: unknown) {
      if (
        (typeof value === "number" && !Number.isFinite(value)) ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        (value === undefined && Array.isArray(this)) ||
        isBuiltInContainer(value)
      ) {
        lossy = true;
      }
      return value;
    });
  } catch {
    return { outputNotRecorded: true };
  }
  if (lossy) return { outputNotRecorded: true };
  // A `toJSON` that returns `undefined` stringifies to `undefined`.
  if (text === undefined) return { outputNotRecorded: true };
  return { output: JSON.parse(text) as unknown };
}

/**
 * Whether `value` is an object JSON does not copy faithfully: anything that is
 * not an array or a plain `[object Object]` (a `Map`, `Set`, `Error`, `RegExp`,
 * typed array, promise). `JSON.stringify` writes those as `{}` or as their
 * index keys without visiting what they hold. The replacer sees a value after
 * its `toJSON`, so a `Date` arrives as its string, and boxed primitives
 * serialize as their primitive, so neither is flagged. A class instance is
 * `[object Object]` and is stored as its own enumerable fields.
 */
function isBuiltInContainer(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (value instanceof Number || value instanceof String || value instanceof Boolean) return false;
  return Object.prototype.toString.call(value) !== "[object Object]";
}

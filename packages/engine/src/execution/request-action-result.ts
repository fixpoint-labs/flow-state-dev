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
 * The output as the record stores it: a JSON copy, so every adapter holds the
 * same value and a later mutation of the live object cannot reach the record.
 * A value JSON cannot hold (a `BigInt`, a cycle, a function) is dropped with a
 * marker rather than failing the write it rides on.
 */
function recordableOutput(output: unknown): RequestActionResult {
  if (output === undefined) return {};
  let text: string | undefined;
  try {
    text = JSON.stringify(output);
  } catch {
    return { outputNotRecorded: true };
  }
  if (text === undefined) return { outputNotRecorded: true };
  return { output: JSON.parse(text) as unknown };
}

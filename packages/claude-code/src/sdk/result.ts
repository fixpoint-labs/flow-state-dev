/**
 * The SDK's terminal `result` message, read once.
 *
 * Three callers need the same facts out of that one message — `headless.ts`
 * settles a blocking run to a plain value, `translate.ts` turns it into
 * canonical events for the agent block, and `agent.ts` decides the run handle's
 * status. Each had grown its own copy of the reading, which is how the two
 * `normalizeSubtype` implementations came to disagree in spelling while
 * agreeing in meaning: the next SDK subtype would have had to be added in two
 * places, and one of them would have been missed.
 *
 * **`succeeded` is the whole verdict.** A run failed if its subtype is anything
 * but `success` *or* the SDK set `is_error`, and this module answers that in one
 * field so no caller has to remember to read two. It previously reported the two
 * facts separately and left the combining to each caller, on the theory that
 * they legitimately differed — and the callers promptly disagreed: `headless.ts`
 * honoured `is_error`, `translate.ts` did not, so an unauthenticated run (which
 * returns `subtype: "success"`, `is_error: true`, and the reason in `result`)
 * settled as failed on one surface and persisted a *completed* run handle on the
 * other. A verdict a caller can get half-right is a verdict this module owes it.
 *
 * Two rules `succeeded` encodes, both of which read a failure as a failure:
 *
 * - **Anything not exactly `success` failed**, including a subtype this version
 *   does not recognize. It is checked against the raw string, not the normalized
 *   one: a future SDK failure mode normalizes to `null`, and reading `null` as
 *   "no error reported" would report a failed run as a completion.
 * - **`is_error` overrides an otherwise-successful subtype.** The SDK sets it on
 *   a terminal `success` result whose run nonetheless went wrong.
 *
 * `isError` stays exposed beside it as a reported fact — already folded into
 * `succeeded`, and read only to *name* which of the two rules failed the run.
 */
import type { SdkMessageLike, SdkResultSubtype } from "./types";

/** The terminal message this module reads. */
type SdkResultMessage = Extract<SdkMessageLike, { type: "result" }>;

/** Token usage for one run, as the SDK reported it. */
export interface SdkTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Everything this package reads out of one terminal `result` message. */
export interface SdkTerminalResult {
  /** The subtype, or `null` when the SDK reported one this version predates. */
  readonly subtype: SdkResultSubtype | null;
  /** The subtype as reported, for a human-readable reason. Never empty. */
  readonly subtypeLabel: string;
  /**
   * The single verdict: `true` only for an exactly-`success` subtype the SDK did
   * not flag with `is_error`. An unrecognized subtype is `false` — see the note
   * on failure classification above.
   */
  readonly succeeded: boolean;
  /**
   * The SDK's own error flag, as reported. Already folded into
   * {@link SdkTerminalResult.succeeded} — read it to *describe* a failure, never
   * to decide one.
   */
  readonly isError: boolean;
  /** The agent's final answer. `null` on an error-subtype result, which has none. */
  readonly finalMessage: string | null;
  /** `errors[]` joined, or `null` when the result carried none. */
  readonly errorDetail: string | null;
  /** The session id a human can resume or open. `null` when unreported. */
  readonly sessionId: string | null;
  /** Tokens spent. `null` when unreported. Populated on failures too. */
  readonly usage: SdkTokenUsage | null;
  /** Vendor-reported cost in USD. `null` when unreported. Populated on failures too. */
  readonly costUsd: number | null;
}

/** Terminal subtypes this package recognizes, in the SDK's spelling. */
const KNOWN_SUBTYPES: ReadonlySet<string> = new Set<string>([
  "success",
  "error_max_turns",
  "error_max_budget_usd",
  "error_during_execution",
  "error_max_structured_output_retries",
]);

/**
 * Normalize the SDK's terminal subtype string to a known value, or `null` for
 * one this version does not recognize. `null` never means success — `"success"`
 * is always recognized, so an unrecognized value is by construction a failure
 * mode added after this package was written.
 */
export function normalizeSubtype(raw: string | undefined): SdkResultSubtype | null {
  return raw !== undefined && KNOWN_SUBTYPES.has(raw) ? (raw as SdkResultSubtype) : null;
}

/** Read one terminal `result` message into {@link SdkTerminalResult}. */
export function readTerminalResult(msg: SdkResultMessage): SdkTerminalResult {
  const raw = msg.subtype;
  const isError = msg.is_error === true;
  return {
    subtype: normalizeSubtype(raw),
    subtypeLabel: raw ?? "unknown subtype",
    succeeded: raw === "success" && !isError,
    isError,
    // Error-subtype results carry `errors[]` and no `result`; a success result
    // carries `result` and no `errors`. Both are read, neither is invented.
    finalMessage: typeof msg.result === "string" ? msg.result : null,
    errorDetail: msg.errors && msg.errors.length > 0 ? msg.errors.join("; ") : null,
    sessionId: msg.session_id ?? null,
    usage:
      msg.usage && (msg.usage.input_tokens !== undefined || msg.usage.output_tokens !== undefined)
        ? { inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 }
        : null,
    costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null,
  };
}

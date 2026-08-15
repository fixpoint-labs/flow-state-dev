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
 * **Facts here, policy at the caller.** This module reports what the message
 * said; it does not decide what counts as a failure, because the callers
 * genuinely differ on one point and flattening that would be a silent
 * behaviour change:
 *
 * - `headless.ts` fails a run on `is_error` as well as on the subtype, because
 *   its whole contract is a settled ok/not-ok value.
 * - `translate.ts` keys its error event on the subtype alone, and the
 *   `TranslatedEvent` result variant carries no `is_error` to key on.
 *
 * So `succeeded` is defined on the subtype and `isError` is reported beside it,
 * leaving that one divergence visible in one file instead of implied across
 * three.
 *
 * The rule both callers do share, and the reason `succeeded` is not derived
 * from the normalized subtype: **anything that is not exactly `success` is a
 * failure, including a subtype this version does not recognize.** A future SDK
 * failure mode normalizes to `null`, and reading `null` as "no error reported"
 * would report a failed run as a completion.
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
   * `true` only for an exactly-`success` subtype. An unrecognized subtype is
   * `false` — see the note on failure classification above.
   */
  readonly succeeded: boolean;
  /** The SDK's own error flag, as reported. Policy is the caller's. */
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

/**
 * True when a normalized subtype means the run failed. `null` counts as a
 * failure for the reason above: it is an unrecognized subtype, not an absent
 * one.
 */
export function isErroredSubtype(subtype: SdkResultSubtype | null): boolean {
  return subtype !== "success";
}

/** Read one terminal `result` message into {@link SdkTerminalResult}. */
export function readTerminalResult(msg: SdkResultMessage): SdkTerminalResult {
  const raw = msg.subtype;
  return {
    subtype: normalizeSubtype(raw),
    subtypeLabel: raw ?? "unknown subtype",
    succeeded: raw === "success",
    isError: msg.is_error === true,
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

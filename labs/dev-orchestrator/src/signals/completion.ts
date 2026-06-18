/**
 * The composite completion predicate: "is the delegated stage done yet?"
 *
 * Completion is never a single event. A spec stage is done when the board has
 * advanced to (or past) the expected state; an implement stage is done when a
 * non-draft PR exists for the branch and its checks rolled up green. Both are
 * polled deterministically here, and every wait is backstopped by a wall-clock
 * watchdog so a stalled agent escalates to a human instead of hanging forever.
 * Stages describe what they are waiting for (a `WatchSpec` in the suspension
 * record); this module — driven by the driver — does the looking.
 */
import type { LinearStatusClient } from "./linear";
import type { GitHubSignalClient } from "./github";
import type { CompletionSignal, WatchSpec } from "../types";
import { isAtOrPast } from "../types";

/** The deterministic clients the predicate reads. */
export interface CompletionClients {
  linear: LinearStatusClient;
  github: GitHubSignalClient;
}

/** Per-evaluation context: which issue, and the watchdog clock. */
export interface CompletionContext {
  issueId: string;
  /** When the wait was first parked (the suspension's `createdAt`). */
  createdAt: number;
  /** Current wall-clock time. */
  now: number;
  /** Watchdog budget; once `now - createdAt` exceeds it, the wait times out. */
  watchdogMs: number;
}

/**
 * Outcome of one poll. `ready` carries the observed `signal` to thread back into
 * the resumed stage; `timedOut` means the watchdog fired and the driver should
 * escalate (comment + stop). The two are mutually exclusive — an observed signal
 * always wins over an elapsed clock.
 */
export interface CompletionResult {
  ready: boolean;
  timedOut: boolean;
  signal: CompletionSignal | null;
}

const notReady = (timedOut: boolean): CompletionResult => ({ ready: false, timedOut, signal: null });

/**
 * Evaluate a single watch against the live board / PR state. Checks readiness
 * first (an observed completion beats the clock), then the watchdog. Unknown
 * watch kinds are treated as never-ready so a misconfigured stage escalates via
 * the watchdog rather than completing on a signal that was never checked.
 */
export async function evaluateCompletion(
  watch: WatchSpec,
  clients: CompletionClients,
  ctx: CompletionContext,
): Promise<CompletionResult> {
  const elapsed = ctx.now - ctx.createdAt;
  const expired = elapsed >= ctx.watchdogMs;

  if (watch.kind === "linear-state" && watch.target !== null) {
    const state = await clients.linear.getState(ctx.issueId);
    if (state !== null && isAtOrPast(state, watch.target)) {
      return {
        ready: true,
        timedOut: false,
        signal: { kind: "linear-state", observedState: state, detail: `reached ${watch.target}` },
      };
    }
    return notReady(expired);
  }

  if (watch.kind === "github-pr" && watch.branch !== null) {
    const pr = await clients.github.pullRequestForBranch(watch.branch);
    const checksOk = watch.requireChecks ? pr.checks === "success" : true;
    if (pr.exists && !pr.draft && checksOk) {
      return {
        ready: true,
        timedOut: false,
        signal: {
          kind: "github-pr",
          observedState: null,
          detail: pr.number !== null ? `PR #${pr.number} ready` : "PR ready",
        },
      };
    }
    return notReady(expired);
  }

  // Misconfigured watch — never ready; let the watchdog escalate.
  return notReady(expired);
}

/**
 * `fakeDispatcher` — a {@link Dispatcher} that records what it was asked to do
 * and returns scripted results.
 *
 * This is the inner loop. Every real dispatch costs an issue, a PR, and several
 * minutes, so a process that can only be exercised end-to-end is a process
 * nobody iterates on. With this and `./replay`, the whole issue lifecycle runs
 * in milliseconds against literals, and the expensive path is reserved for
 * confirming what the fast one already established.
 */

import type {
  DispatchProduced,
  DispatchResult,
  Dispatcher,
  IsolationModel,
  PhaseBrief,
} from "../dispatch/types";

/** One scripted outcome. Anything omitted falls back to a plain completion. */
export interface ScriptedDispatch {
  readonly outcome?: "completed" | "failed";
  readonly produced?: DispatchProduced;
  readonly costUsd?: number | null;
  readonly vendorRunId?: string | null;
  readonly error?: string | null;
  /**
   * A goal verdict to claim, omitted by default so a scripted run claims
   * nothing — which is what every shipped dispatcher does today.
   */
  readonly goalCheck?: "passed" | "failed";
}

export interface FakeDispatcherOptions {
  /** Vendor identity to report. Default `"fake"`. */
  readonly vendor?: string;
  /** Isolation model to declare. Default `"worktree"`, matching the real dispatcher. */
  readonly isolation?: IsolationModel;
  /**
   * Outcomes consumed in dispatch order. Past the end of the list every further
   * dispatch completes, so a test scripts only the runs it cares about.
   */
  readonly results?: readonly ScriptedDispatch[];
  /** Clock, so recorded timestamps are deterministic. */
  readonly now?: () => Date;
}

/** A {@link Dispatcher} that also exposes what it was handed. */
export interface FakeDispatcher extends Dispatcher {
  /** Every brief received, in order. */
  readonly briefs: readonly PhaseBrief[];
  /** Every result returned, in order. */
  readonly results: readonly DispatchResult[];
  /** The action kinds dispatched, in order — the assertion most tests want. */
  actionsRun(): readonly PhaseBrief["action"][];
}

/** Create a recording, scriptable dispatcher. */
export function fakeDispatcher(options: FakeDispatcherOptions = {}): FakeDispatcher {
  const {
    vendor = "fake",
    isolation = "worktree",
    results: script = [],
    now = () => new Date(0),
  } = options;

  const briefs: PhaseBrief[] = [];
  const results: DispatchResult[] = [];

  return {
    vendor,
    isolation,
    briefs,
    results,
    actionsRun: () => briefs.map((brief) => brief.action),

    async run(brief: PhaseBrief): Promise<DispatchResult> {
      const scripted = script[briefs.length] ?? {};
      briefs.push(brief);
      const at = now().toISOString();
      const result: DispatchResult = {
        dispatchId: brief.dispatchId,
        outcome: scripted.outcome ?? "completed",
        produced: scripted.produced ?? (brief.branch ? { branch: brief.branch } : {}),
        costUsd: scripted.costUsd ?? null,
        vendorRunId: scripted.vendorRunId ?? null,
        error: scripted.error ?? null,
        // Spread rather than defaulted: the field's absence is the claim
        // ("nothing was proved"), so a fake that always carried a key would be
        // scripting a shape no dispatcher produces.
        ...(scripted.goalCheck ? { goalCheck: scripted.goalCheck } : {}),
        startedAt: at,
        settledAt: at,
      };
      results.push(result);
      return result;
    },
  };
}

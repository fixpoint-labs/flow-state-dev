/**
 * Shared domain types and schemas for the dev-loop orchestrator.
 *
 * These describe the orchestration vocabulary — lifecycle stages, the signal a
 * park step resumes on, and the result of a human gate — used across the pure
 * stage machine, the deterministic signal clients, and the durable flow stages.
 * They are deliberately serializable (plain objects / Zod object shapes) so they
 * survive the suspend → resume round-trip through the durable stores.
 */
import { z } from "zod";

/**
 * The Linear workflow states the orchestrator reasons about. The open string
 * union tolerates any unrecognized state name (the stage machine maps those to
 * a safe `noop`) without widening to a bare `string` everywhere.
 */
export type LinearStateName =
  | "Backlog"
  | "Todo"
  | "Ready to Spec"
  | "In Spec Dev"
  | "In Spec Review"
  | "Spec Approved"
  | "In Development"
  | "In Review"
  | "Done"
  | "Canceled"
  | "Duplicate"
  | (string & {});

/** The three delegated work stages the orchestrator drives. */
export type OrchestrationStage = "spec" | "implement" | "review";

/**
 * Ordered lifecycle of the "forward" workflow states. Used to decide whether an
 * observed Linear state has reached or passed a target (completion detection)
 * without hardcoding pairwise comparisons. Terminal/branch states (Canceled,
 * Duplicate) are intentionally absent — they are not points on the forward line.
 */
export const LINEAR_LIFECYCLE: readonly LinearStateName[] = [
  "Backlog",
  "Todo",
  "Ready to Spec",
  "In Spec Dev",
  "In Spec Review",
  "Spec Approved",
  "In Development",
  "In Review",
  "Done",
];

/**
 * True when `state` is at or past `target` on the forward lifecycle. An
 * unknown `state` (not on the line) is never "at or past" anything, so callers
 * keep waiting rather than falsely completing. The signal that a delegated
 * stage finished is precisely that the board advanced to (or beyond) the
 * expected state, so this is the core completion comparison.
 */
export function isAtOrPast(state: LinearStateName, target: LinearStateName): boolean {
  const here = LINEAR_LIFECYCLE.indexOf(state);
  const want = LINEAR_LIFECYCLE.indexOf(target);
  if (here === -1 || want === -1) return false;
  return here >= want;
}

/**
 * The observed downstream signal carried back into a parked stage on resume.
 * `kind` records which substrate produced it; `detail` is a human-readable
 * description for the timeline. Nullable (not optional) so it round-trips
 * cleanly through JSON storage.
 */
export const completionSignalSchema = z.object({
  kind: z.enum(["linear-state", "github-pr"]),
  observedState: z.string().nullable(),
  detail: z.string().nullable(),
});
export type CompletionSignal = z.infer<typeof completionSignalSchema>;

/** Result of a human gate: approved (proceed) or rejected (bounce back). */
export const gateResultSchema = z.object({
  gate: z.enum(["approved", "rejected"]),
  note: z.string().nullable(),
});
export type GateResult = z.infer<typeof gateResultSchema>;

/** Payload a human supplies when resolving an approval gate. */
export const gateResumeSchema = z.object({
  note: z.string().nullable(),
});

/**
 * What a park step is waiting for, persisted in the suspension record's `data`
 * so the driver knows which signal client to poll on each tick. Stages never
 * poll themselves (the driver owns all I/O); they only describe the wait.
 */
export const watchSpecSchema = z.object({
  kind: z.enum(["linear-state", "github-pr"]),
  /** For `linear-state`: the target state the delegated stage advances to. */
  target: z.string().nullable(),
  /** For `github-pr`: the head branch the implement stage's PR opens against. */
  branch: z.string().nullable(),
  /** For `github-pr`: require the checks rollup to be green, not just a PR to exist. */
  requireChecks: z.boolean(),
});
export type WatchSpec = z.infer<typeof watchSpecSchema>;

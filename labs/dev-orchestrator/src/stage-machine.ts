/**
 * The pure stage machine: Linear workflow state → next orchestration action.
 *
 * This is the heart of the orchestrator's "where does this issue sit, and what
 * happens next" decision, and it is deliberately I/O-free so it can be unit
 * tested exhaustively over every state. The driver reads the live Linear state,
 * asks this function for the next action, and executes it.
 *
 * Restart safety (no double dispatch) is NOT this function's job — it lives in
 * the flow and the driver loop: a parked suspension always takes precedence over
 * the machine (so a restart resumes the wait), the spec stage's dispatch step is
 * skipped via `skipDispatch` / a persisted-`claudeRemoteTasks` guard, and the
 * dispatch step replays from its checkpoint on resume. So a "dispatch" state can
 * map to `dispatch` unconditionally here.
 */
import type { LinearStateName, OrchestrationStage } from "./types";

/**
 * The next thing the driver should do. `dispatch` starts a stage's delegated
 * agent; `await-agent` waits for an already-running agent to advance the board;
 * `await-human` waits at a mandatory human gate; `done` and `noop` are terminal.
 */
export type OrchestrationAction =
  | { kind: "dispatch"; stage: OrchestrationStage }
  | { kind: "await-agent"; stage: OrchestrationStage }
  | { kind: "await-human"; gate: "spec-approval" | "pr-approval" }
  | { kind: "done" }
  | { kind: "noop"; reason: string };

/** Driver context the pure machine reads (never writes). */
export interface DriverState {
  /**
   * Permit starting the spec stage from `Todo`/`Backlog`. Off by default: the
   * orchestrator normally enters at `Ready to Spec`.
   */
  fromBacklog: boolean;
}

/**
 * Map a Linear state to the next action. Pure: the same inputs always produce
 * the same action. Unrecognized and terminal-branch states yield `noop` so the
 * driver stops safely rather than guessing.
 */
export function nextAction(state: LinearStateName, ctx: DriverState): OrchestrationAction {
  switch (state) {
    case "Backlog":
    case "Todo":
      return ctx.fromBacklog
        ? { kind: "dispatch", stage: "spec" }
        : { kind: "noop", reason: `${state} requires --from-backlog to start the spec stage` };

    case "Ready to Spec":
      return { kind: "dispatch", stage: "spec" };

    // The /create-spec skill is running; it advances the board to In Spec Review.
    case "In Spec Dev":
      return { kind: "await-agent", stage: "spec" };

    // Spec authored — the human approves it by moving to Spec Approved.
    case "In Spec Review":
      return { kind: "await-human", gate: "spec-approval" };

    case "Spec Approved":
      return { kind: "dispatch", stage: "implement" };

    // The /implement-issue skill is running; it opens a PR and moves to In Review.
    case "In Development":
      return { kind: "await-agent", stage: "implement" };

    // Review↔refine is driver-owned; one review round dispatched per entry.
    case "In Review":
      return { kind: "dispatch", stage: "review" };

    case "Done":
      return { kind: "done" };

    case "Canceled":
    case "Duplicate":
      return { kind: "noop", reason: `${state} is terminal` };

    default:
      return { kind: "noop", reason: `Unrecognized Linear state "${state}"` };
  }
}

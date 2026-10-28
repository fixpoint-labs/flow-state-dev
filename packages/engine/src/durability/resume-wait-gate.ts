/**
 * Resume one wait gate with an outcome, once: the wait's admission rules over
 * the shared resume path (`resume-under-lease.ts`).
 *
 * Two callers decide whether a gate is theirs to resume and then come here: a
 * conversation resuming its own wait (`context/wait-resume-operation.ts`, which
 * finds the gate within the running session), and the durability sweep
 * resuming a wait past its deadline with `wait_timed_out`
 * (`durability-sweeper.ts`).
 */
import { isWaitGate, parseWaitOutcome } from "@flow-state-dev/core/types";
import type { WaitOutcome, ResumeWaitResult, SuspensionRecord } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import { latestGateIdOf, resumeUnderLease, type ResumeDeps } from "./resume-under-lease";

/** What {@link resumeWaitGate} needs from the host. */
export type WaitResumeDeps = ResumeDeps & {
  stores: Pick<StoreRegistry, "request">;
};

/**
 * Resume one wait gate with an outcome, once.
 *
 * The caller has already decided this gate is theirs to resume. This checks
 * only what makes a resume safe, under the request's lease: the gate is a wait,
 * it is still pending, and the request is parked on it. A gate that is no longer
 * pending is `already-resolved`, so a second resume (a notice delivered twice,
 * a marker replayed after the turn resumed) resumes nothing. A pending gate
 * whose turn has not finished parking is `busy`: the sender keeps the outcome
 * and tries again.
 */
export async function resumeWaitGate(
  deps: WaitResumeDeps,
  gate: Pick<SuspensionRecord, "requestId" | "suspensionId">,
  outcome: WaitOutcome,
  resumedBy: string
): Promise<ResumeWaitResult> {
  // Refuse to record anything the gate would not read back as an outcome.
  const parsed = parseWaitOutcome(outcome);
  if (parsed === undefined) {
    throw new TypeError("resumeWaitGate: the outcome is not a wait outcome");
  }

  type Refusal = Extract<ResumeWaitResult, { ok: false }>;
  const resumed = await resumeUnderLease<Refusal>(deps, {
    requestId: gate.requestId,
    holder: "resume-ask",
    // Read under the lease, so two resumes racing for one gate cannot both
    // see it pending.
    admit: async () => {
      const suspension = await deps.provider.loadSuspension(gate.requestId, gate.suspensionId);
      if (suspension === null || !isWaitGate(suspension)) {
        return {
          refusal: { ok: false, refused: "gate-not-found", detail: `no wait gate "${gate.suspensionId}"` }
        };
      }
      if (suspension.status !== "pending") {
        return {
          refusal: {
            ok: false,
            refused: "already-resolved",
            detail: `wait gate "${gate.suspensionId}" was already resolved (${suspension.status})`
          }
        };
      }
      const request = await deps.stores.request.get(gate.requestId);
      // Interrupted before its log held the gate (the process died between
      // writing the gate and its log item): a continuation could not replay
      // this outcome onto the gate, and would park on it again. Not resolved,
      // only not yet resumable, so refused as retryable: the outcome's sender
      // keeps it and tries again once the turn has parked again.
      if (request?.status === "interrupted" && latestGateIdOf(request) !== gate.suspensionId) {
        return {
          refusal: {
            ok: false,
            refused: "busy",
            detail: `the turn parked on wait gate "${gate.suspensionId}" was interrupted before it parked; try again once it has`
          }
        };
      }
      // Still parking: the gate is written, but the park's request-end hooks
      // run before the request is recorded `suspended` (FIX-2135). An outcome
      // that lands here (a waited-on task ending meanwhile) is not late, only
      // early, so it is refused as retryable, as above.
      if (request?.status === "in_progress") {
        return {
          refusal: {
            ok: false,
            refused: "busy",
            detail: `the turn on wait gate "${gate.suspensionId}" has not finished parking; try again once it has`
          }
        };
      }
      // Parked on it: `suspended`, or `interrupted` with the gate on its log.
      if (request === undefined || (request.status !== "suspended" && request.status !== "interrupted")) {
        return {
          refusal: {
            ok: false,
            refused: "already-resolved",
            detail: `the turn parked on wait gate "${gate.suspensionId}" is "${request?.status ?? "gone"}", not parked`
          }
        };
      }
      return { suspension };
    },
    action: "submit",
    data: parsed,
    resumedBy,
    // A stop is recorded as one, so the re-drive and any later reader know it.
    ...("stopped" in parsed ? { status: "stopped" as const } : {})
  });

  if (resumed.ok) return { ok: true };
  if ("refusal" in resumed) return resumed.refusal;
  return { ok: false, refused: "busy", detail: "another resume of this turn is in progress" };
}

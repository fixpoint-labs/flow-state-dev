/**
 * Resume one ask gate with an outcome, once: the ask's admission rules over
 * the shared resume path (`resume-under-lease.ts`).
 *
 * Two callers decide whether a gate is theirs to resume and then come here: a
 * conversation resuming its own ask (`context/ask-resume-operation.ts`, which
 * finds the gate within the running session), and the durability sweep
 * resuming an ask past its deadline with `wait_timed_out`
 * (`durability-sweeper.ts`).
 */
import { isAskGate, parseAskOutcome } from "@flow-state-dev/core/types";
import type { AskOutcome, ResumeAskResult, SuspensionRecord } from "@flow-state-dev/core/types";
import type { StoreRegistry } from "../stores/types";
import { latestGateIdOf, resumeUnderLease, type ResumeDeps } from "./resume-under-lease";

/** What {@link resumeAskGate} needs from the host. */
export type AskResumeDeps = ResumeDeps & {
  stores: Pick<StoreRegistry, "request">;
};

/**
 * Resume one ask gate with an outcome, once.
 *
 * The caller has already decided this gate is theirs to resume. This checks
 * only what makes a resume safe, under the request's lease: the gate is an ask,
 * it is still pending, and the request is parked on it. A gate that is no longer
 * pending is `already-resolved`, so a second resume (a notice delivered twice,
 * a marker replayed after the turn resumed) resumes nothing.
 */
export async function resumeAskGate(
  deps: AskResumeDeps,
  gate: Pick<SuspensionRecord, "requestId" | "suspensionId">,
  outcome: AskOutcome,
  resumedBy: string
): Promise<ResumeAskResult> {
  // Refuse to record anything the gate would not read back as an outcome.
  const parsed = parseAskOutcome(outcome);
  if (parsed === undefined) {
    throw new TypeError("resumeAskGate: the outcome is not an ask outcome");
  }

  type Refusal = Extract<ResumeAskResult, { ok: false }>;
  const resumed = await resumeUnderLease<Refusal>(deps, {
    requestId: gate.requestId,
    holder: "resume-ask",
    // Read under the lease, so two resumes racing for one gate cannot both
    // see it pending.
    admit: async () => {
      const suspension = await deps.provider.loadSuspension(gate.requestId, gate.suspensionId);
      if (suspension === null || !isAskGate(suspension)) {
        return {
          refusal: { ok: false, refused: "gate-not-found", detail: `no ask gate "${gate.suspensionId}"` }
        };
      }
      if (suspension.status !== "pending") {
        return {
          refusal: {
            ok: false,
            refused: "already-resolved",
            detail: `ask gate "${gate.suspensionId}" was already resolved (${suspension.status})`
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
            detail: `the turn parked on ask gate "${gate.suspensionId}" was interrupted before it parked; try again once it has`
          }
        };
      }
      // Parked on it: `suspended`, or `interrupted` with the gate on its log.
      if (request === undefined || (request.status !== "suspended" && request.status !== "interrupted")) {
        return {
          refusal: {
            ok: false,
            refused: "already-resolved",
            detail: `the turn parked on ask gate "${gate.suspensionId}" is "${request?.status ?? "gone"}", not parked`
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

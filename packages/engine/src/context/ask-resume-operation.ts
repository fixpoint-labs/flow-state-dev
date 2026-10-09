/**
 * The server-side resume of a turn parked on an ask gate: the host operation
 * behind `RequestHost.resumeAsk`, as `dispatch-operation.ts` is behind the
 * dispatch seam.
 *
 * The public resume route (`routes/resume-routes.ts`) takes a request id and
 * caller-supplied gate data, so it is closed to every ask gate. This is the
 * other way in: a running request in the asker's own session resumes the turn
 * through `RequestHost.resumeAsk` (`create-request-host.ts` closes over the
 * session and finds the gate).
 *
 * This module only finds the gate within the session; the resume itself is
 * `durability/resume-ask-gate.ts`, which the durability sweep also calls to
 * resume an ask past its deadline with `wait_timed_out`.
 */
import { isAskGate } from "@flow-state-dev/core/types";
import type {
  AskOutcome,
  ResumeAskResult,
  SuspensionRecord
} from "@flow-state-dev/core/types";
import { resumeAskGate, type AskResumeDeps } from "../durability/resume-ask-gate";
import { ownsRecord, type OwnerIdentity } from "./record-owner";

/**
 * The session-scoped half of `RequestHost.resumeAsk`: find an ask gate by id
 * among the suspensions of one session and principal, then resume it.
 *
 * Built once per host and handed to every request's request host, which closes
 * it over the running request's identity. The identity arrives from there,
 * never from the block that calls the verb.
 */
export type AskResumeOperation = (input: {
  gateId: string;
  outcome: AskOutcome;
  /** The running request's identity, server-derived. */
  owner: {
    sessionId: string;
    userId: string;
    tenantId: string | undefined;
    orgId: string;
    /** The flow instance that runs the request. */
    flow: OwnerIdentity;
  };
}) => Promise<ResumeAskResult>;

/** Build the {@link AskResumeOperation} a host hands its request hosts. */
export function createAskResumeOperation(deps: AskResumeDeps): AskResumeOperation {
  return async ({ gateId, outcome, owner }) => {
    const notFound: ResumeAskResult = {
      ok: false,
      refused: "gate-not-found",
      detail: `no ask gate "${gateId}" parks a turn in this session`
    };
    // Bounded by the session: a conversation holds few suspensions, and the
    // retention sweep prunes resolved ones. No status filter, so a resolved
    // gate answers `already-resolved` rather than not-found.
    const candidates = await deps.provider.listSuspended({
      sessionId: owner.sessionId,
      userId: owner.userId
    });
    // Fence every candidate BEFORE choosing one, so a gate this conversation
    // does not own can never mask the one it does. The suspension record
    // carries no tenant or org; the request it parks does. Same session,
    // principal, tenant, org and flow instance, or the gate is not this
    // conversation's, and is treated exactly as one that does not exist.
    const owned: SuspensionRecord[] = [];
    for (const candidate of candidates) {
      if (candidate.suspensionId !== gateId || !isAskGate(candidate)) continue;
      const request = await deps.stores.request.get(candidate.requestId);
      if (
        request === undefined ||
        request.sessionId !== owner.sessionId ||
        request.userId !== owner.userId ||
        (request.tenantId ?? undefined) !== owner.tenantId ||
        (request.orgId ?? undefined) !== owner.orgId ||
        !ownsRecord(owner.flow, request)
      ) {
        continue;
      }
      owned.push(candidate);
    }
    if (owned.length === 0) return notFound;

    // A gate id is unique per request, not per session. Two turns of this
    // conversation parked under one id cannot be told apart, and guessing
    // would hand one ask's answer to the other: refuse, resume neither.
    const pending = owned.filter((s) => s.status === "pending");
    if (pending.length > 1) {
      return {
        ok: false,
        refused: "ambiguous",
        detail: `${pending.length} turns in this session are parked on ask gate "${gateId}"`
      };
    }

    // One pending gate is the one to resume; with none, any owned gate answers
    // `already-resolved` through the same path.
    const gate = pending[0] ?? owned[0]!;
    return resumeAskGate(deps, gate, outcome, `ask:${owner.sessionId}`);
  };
}

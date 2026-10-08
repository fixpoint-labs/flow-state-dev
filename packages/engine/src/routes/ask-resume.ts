/**
 * The server-side resume of a turn parked on an ask gate.
 *
 * The public resume route (`resume-routes.ts`) takes a request id and caller-
 * supplied gate data, so it is closed to every ask gate. This is the other way
 * in, and the only one: a running request in the asker's own session resumes
 * the turn through `RequestHost.resumeAsk` (`create-request-host.ts` closes
 * over the session and finds the gate), and the host's durability sweep will
 * resume an ask past its deadline with a timeout error through the same
 * {@link resumeAskGate}.
 *
 * The resume itself is the resume route's, minus everything a caller supplies:
 * load the gate under the request's lease, admit it only while it is an ask
 * gate still pending on a suspended request, record the outcome, and continue
 * the SAME request. The answer reaches the parked call as `ctx.suspend()`'s
 * return value, and a generator's tool returns it as its result.
 */
import { ASK_GATE_REASON, parseAskOutcome } from "@flow-state-dev/core/types";
import type {
  AskOutcome,
  ResumeAskResult,
  ResumeContext,
  SuspensionRecord
} from "@flow-state-dev/core/types";
import type { DurabilityProvider } from "../durability/types";
import type { HostContinueRequestOptions } from "../transports/types";
import type { ContinueRequestResult } from "../execution/request-continuation";
import type { StoreRegistry } from "../stores/types";
import { generateId } from "../utils/generate-id";
import { ownsRecord, type OwnerIdentity } from "../context/record-owner";

/** How long the resume holds the request's lease before the run takes over. */
const RESUME_LEASE_MS = 60_000;

/** Whether a suspension is an ask gate. */
export function isAskGate(suspension: Pick<SuspensionRecord, "reason">): boolean {
  return suspension.reason === ASK_GATE_REASON;
}

/** What {@link resumeAskGate} needs from the host. */
export type AskResumeDeps = {
  provider: DurabilityProvider;
  stores: Pick<StoreRegistry, "request">;
  continueRequest: (options: HostContinueRequestOptions) => Promise<ContinueRequestResult>;
};

/**
 * Resume one ask gate with an outcome, once.
 *
 * The caller has already decided this gate is theirs to resume. This checks
 * only what makes a resume safe: the gate is an ask, it is still pending under
 * the request's lease, and the request is suspended. A gate that is no longer
 * pending is `already-resolved`, so a second resume — a notice delivered twice,
 * a marker replayed after the turn resumed — resumes nothing.
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

  const { provider } = deps;
  const lease = await provider.acquireLease(gate.requestId, {
    holder: generateId("resume-ask"),
    durationMs: RESUME_LEASE_MS
  });
  if (lease === null) {
    return { ok: false, refused: "busy", detail: "another resume of this turn is in progress" };
  }

  // Everything below is read under the lease, so two resumes racing for one
  // gate cannot both see it pending.
  let suspension: SuspensionRecord | null;
  try {
    suspension = await provider.loadSuspension(gate.requestId, gate.suspensionId);
    if (suspension === null || !isAskGate(suspension)) {
      await provider.releaseLease(gate.requestId, lease.leaseId);
      return { ok: false, refused: "gate-not-found", detail: `no ask gate "${gate.suspensionId}"` };
    }
    if (suspension.status !== "pending") {
      await provider.releaseLease(gate.requestId, lease.leaseId);
      return {
        ok: false,
        refused: "already-resolved",
        detail: `ask gate "${gate.suspensionId}" was already resolved (${suspension.status})`
      };
    }
    const request = await deps.stores.request.get(gate.requestId);
    if (request === undefined || request.status !== "suspended") {
      await provider.releaseLease(gate.requestId, lease.leaseId);
      return {
        ok: false,
        refused: "already-resolved",
        detail: `the turn parked on ask gate "${gate.suspensionId}" is "${request?.status ?? "gone"}", not suspended`
      };
    }
  } catch (error) {
    await provider.releaseLease(gate.requestId, lease.leaseId).catch(() => {});
    throw error;
  }

  const resumeContext: ResumeContext = {
    suspensionId: suspension.suspensionId,
    action: "submit",
    data: parsed,
    resumedBy
  };

  try {
    await provider.suspend({
      ...suspension,
      status: "submitted",
      resolvedAt: Date.now(),
      resolvedBy: resumedBy,
      resumeData: parsed
    });
    // Same-request continuation, exactly as the public resume route does it:
    // the parked request re-enters under its own id, and `runAction` releases
    // the lease when it ends or parks again.
    await deps.continueRequest({ requestId: gate.requestId, resumeContext });
    return { ok: true };
  } catch (error) {
    // Setup failed before the run started. Put the gate back so the next
    // attempt can resume it; see the matching catch in `resume-routes.ts` for
    // why nothing after the run starts can reach here.
    await provider.suspend({ ...suspension, status: "pending" }).catch(() => {});
    await provider.releaseLease(gate.requestId, lease.leaseId).catch(() => {});
    throw error;
  }
}

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
    const gate = candidates.find((s) => s.suspensionId === gateId && isAskGate(s));
    if (gate === undefined) return notFound;

    // The suspension record carries no tenant or org; the request it parks
    // does. Same session, principal, tenant, org and flow instance, or the gate
    // is not this conversation's — answered exactly as a gate that does not
    // exist.
    const request = await deps.stores.request.get(gate.requestId);
    if (
      request === undefined ||
      request.sessionId !== owner.sessionId ||
      request.userId !== owner.userId ||
      (request.tenantId ?? undefined) !== owner.tenantId ||
      (request.orgId ?? undefined) !== owner.orgId ||
      !ownsRecord(owner.flow, request)
    ) {
      return notFound;
    }

    return resumeAskGate(deps, gate, outcome, `ask:${owner.sessionId}`);
  };
}

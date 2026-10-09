/**
 * Resolve a suspension and continue its request, under the request's lease.
 *
 * The one path every resume takes, whoever asks for it: the public resume route
 * (`routes/resume-routes.ts`), a conversation resuming its own ask
 * (`context/ask-resume-operation.ts`), and the durability sweep resuming an
 * overdue ask (`durability/durability-sweeper.ts`). Each caller decides
 * whether it may resume; this does the part that must be identical for all of
 * them:
 *
 * 1. Take the request's lease. Held by someone else → `busy`, nothing written.
 * 2. Under the lease, let the caller re-read and admit the suspension, or
 *    refuse. A refusal releases the lease and writes nothing.
 * 3. Record the resolution on the suspension, then continue the SAME request.
 *    `runAction` releases the lease when the run ends or parks again.
 * 4. If setup fails before the run starts, put the suspension back exactly as
 *    it was admitted, release the lease, and rethrow, so the resume can be
 *    tried again. Nothing after the run starts can reach this: see the
 *    containment note on `createInboundTransportHost`'s `continueRequest`.
 */
import {
  RESUME_ACTION_STATUS,
  type ResumeAction,
  type ResumeContext,
  type SuspensionRecord,
  type SuspensionStatus
} from "@flow-state-dev/core/types";
import type { ContinueRequestResult } from "../execution/request-continuation";
import type { HostContinueRequestOptions } from "../transports/types";
import { generateId } from "../utils/generate-id";
import type { DurabilityProvider } from "./types";

/** How long a resume holds the request's lease before the run takes over. */
export const RESUME_LEASE_MS = 60_000;

/** What a resume needs from the host. */
export type ResumeDeps = {
  provider: DurabilityProvider;
  continueRequest: (options: HostContinueRequestOptions) => Promise<ContinueRequestResult>;
};

/** The outcome of {@link resumeUnderLease}. */
export type LeasedResume<TRefusal> =
  | { readonly ok: true; readonly handle: ContinueRequestResult }
  | { readonly ok: false; readonly busy: true }
  | { readonly ok: false; readonly refusal: TRefusal };

export async function resumeUnderLease<TRefusal>(
  deps: ResumeDeps,
  args: {
    requestId: string;
    /** Prefix for the lease holder's id, naming who resumed. */
    holder: string;
    /** Runs under the lease: the suspension to resolve, or why not. */
    admit: () => Promise<{ suspension: SuspensionRecord } | { refusal: TRefusal }>;
    /** How the admitted suspension resolves; its status follows from this. */
    action: ResumeAction;
    data?: unknown;
    resumedBy?: string;
    /** The status the gate is recorded with, when it is not the action's own (a stop). */
    status?: SuspensionStatus;
  }
): Promise<LeasedResume<TRefusal>> {
  const { provider } = deps;
  const lease = await provider.acquireLease(args.requestId, {
    holder: generateId(args.holder),
    durationMs: RESUME_LEASE_MS
  });
  if (lease === null) return { ok: false, busy: true };

  let suspension: SuspensionRecord;
  try {
    const admitted = await args.admit();
    if ("refusal" in admitted) {
      await provider.releaseLease(args.requestId, lease.leaseId);
      return { ok: false, refusal: admitted.refusal };
    }
    suspension = admitted.suspension;
  } catch (error) {
    await provider.releaseLease(args.requestId, lease.leaseId).catch(() => {});
    throw error;
  }

  try {
    await provider.suspend({
      ...suspension,
      status: args.status ?? RESUME_ACTION_STATUS[args.action],
      resolvedAt: Date.now(),
      resolvedBy: args.resumedBy,
      resumeData: args.data
    });
    const handle = await deps.continueRequest({
      requestId: args.requestId,
      resumeContext: {
        suspensionId: suspension.suspensionId,
        action: args.action,
        data: args.data,
        resumedBy: args.resumedBy
      }
    });
    return { ok: true, handle };
  } catch (error) {
    await provider.suspend({ ...suspension, status: "pending" }).catch(() => {});
    await provider.releaseLease(args.requestId, lease.leaseId).catch(() => {});
    throw error;
  }
}

/**
 * Continue a request whose gate is already resolved, under the request's
 * lease: the re-drive (BR-11a). The gate's recorded resolution is the record
 * of what is owed, so nothing is written to it; the caller admits the request
 * under the lease and names the resolution to replay. A live resume holds the
 * lease, so this never races one. If setup fails before the run starts, the
 * lease is released and the error rethrown; the gate stays resolved for the
 * next attempt.
 */
export async function continueUnderLease<TRefusal>(
  deps: ResumeDeps,
  args: {
    requestId: string;
    holder: string;
    admit: () => Promise<{ resumeContext: ResumeContext } | { refusal: TRefusal }>;
  }
): Promise<LeasedResume<TRefusal>> {
  const { provider } = deps;
  const lease = await provider.acquireLease(args.requestId, {
    holder: generateId(args.holder),
    durationMs: RESUME_LEASE_MS
  });
  if (lease === null) return { ok: false, busy: true };
  try {
    const admitted = await args.admit();
    if ("refusal" in admitted) {
      await provider.releaseLease(args.requestId, lease.leaseId);
      return { ok: false, refusal: admitted.refusal };
    }
    const handle = await deps.continueRequest({
      requestId: args.requestId,
      resumeContext: admitted.resumeContext
    });
    return { ok: true, handle };
  } catch (error) {
    await provider.releaseLease(args.requestId, lease.leaseId).catch(() => {});
    throw error;
  }
}

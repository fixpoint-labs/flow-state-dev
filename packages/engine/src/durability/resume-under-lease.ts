/**
 * Resolve a suspension and continue its request, under the request's lease.
 *
 * Shared by the public resume route, an ask resume, and (through that) the
 * durability sweep. The caller admits the suspension under the lease. This
 * records the resolution, continues the same request, and, if setup fails
 * before the run starts, puts the suspension back and releases the lease.
 * Nothing after the run starts can reach that revert: see the containment
 * note on `createInboundTransportHost`'s `continueRequest`.
 */
import {
  RESUME_ACTION_STATUS,
  type ResumeAction,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import type { ContinueRequestResult } from "../execution/request-continuation";
import type { HostContinueRequestOptions } from "../transports/types";
import { generateId } from "../utils/generate-id";
import type { DurabilityProvider } from "./types";

/** How long a resume holds the request's lease before the run takes over. */
const RESUME_LEASE_MS = 60_000;

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
    action: ResumeAction;
    data?: unknown;
    resumedBy?: string;
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
      status: RESUME_ACTION_STATUS[args.action],
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

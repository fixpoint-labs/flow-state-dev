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

/**
 * The last gate the request's item log parked on, if it has one: the gate a
 * continuation's replay can resolve.
 */
export function latestGateIdOf(record: { readonly items?: readonly unknown[] }): string | undefined {
  const items = record.items ?? [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as { type?: string; suspensionId?: string };
    if (item.type === "suspension") return item.suspensionId;
  }
  return undefined;
}

/** How long a resume holds the request's lease before the run takes over. */
export const RESUME_LEASE_MS = 60_000;

/**
 * Write a pending gate `expired`, fenced under its request's lease: the one
 * way every expiry writer (the durability sweep, the resume route) records an
 * expiry (FIX-1846). Every other resolution of a gate (a person's resume, an
 * ask's answer, a stop) is written under that lease, so the gate re-read while
 * holding it is current: a resolution that landed after the caller's own read
 * is never overwritten. `gate` names the gate; its fields are not written.
 * A lease held elsewhere (a resume, or its run) writes nothing: `busy`.
 */
export async function expireUnderLease(
  provider: DurabilityProvider,
  gate: Pick<SuspensionRecord, "requestId" | "suspensionId">,
  resolvedBy?: string
): Promise<"expired" | "already-resolved" | "busy"> {
  const lease = await provider.acquireLease(gate.requestId, {
    holder: generateId("expire"),
    durationMs: RESUME_LEASE_MS
  });
  if (lease === null) return "busy";
  try {
    const current = await provider.loadSuspension(gate.requestId, gate.suspensionId);
    if (current === null || current.status !== "pending") return "already-resolved";
    await provider.suspend({
      ...current,
      status: "expired",
      resolvedAt: Date.now(),
      ...(resolvedBy !== undefined ? { resolvedBy } : {})
    });
    return "expired";
  } finally {
    await provider.releaseLease(gate.requestId, lease.leaseId);
  }
}

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
 * lease is released and the gate keeps its resolution for the next sweep: here
 * the error is rethrown; after the handle is returned, `runAction`'s
 * pre-transition recovery leaves the gates a re-drive continues (an answered
 * ask, a stop) resolved.
 */
export async function continueUnderLease<TRefusal>(
  deps: ResumeDeps,
  args: {
    requestId: string;
    holder: string;
    /** The resolution to replay; absent → continued as crash recovery continues it. */
    admit: () => Promise<{ resumeContext: ResumeContext | undefined } | { refusal: TRefusal }>;
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
      ...(admitted.resumeContext !== undefined ? { resumeContext: admitted.resumeContext } : {})
    });
    return { ok: true, handle };
  } catch (error) {
    await provider.releaseLease(args.requestId, lease.leaseId).catch(() => {});
    throw error;
  }
}

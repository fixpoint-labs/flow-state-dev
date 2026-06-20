/**
 * useSuspensions — derives pending/resolved suspension state from a session's
 * live item stream and provides approve/reject actions (FIX-276).
 *
 * Suspensions surface when a durable action calls `ctx.suspend()` (e.g. to wait
 * for human approval). The pause emits a `suspension` item; the eventual
 * resolution emits a matching `suspension_resume` item into the same stream.
 * This hook folds both halves into a stable view and exposes `approve`/`reject`
 * callbacks that POST to the recovery endpoint. Transport lives in the client —
 * this hook only derives state and tracks in-flight/error UI status.
 */
import { useCallback, useMemo, useState } from "react";
import {
  createRecoveryClient,
  type ResumeSuspensionResult
} from "@flow-state-dev/client";
import {
  isSuspensionItem,
  isSuspensionResumeItem,
  type OutputItem,
  type SuspensionItem,
  type SuspensionResumeItem
} from "@flow-state-dev/core/items";
import type { SuspensionReason, SuspensionStatus } from "@flow-state-dev/core/types";
import { useFlowContext } from "../context/FlowContext";
import type { SessionView } from "./useSession";

/**
 * Narrowing options for {@link useSuspensions}.
 */
export interface UseSuspensionsOptions {
  /** Restrict to a single request's suspensions. Default: all in session.items. */
  requestId?: string;
  /** Restrict to specific reasons (e.g. ["human_approval"]). Default: all reasons. */
  reasons?: SuspensionReason[];
}

/**
 * A single suspension folded with its resolution (if any). `status`/`pending`
 * reflect whether a matching `suspension_resume` item has arrived; `isResolving`
 * reflects an in-flight approve/reject call for this specific suspension.
 */
export interface SuspensionView {
  /** The suspension item itself. */
  item: SuspensionItem;
  /** "pending" until a matching suspension_resume item appears; then its resolution. */
  status: SuspensionStatus;
  /** True when no matching suspension_resume item exists yet. */
  pending: boolean;
  /** The resolution payload, once resolved (from the suspension_resume item). */
  resumeData?: unknown;
  resolvedBy?: string;
  /** True while an approve/reject call for this suspension is in flight. */
  isResolving: boolean;
}

/**
 * Reactive suspension view plus approve/reject actions returned by
 * {@link useSuspensions}.
 */
export interface UseSuspensionsResult {
  /** All suspensions (pending + resolved) matching the options, in stream order. */
  suspensions: SuspensionView[];
  /** Convenience filter: only pending suspensions. */
  pending: SuspensionView[];
  approve: (suspensionId: string, data?: unknown) => Promise<ResumeSuspensionResult>;
  reject: (suspensionId: string, data?: unknown) => Promise<ResumeSuspensionResult>;
  /**
   * Most-recent failed approve/reject error (also rethrown by the call).
   * Single-slot: concurrent resolves of different ids overwrite each other.
   */
  error: Error | null;
}

/**
 * Pure derivation over a session's item stream — the body of the hook's
 * `useMemo`. Collects `suspension` items, indexes `suspension_resume` items by
 * `suspensionId`, applies the option filters, and stamps `isResolving` from the
 * supplied in-flight set. Exported for direct unit testing (the react package
 * has no DOM render harness by convention).
 */
export function deriveSuspensions(
  items: readonly OutputItem[],
  options: UseSuspensionsOptions = {},
  inFlight: ReadonlySet<string> = new Set()
): { suspensions: SuspensionView[]; pending: SuspensionView[] } {
  const resumeIndex = new Map<string, SuspensionResumeItem>();
  for (const item of items) {
    if (isSuspensionResumeItem(item)) {
      const resumeItem = item as SuspensionResumeItem;
      resumeIndex.set(resumeItem.suspensionId, resumeItem);
    }
  }

  const suspensions: SuspensionView[] = [];
  for (const item of items) {
    if (!isSuspensionItem(item)) continue;
    const suspItem = item as SuspensionItem;
    if (options.requestId !== undefined && suspItem.requestId !== options.requestId) continue;
    if (options.reasons !== undefined && !options.reasons.includes(suspItem.reason)) continue;
    const resume = resumeIndex.get(suspItem.suspensionId);
    suspensions.push({
      item: suspItem,
      pending: resume === undefined,
      status: resume?.resolution ?? "pending",
      resumeData: resume?.resumeData,
      resolvedBy: resume?.resolvedBy,
      isResolving: inFlight.has(suspItem.suspensionId)
    });
  }

  return {
    suspensions,
    pending: suspensions.filter((view) => view.pending)
  };
}

/**
 * Arguments for {@link resolveSuspension}. `markStart`/`markEnd` toggle the
 * caller's in-flight set; `setError` is the error slot setter.
 */
export interface ResolveSuspensionArgs {
  recoveryClient: {
    resumeSuspension: (
      flowKind: string,
      requestId: string,
      body: {
        suspensionId: string;
        action: "approve" | "reject";
        data?: unknown;
        resumedBy?: string;
      }
    ) => Promise<ResumeSuspensionResult>;
  };
  flowKind: string;
  item: Pick<SuspensionItem, "suspensionId" | "requestId">;
  action: "approve" | "reject";
  data?: unknown;
  resumedBy?: string;
  markStart: (id: string) => void;
  markEnd: (id: string) => void;
  setError: (error: Error | null) => void;
}

/**
 * The shared body of `approve`/`reject`. Marks in-flight, POSTs the resolution
 * to the suspension's own `requestId`, captures any error into `setError`, and
 * **rethrows** so callers can branch on success. In-flight is always cleared in
 * `finally`. Exported for direct unit testing.
 */
export async function resolveSuspension(
  args: ResolveSuspensionArgs
): Promise<ResumeSuspensionResult> {
  const { item } = args;
  args.markStart(item.suspensionId);
  args.setError(null);
  try {
    return await args.recoveryClient.resumeSuspension(args.flowKind, item.requestId, {
      suspensionId: item.suspensionId,
      action: args.action,
      data: args.data,
      resumedBy: args.resumedBy
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    args.setError(error);
    throw err;
  } finally {
    args.markEnd(item.suspensionId);
  }
}

/**
 * Derives suspension state from `session.items` and returns approve/reject
 * actions. Derivation is a `useMemo` over the live stream (BP-010); resolution
 * goes through the recovery client built from the FlowContext `baseUrl`.
 */
export function useSuspensions(
  session: SessionView,
  options: UseSuspensionsOptions = {}
): UseSuspensionsResult {
  const { baseUrl, userId: ctxUserId } = useFlowContext();
  const recoveryClient = useMemo(() => createRecoveryClient({ baseUrl }), [baseUrl]);

  // In-flight suspensionIds, immutably updated so concurrent resolves of
  // different ids never clobber one another's membership.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<Error | null>(null);

  const { requestId, reasons } = options;
  const { suspensions, pending } = useMemo(
    () => deriveSuspensions(session.items, { requestId, reasons }, inFlight),
    [session.items, requestId, reasons, inFlight]
  );

  const markStart = useCallback((id: string) => {
    setInFlight((prev) => new Set(prev).add(id));
  }, []);
  const markEnd = useCallback((id: string) => {
    setInFlight((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const resolvedBy = ctxUserId ?? session.userId;

  const resolve = useCallback(
    (action: "approve" | "reject") =>
      (suspensionId: string, data?: unknown): Promise<ResumeSuspensionResult> => {
        const target = session.items.find(
          (item): item is SuspensionItem => {
            if (!isSuspensionItem(item)) return false;
            return (item as SuspensionItem).suspensionId === suspensionId;
          }
        );
        if (target === undefined) {
          return Promise.reject(new Error("No suspension found with id: " + suspensionId));
        }
        return resolveSuspension({
          recoveryClient,
          flowKind: session.flowKind,
          item: target,
          action,
          data,
          resumedBy: resolvedBy,
          markStart,
          markEnd,
          setError
        });
      },
    [recoveryClient, session.items, session.flowKind, resolvedBy, markStart, markEnd]
  );

  const approve = useMemo(() => resolve("approve"), [resolve]);
  const reject = useMemo(() => resolve("reject"), [resolve]);

  return { suspensions, pending, approve, reject, error };
}

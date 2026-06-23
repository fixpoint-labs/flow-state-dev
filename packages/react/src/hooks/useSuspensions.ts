/**
 * useSuspensions — derives pending/resolved suspension state from a session's
 * live item stream and provides approve/reject actions (FIX-276).
 *
 * Suspensions surface when a durable action calls `ctx.suspend()` (e.g. to wait
 * for human approval). The pause emits a `suspension` item; the eventual
 * resolution emits a matching `suspension_resume` item into the same stream.
 * This hook folds both halves into a stable view and exposes `approve`/`reject`
 * callbacks that resolve through the session's STREAMING resume — so the resumed
 * continuation streams straight into `session.items` and the resolution renders
 * live, with no page refresh (FIX-276). Transport lives in the client /
 * `useSession`; this hook only derives state and tracks in-flight/error UI
 * status.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  OutputItem,
  SuspensionItem,
  SuspensionResumeItem
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
  /**
   * Approve a suspension and stream its continuation back into `session.items`.
   * Resolves once the resume has been dispatched (the continuation then streams
   * in live); rejects if the resume call fails.
   */
  approve: (suspensionId: string, data?: unknown) => Promise<void>;
  /** Reject a suspension. Same streaming semantics as {@link approve}. */
  reject: (suspensionId: string, data?: unknown) => Promise<void>;
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
  // Match by `type` literal — this package imports only TYPES from core, not
  // its runtime predicates.
  const resumeIndex = new Map<string, SuspensionResumeItem>();
  for (const item of items) {
    if (item.type === "suspension_resume") {
      const resumeItem = item as SuspensionResumeItem;
      resumeIndex.set(resumeItem.suspensionId, resumeItem);
    }
  }

  const suspensions: SuspensionView[] = [];
  for (const item of items) {
    if (item.type !== "suspension") continue;
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
 * caller's in-flight set; `setError` is the error slot setter. `resolve` is the
 * session's streaming resume (`SessionView.resumeSuspension`) — the resolution
 * streams the continuation back into `session.items`.
 */
export interface ResolveSuspensionArgs {
  resolve: (args: {
    suspensionId: string;
    requestId: string;
    action: "approve" | "reject";
    data?: unknown;
    resumedBy?: string;
  }) => Promise<void>;
  item: Pick<SuspensionItem, "suspensionId" | "requestId">;
  action: "approve" | "reject";
  data?: unknown;
  resumedBy?: string;
  markStart: (id: string) => void;
  markEnd: (id: string) => void;
  setError: (error: Error | null) => void;
}

/**
 * The shared body of `approve`/`reject`. Marks in-flight, streams the resolution
 * through the session's resume (so the continuation renders live), captures any
 * error into `setError`, and **rethrows** so callers can branch on success.
 * In-flight is always cleared in `finally`. Exported for direct unit testing.
 */
export async function resolveSuspension(
  args: ResolveSuspensionArgs
): Promise<void> {
  const { item } = args;
  args.markStart(item.suspensionId);
  args.setError(null);
  try {
    await args.resolve({
      suspensionId: item.suspensionId,
      requestId: item.requestId,
      action: args.action,
      data: args.data,
      resumedBy: args.resumedBy
    });
  } catch (err) {
    // Normalize once and rethrow the SAME value stored in the error slot, so a
    // caller catching the rejection and the `error` state never diverge (they
    // would for a non-Error throw).
    const error = err instanceof Error ? err : new Error(String(err));
    args.setError(error);
    throw error;
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
  const { userId: ctxUserId } = useFlowContext();

  // In-flight suspensionIds, immutably updated so concurrent resolves of
  // different ids never clobber one another's membership.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<Error | null>(null);

  const { requestId, reasons } = options;
  // Key the reasons array by value, not reference: an inline literal
  // (`useSuspensions(session, { reasons: ["human_approval"] })`) is a new array
  // every render, which would force deriveSuspensions to recompute each time.
  const reasonsKey = reasons === undefined ? undefined : reasons.join(" ");
  const { suspensions, pending } = useMemo(
    () => deriveSuspensions(session.items, { requestId, reasons }, inFlight),
    // `reasons` is intentionally tracked via `reasonsKey` (by value, not reference).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.items, requestId, reasonsKey, inFlight]
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
      (suspensionId: string, data?: unknown): Promise<void> => {
        const target = session.items.find(
          (item): item is SuspensionItem => {
            if (item.type !== "suspension") return false;
            return (item as SuspensionItem).suspensionId === suspensionId;
          }
        );
        if (target === undefined) {
          return Promise.reject(new Error("No suspension found with id: " + suspensionId));
        }
        return resolveSuspension({
          resolve: session.resumeSuspension,
          item: target,
          action,
          data,
          resumedBy: resolvedBy,
          markStart,
          markEnd,
          setError
        });
      },
    [session.resumeSuspension, session.items, resolvedBy, markStart, markEnd]
  );

  const approve = useMemo(() => resolve("approve"), [resolve]);
  const reject = useMemo(() => resolve("reject"), [resolve]);

  return { suspensions, pending, approve, reject, error };
}

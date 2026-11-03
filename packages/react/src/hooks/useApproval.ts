/**
 * Headless controller for human-in-the-loop suspension approvals.
 *
 * Owns the *logic* of resolving a suspension — resume transport, in-flight and
 * error state, the re-entry/duplicate guard, and the resolved outcome — with no
 * markup of its own. Presentation lives in the consumer: the minimal built-in
 * `<ApprovalRenderer>` (this package) and the polished `Approval` card in
 * `@flow-state-dev/ui` both call this hook and render the result their own way.
 *
 * Resolution transport, in precedence order:
 *   1. onApprove/onReject options → caller owns the resume call
 *   2. SuspensionResolverProvider → resolve through the session's STREAMING
 *      resume, so the continuation streams into the chat view live (no refresh)
 *   3. self-contained recovery client (non-streaming fire-and-forget fallback)
 */
import { useState, useMemo, useCallback, useEffect } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useFlowContext } from "../context/FlowContext";
import { useClient } from "../internal/useClient";
import { useSuspensionResolver } from "../context/SuspensionResolver";

// ---------------------------------------------------------------------------
// Receipt outcome derivation
// ---------------------------------------------------------------------------

/** Presentation-neutral descriptor for a resolved suspension: icon glyph + label. */
export type ApprovalOutcome = {
  icon: string;
  label: string;
};

/**
 * Map a resolved suspension status to its receipt descriptor. `undefined` (the
 * card knows it resolved but not how) collapses to a neutral "Resolved" receipt.
 * Returns only icon + label — colour/tone is the renderer's concern.
 */
export function resolveApprovalOutcome(
  status: SuspensionStatus | undefined
): ApprovalOutcome {
  switch (status) {
    case "approved":
      return { icon: "✓", label: "Approved" };
    case "rejected":
      return { icon: "✕", label: "Rejected" };
    case "submitted":
      return { icon: "✓", label: "Submitted" };
    case "skipped":
      return { icon: "⤼", label: "Skipped" };
    case "timed_out":
      return { icon: "⏲", label: "Timed out" };
    case "expired":
      return { icon: "⏲", label: "Expired" };
    case "stopped":
      return { icon: "■", label: "Stopped" };
    case "cancelled":
      return { icon: "■", label: "Cancelled" };
    default:
      return { icon: "•", label: "Resolved" };
  }
}

// ---------------------------------------------------------------------------
// Extra yeses a stop offers
// ---------------------------------------------------------------------------

/**
 * One more way to say yes that a stop offers beside the plain approve: the
 * label a card shows, and the data the approve sends with it.
 */
export type ApprovalOption = {
  label: string;
  data?: unknown;
};

/**
 * The extra yeses a suspension offers, read off its `data.approveOptions`
 * (each `{ label, data? }`). Entries that aren't one are left out, and a stop
 * that lists none offers only the plain approve.
 */
export function approveOptionsOf(item: Pick<SuspensionItem, "data">): ApprovalOption[] {
  const listed = item.data?.approveOptions;
  if (!Array.isArray(listed)) return [];
  return listed.filter(
    (option): option is ApprovalOption =>
      option !== null && typeof option === "object" && typeof (option as { label?: unknown }).label === "string"
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Options for {@link useApproval}. */
export type UseApprovalOptions = {
  /**
   * Whether a matching `suspension_resume` item has already arrived. Drives the
   * resolved/receipt state on reload or when resolved elsewhere. Renderers that
   * see the full stream supply this (the built-in card via the renderer
   * pipeline; the ui card via session-items context).
   */
  isResolved?: boolean;
  /** How the suspension was resolved, when known — drives the receipt outcome. */
  resolution?: SuspensionStatus;
  /** Override the approve resume call (caller owns the transport + its state). */
  onApprove?: (data?: unknown) => void | Promise<unknown>;
  /** Override the reject resume call (caller owns the transport + its state). */
  onReject?: (data?: unknown) => void | Promise<unknown>;
};

/** Return value of {@link useApproval}. */
export type UseApprovalResult = {
  /**
   * Approve the suspension. No-op while resolving or already resolved. Takes
   * no argument, so it can be a click handler as it is.
   */
  approve: () => void;
  /** Reject the suspension. No-op while resolving or already resolved. */
  reject: () => void;
  /**
   * Approve, sending `data` with the yes (an {@link ApprovalOption}'s data,
   * say). The same guards as {@link approve}.
   */
  approveWith: (data: unknown) => void;
  /** Reject, sending `data` with the no (a note, say). The same guards as {@link reject}. */
  rejectWith: (data: unknown) => void;
  /** The action currently in flight, or null. Each label can show its own progress. */
  pendingAction: "approve" | "reject" | null;
  /** True while a resume call is in flight. */
  isResolving: boolean;
  /** Last resume error message, or null. */
  error: string | null;
  /** True once resolved (by this hook or an external `isResolved`). */
  resolved: boolean;
  /** The resolved status when known (local action wins, else `resolution`). */
  resolvedStatus: SuspensionStatus | undefined;
  /** Icon + label for the resolved receipt. */
  outcome: ApprovalOutcome;
  /** Whether the approve action is currently available. */
  canApprove: boolean;
  /** Whether the reject action is currently available. */
  canReject: boolean;
};

/**
 * Drive a suspension approval. Reads FlowContext for resume credentials and the
 * nearest SuspensionResolverProvider for streaming resolution. Returns callbacks
 * plus the in-flight / resolved / outcome state a card needs to render.
 */
export function useApproval(
  item: SuspensionItem,
  options: UseApprovalOptions = {}
): UseApprovalResult {
  const { isResolved = false, resolution, onApprove, onReject } = options;
  const { flowKind, userId } = useFlowContext();
  const fsd = useClient();
  const streamingResolve = useSuspensionResolver();

  // The action currently in flight, or null when idle. Doubles as the
  // "is resolving" flag and lets each button label its own progress correctly.
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const isResolving = pendingAction !== null;
  const [error, setError] = useState<string | null>(null);
  // The action this hook took, captured on a successful local resolve so the
  // receipt can show the real outcome before (or without) a `resolution`
  // propagating back. null until this hook resolves its own suspension.
  const [resolvedAction, setResolvedAction] = useState<"approve" | "reject" | null>(null);


  // A streaming resolver from context enables both actions just like a flowKind.
  const hasFlowKind = flowKind !== undefined && flowKind.length > 0;
  const canResolveInternally = hasFlowKind || streamingResolve !== null;
  const resolved = isResolved || resolvedAction !== null;
  const canApprove = !resolved && (onApprove !== undefined || canResolveInternally);
  const canReject = !resolved && (onReject !== undefined || canResolveInternally);
  const canResume = canApprove || canReject;

  // Warn once on mount when there's no way to call resume. useEffect keeps this
  // out of SSR and prevents a flood on every re-render.
  useEffect(() => {
    if (!canResume && !resolved) {
      console.warn(
        "[useApproval] Cannot resume suspension without flowKind on <FlowProvider>. " +
          "Either set flowKind on the provider, or supply onApprove/onReject."
      );
    }
    // Fires once on mount by design — not re-run when capability changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAction = useCallback(
    async (action: "approve" | "reject", data?: unknown) => {
      // Guard re-entry directly, not just via a disabled attribute: between the
      // click and the re-render that flips `pendingAction`, a second click (or a
      // programmatic call) would otherwise fire a duplicate resume and 409.
      if (isResolving) return;
      const actionAllowed = action === "approve" ? canApprove : canReject;
      if (!actionAllowed) return;

      const handler = action === "approve" ? onApprove : onReject;

      setPendingAction(action);
      setError(null);
      try {
        if (handler !== undefined) {
          // Override path: the caller owns the resume call and its in-flight state.
          await handler(data);
        } else if (streamingResolve !== null) {
          // Streaming path: resolve through the session that owns the live stream,
          // so the continuation renders into the chat view without a refresh.
          await streamingResolve({
            suspensionId: item.suspensionId,
            requestId: item.requestId,
            action,
            ...(data !== undefined ? { data } : {})
          });
        } else {
          // Self-contained fallback: non-streaming fire-and-forget resume.
          if (!hasFlowKind) return;
          await fsd.flow(flowKind!).request(item.requestId).resume({
            suspensionId: item.suspensionId,
            action,
            ...(data !== undefined ? { data } : {}),
            resumedBy: userId
          });
        }
        // Success: mark resolved immediately so a card that lingers before its
        // `suspension_resume` item arrives can't be resolved twice.
        setResolvedAction(action);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resume suspension");
      } finally {
        setPendingAction(null);
      }
    },
    [isResolving, canApprove, canReject, hasFlowKind, flowKind, item.requestId, item.suspensionId, userId, fsd, streamingResolve, onApprove, onReject]
  );

  const approve = useCallback(() => { void handleAction("approve"); }, [handleAction]);
  const reject = useCallback(() => { void handleAction("reject"); }, [handleAction]);
  const approveWith = useCallback((data: unknown) => { void handleAction("approve", data); }, [handleAction]);
  const rejectWith = useCallback((data: unknown) => { void handleAction("reject", data); }, [handleAction]);

  // Prefer the action this hook took; otherwise the supplied resolution.
  const resolvedStatus: SuspensionStatus | undefined =
    resolvedAction === "approve" ? "approved"
    : resolvedAction === "reject" ? "rejected"
    : resolution;

  return {
    approve,
    approveWith,
    reject,
    rejectWith,
    pendingAction,
    isResolving,
    error,
    resolved,
    resolvedStatus,
    outcome: resolveApprovalOutcome(resolvedStatus),
    canApprove,
    canReject
  };
}

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
import { createRecoveryClient } from "@flow-state-dev/client";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useFlowContext } from "../context/FlowContext";
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
    case "timed_out":
      return { icon: "⏲", label: "Timed out" };
    case "expired":
      return { icon: "⏲", label: "Expired" };
    default:
      return { icon: "•", label: "Resolved" };
  }
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
  /** Approve the suspension. No-op while resolving or already resolved. */
  approve: () => void;
  /** Reject the suspension. No-op while resolving or already resolved. */
  reject: () => void;
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
  const { flowKind, baseUrl, userId } = useFlowContext();
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

  const recoveryClient = useMemo(() => createRecoveryClient({ baseUrl }), [baseUrl]);

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
    async (action: "approve" | "reject") => {
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
          await handler();
        } else if (streamingResolve !== null) {
          // Streaming path: resolve through the session that owns the live stream,
          // so the continuation renders into the chat view without a refresh.
          await streamingResolve({
            suspensionId: item.suspensionId,
            requestId: item.requestId,
            action
          });
        } else {
          // Self-contained fallback: non-streaming fire-and-forget resume.
          if (!hasFlowKind) return;
          await recoveryClient.resumeSuspension(flowKind!, item.requestId, {
            suspensionId: item.suspensionId,
            action,
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
    [isResolving, canApprove, canReject, hasFlowKind, flowKind, item.requestId, item.suspensionId, userId, recoveryClient, streamingResolve, onApprove, onReject]
  );

  const approve = useCallback(() => { void handleAction("approve"); }, [handleAction]);
  const reject = useCallback(() => { void handleAction("reject"); }, [handleAction]);

  // Prefer the action this hook took; otherwise the supplied resolution.
  const resolvedStatus: SuspensionStatus | undefined =
    resolvedAction === "approve" ? "approved"
    : resolvedAction === "reject" ? "rejected"
    : resolution;

  return {
    approve,
    reject,
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

/**
 * Default approval card for suspension items in the standard item rendering pipeline.
 *
 * Self-contained: reads FlowContext for flowKind/baseUrl/userId, creates its own
 * memoized recovery client, and manages per-item in-flight/error state. An app can
 * pass onApprove/onReject handlers to override the self-contained resume logic
 * (e.g., when integrating with a page-level useSuspensions hook).
 *
 * Resolution transport, in precedence order:
 *   1. onApprove/onReject props  → caller owns the resume call
 *   2. SuspensionResolverProvider → resolve through the session's STREAMING
 *      resume, so the continuation streams into the chat view live (no refresh)
 *   3. self-contained recovery client (non-streaming fire-and-forget fallback)
 *
 * Resolution order in <ItemRenderer>:
 *   1. Custom renderer registered under renderers.suspension
 *   2. false  → suppressed (headless/custom-layout mode)
 *   3. <ApprovalRenderer> (this component)  ← default fallback for type="suspension"
 *
 * When used inline without FlowContext.flowKind and without onApprove/onReject,
 * the buttons render disabled and a console.warn is emitted (dev-only guidance).
 */
import { createElement, useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import { createRecoveryClient } from "@flow-state-dev/client";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import { useSuspensionResolver } from "../context/SuspensionResolver";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props for the default approval card.
 *
 * When onApprove/onReject are supplied, they are used instead of the built-in
 * recovery client — useful when a parent useSuspensions hook manages the
 * resume call and in-flight state.
 */
export interface ApprovalRendererProps {
  /** The suspension item to render an approval card for. */
  item: SuspensionItem;
  /**
   * When true, both buttons are disabled and show a resolved state. Use this
   * when a `suspension_resume` item has already arrived for this suspension
   * (e.g. pass `!view.pending` from a `useSuspensions` result) to prevent
   * duplicate resume calls.
   */
  isResolved?: boolean;
  /**
   * Optional override for the approve action. When supplied, replaces the
   * component's internal resumeSuspension call. Only the Approve button is
   * enabled when this is provided without a matching `flowKind`.
   */
  onApprove?: (data?: unknown) => void | Promise<unknown>;
  /**
   * Optional override for the reject action. When supplied, replaces the
   * component's internal resumeSuspension call. Only the Reject button is
   * enabled when this is provided without a matching `flowKind`.
   */
  onReject?: (data?: unknown) => void | Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Self-contained default approval card for `type === "suspension"` items.
 *
 * Reads FlowContext for resume credentials. If FlowContext.flowKind is absent
 * and no onApprove/onReject handlers are supplied, buttons render disabled with
 * a console.warn (cannot resume without flowKind on <FlowProvider>).
 *
 * Pass `isResolved={!view.pending}` from a `useSuspensions` result to disable
 * both buttons once the suspension has been resolved, preventing duplicate
 * resume calls (which would otherwise result in 409 responses).
 */
export function ApprovalRenderer(props: ApprovalRendererProps): ReactNode {
  const { item, isResolved = false, onApprove, onReject } = props;
  const { flowKind, baseUrl, userId } = useFlowContext();
  // Streaming resolver from the nearest SuspensionResolverProvider, if any. When
  // present (and no explicit on{Approve,Reject} override), resolving goes through
  // the session's streaming resume so the continuation renders live.
  const streamingResolve = useSuspensionResolver();

  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  // Set once this card successfully resolves its suspension, before the matching
  // `suspension_resume` item has propagated back through `isResolved`. Prevents a
  // second click from hitting an already-resolved suspension (a 409). The
  // stream-derived `isResolved` takes over for the durable/replayed state.
  const [locallyResolved, setLocallyResolved] = useState(false);

  const recoveryClient = useMemo(
    () => createRecoveryClient({ baseUrl }),
    [baseUrl]
  );

  // Compute per-action capability so a single supplied handler doesn't enable
  // the other button (e.g. onApprove only → Reject stays disabled). A streaming
  // resolver from context enables both buttons just like a flowKind does.
  const hasFlowKind = flowKind !== undefined && flowKind.length > 0;
  const canResolveInternally = hasFlowKind || streamingResolve !== null;
  const resolved = isResolved || locallyResolved;
  const canApprove = !resolved && (onApprove !== undefined || canResolveInternally);
  const canReject = !resolved && (onReject !== undefined || canResolveInternally);
  const canResume = canApprove || canReject;

  // Warn once on mount when the card has no way to call resume. useEffect
  // keeps this out of SSR and prevents a flood on every re-render.
  useEffect(() => {
    if (!canResume) {
      console.warn(
        "[ApprovalRenderer] Cannot resume suspension without flowKind on <FlowProvider>. " +
          "Either set flowKind on the provider, or supply onApprove/onReject handlers."
      );
    }
    // Deliberately not re-running when canResume changes — the guidance fires
    // once on mount so the dev sees it without a flood on re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAction = useCallback(
    async (action: "approve" | "reject") => {
      // Guard re-entry directly, not just via the button's `disabled` attribute:
      // between the click and the re-render that flips `isResolving`, a second
      // click (or a programmatic call) would otherwise fire a duplicate resume
      // and 409.
      if (isResolving) return;
      const actionAllowed = action === "approve" ? canApprove : canReject;
      if (!actionAllowed) return;

      const handler = action === "approve" ? onApprove : onReject;

      setIsResolving(true);
      setResolveError(null);
      try {
        if (handler !== undefined) {
          // Override path: the parent (e.g. a useSuspensions-driven layout) owns
          // the resume call and its own in-flight tracking.
          await handler();
        } else if (streamingResolve !== null) {
          // Streaming path: resolve through the session that owns the live
          // stream, so the continuation renders into the chat view without a
          // refresh (FIX-276). The provider supplies resumedBy.
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
        // Success: disable the buttons immediately so a card that lingers before
        // its `suspension_resume` item arrives can't be resolved twice.
        setLocallyResolved(true);
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : "Failed to resume suspension");
      } finally {
        setIsResolving(false);
      }
    },
    [isResolving, canApprove, canReject, hasFlowKind, flowKind, item.requestId, item.suspensionId, userId, recoveryClient, streamingResolve, onApprove, onReject]
  );

  const isApproveDisabled = !canApprove || isResolving;
  const isRejectDisabled = !canReject || isResolving;

  return createElement(
    "div",
    // Theme-neutral: transparent background + inherited text, mid-gray border
    // that reads on both light and dark surfaces. Avoids the white-on-dark
    // invisible-text trap of hardcoded light colors.
    { "data-suspension": item.suspensionId, style: { border: "1px solid #9ca3af", borderRadius: 6, padding: 12, margin: "4px 0" } },
    // Suspension message
    createElement(
      "p",
      { style: { margin: "0 0 8px 0", fontWeight: 500 } },
      item.message
    ),
    // Optional data summary
    item.data !== undefined && createElement(
      "details",
      { style: { marginBottom: 8, fontSize: 12 } },
      createElement("summary", { style: { cursor: "pointer", color: "inherit", opacity: 0.7 } }, "Details"),
      createElement(
        "pre",
        { style: { margin: "4px 0", fontSize: 11, whiteSpace: "pre-wrap", color: "inherit", opacity: 0.85 } },
        JSON.stringify(item.data, null, 2)
      )
    ),
    // Error feedback
    resolveError !== null && createElement(
      "p",
      { style: { color: "red", fontSize: 12, margin: "0 0 8px 0" } },
      resolveError
    ),
    // Approve / Reject buttons — each uses its own per-action disabled state so
    // supplying only onApprove doesn't falsely enable the Reject button.
    createElement(
      "div",
      { style: { display: "flex", gap: 8 } },
      createElement(
        "button",
        {
          type: "button",
          disabled: isApproveDisabled,
          onClick: () => { void handleAction("approve"); },
          style: {
            padding: "4px 12px",
            borderRadius: 4,
            border: "1px solid #9ca3af",
            background: "transparent",
            color: "inherit",
            cursor: isApproveDisabled ? "not-allowed" : "pointer",
            opacity: isApproveDisabled ? 0.5 : 1,
            fontSize: 13
          }
        },
        "Approve"
      ),
      createElement(
        "button",
        {
          type: "button",
          disabled: isRejectDisabled,
          onClick: () => { void handleAction("reject"); },
          style: {
            padding: "4px 12px",
            borderRadius: 4,
            border: "1px solid #9ca3af",
            background: "transparent",
            color: "inherit",
            cursor: isRejectDisabled ? "not-allowed" : "pointer",
            opacity: isRejectDisabled ? 0.5 : 1,
            fontSize: 13
          }
        },
        "Reject"
      )
    )
  );
}

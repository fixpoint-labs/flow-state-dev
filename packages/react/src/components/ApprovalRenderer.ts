/**
 * Default approval card for suspension items in the standard item rendering pipeline.
 *
 * Self-contained: reads FlowContext for flowKind/baseUrl/userId, creates its own
 * memoized recovery client, and manages per-item in-flight/error state. An app can
 * pass onApprove/onReject handlers to override the self-contained resume logic
 * (e.g., when integrating with a page-level useSuspensions hook).
 *
 * Once a suspension resolves, the card collapses to a compact one-line receipt
 * (e.g. "✓ Approved") instead of lingering as a disabled card — the outcome comes
 * from the action taken on this card or, on reload, from the `resolution` prop the
 * renderer threads down from the matching `suspension_resume` item.
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
 *
 * Styling: a single scoped stylesheet is injected once at module load (class
 * prefix `fsd-approval-`), mainly so the buttons can have `:hover`/`:focus-visible`
 * states that inline styles can't express. The card is theme-agnostic — a neutral
 * translucent surface plus `color: inherit` — so it reads on both light and dark
 * backgrounds with no theme detection. Consumers can override the classes.
 */
import { createElement, useState, useMemo, useCallback, useEffect, type ReactNode } from "react";
import { createRecoveryClient } from "@flow-state-dev/client";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useFlowContext } from "../context/FlowContext";
import { useSuspensionResolver } from "../context/SuspensionResolver";

// ---------------------------------------------------------------------------
// Scoped styles
// ---------------------------------------------------------------------------

const STYLE_ELEMENT_ID = "fsd-approval-styles";

// Minimal, theme-agnostic stylesheet. No light/dark detection: the surface uses a
// neutral translucent tint and `color: inherit`, so it adapts to whatever
// background and text color the host app provides. The buttons (solid green/red,
// white text) and the receipt's colored icon carry their own contrast, so they
// read on any surface.
const APPROVAL_CSS = `
.fsd-approval-card {
  border: 1px solid rgba(128,128,128,0.28);
  background: rgba(128,128,128,0.08);
  color: inherit;
  border-radius: 10px;
  padding: 14px 16px;
  margin: 6px 0;
  font-family: inherit;
}
.fsd-approval-msg { margin: 0 0 10px; font-weight: 600; font-size: 14px; line-height: 1.4; }
.fsd-approval-details { margin: 0 0 10px; font-size: 12px; }
.fsd-approval-summary { cursor: pointer; opacity: 0.65; }
.fsd-approval-pre {
  margin: 6px 0 0; font-size: 11px; white-space: pre-wrap; opacity: 0.85;
  background: rgba(128,128,128,0.12); padding: 8px; border-radius: 6px; overflow-x: auto;
}
.fsd-approval-error { color: #ef4444; font-size: 12px; margin: 0 0 10px; }
.fsd-approval-actions { display: flex; gap: 8px; }
.fsd-approval-btn {
  appearance: none; border: 1px solid transparent; border-radius: 8px;
  padding: 7px 16px; font-size: 13px; font-weight: 600; cursor: pointer; color: #ffffff;
  font-family: inherit; transition: background-color 0.12s ease, opacity 0.12s ease;
}
.fsd-approval-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
.fsd-approval-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.fsd-approval-approve { background: #16a34a; }
.fsd-approval-approve:hover:not(:disabled) { background: #15803d; }
.fsd-approval-approve:active:not(:disabled) { background: #166534; }
.fsd-approval-reject { background: #dc2626; }
.fsd-approval-reject:hover:not(:disabled) { background: #b91c1c; }
.fsd-approval-reject:active:not(:disabled) { background: #991b1b; }
.fsd-approval-receipt {
  display: inline-flex; align-items: center; gap: 8px; color: inherit;
  border: 1px solid; border-radius: 8px; padding: 6px 12px; margin: 6px 0;
  font-size: 13px; font-family: inherit;
}
.fsd-approval-receipt-icon { font-size: 13px; line-height: 1; }
.fsd-approval-receipt-label { font-weight: 600; }
.fsd-approval-receipt-msg { opacity: 0.75; font-weight: 400; }
.fsd-approval-receipt-approved { background: rgba(34,197,94,0.14); border-color: rgba(34,197,94,0.45); }
.fsd-approval-receipt-approved .fsd-approval-receipt-icon { color: #22c55e; }
.fsd-approval-receipt-rejected { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.45); }
.fsd-approval-receipt-rejected .fsd-approval-receipt-icon { color: #ef4444; }
.fsd-approval-receipt-neutral { background: rgba(128,128,128,0.1); border-color: rgba(128,128,128,0.3); }
`;

/**
 * Inject the approval stylesheet once. Idempotent and DOM-only — guarded for
 * SSR. Runs at module load (not in an effect) so the card never paints unstyled.
 */
function ensureApprovalStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ELEMENT_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = APPROVAL_CSS;
  document.head.appendChild(style);
}

ensureApprovalStyles();

// ---------------------------------------------------------------------------
// Receipt outcome derivation
// ---------------------------------------------------------------------------

/** Visual descriptor for the collapsed receipt: icon glyph, label, tone class. */
export type ApprovalOutcome = {
  icon: string;
  label: string;
  toneClass: string;
};

/**
 * Map a resolved suspension status to its receipt descriptor. `undefined` (the
 * card knows it resolved but not how — e.g. an external `isResolved` with no
 * resolution threaded) collapses to a neutral "Resolved" receipt.
 */
export function resolveApprovalOutcome(
  status: SuspensionStatus | undefined
): ApprovalOutcome {
  switch (status) {
    case "approved":
      return { icon: "✓", label: "Approved", toneClass: "fsd-approval-receipt-approved" };
    case "rejected":
      return { icon: "✕", label: "Rejected", toneClass: "fsd-approval-receipt-rejected" };
    case "timed_out":
      return { icon: "⏲", label: "Timed out", toneClass: "fsd-approval-receipt-neutral" };
    case "expired":
      return { icon: "⏲", label: "Expired", toneClass: "fsd-approval-receipt-neutral" };
    default:
      return { icon: "•", label: "Resolved", toneClass: "fsd-approval-receipt-neutral" };
  }
}

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
   * When true, the card collapses to a read-only receipt instead of offering
   * buttons. Pass `!view.pending` from a `useSuspensions` result (or let the
   * renderer derive it from a matching `suspension_resume` item) to prevent
   * duplicate resume calls.
   */
  isResolved?: boolean;
  /**
   * How the suspension was resolved, when known. Drives the receipt label/tone
   * (e.g. "Approved" vs "Rejected"). The renderer threads this down from the
   * matching `suspension_resume` item so a reloaded log shows the real outcome;
   * a card that resolved itself this session already knows the action. Falls
   * back to a neutral "Resolved" receipt when absent.
   */
  resolution?: SuspensionStatus;
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
 * While pending: renders the message, optional data details, and green Approve /
 * red Reject buttons. Once resolved (via this card or an external
 * `isResolved`/`resolution`): collapses to a compact receipt.
 *
 * Reads FlowContext for resume credentials. If FlowContext.flowKind is absent
 * and no onApprove/onReject handlers are supplied, buttons render disabled with
 * a console.warn (cannot resume without flowKind on <FlowProvider>).
 */
export function ApprovalRenderer(props: ApprovalRendererProps): ReactNode {
  const { item, isResolved = false, resolution, onApprove, onReject } = props;
  const { flowKind, baseUrl, userId } = useFlowContext();
  // Streaming resolver from the nearest SuspensionResolverProvider, if any. When
  // present (and no explicit on{Approve,Reject} override), resolving goes through
  // the session's streaming resume so the continuation renders live.
  const streamingResolve = useSuspensionResolver();

  // The action currently in flight, or null when idle. Doubles as the
  // "is resolving" flag and lets each button label its own progress correctly.
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(null);
  const isResolving = pendingAction !== null;
  const [resolveError, setResolveError] = useState<string | null>(null);
  // The action this card took, captured on a successful local resolve so the
  // receipt can show the real outcome before (or without) a `resolution` prop
  // propagating back. null until this card resolves its own suspension.
  const [resolvedAction, setResolvedAction] = useState<"approve" | "reject" | null>(null);

  const recoveryClient = useMemo(
    () => createRecoveryClient({ baseUrl }),
    [baseUrl]
  );

  // Compute per-action capability so a single supplied handler doesn't enable
  // the other button (e.g. onApprove only → Reject stays disabled). A streaming
  // resolver from context enables both buttons just like a flowKind does.
  const hasFlowKind = flowKind !== undefined && flowKind.length > 0;
  const canResolveInternally = hasFlowKind || streamingResolve !== null;
  const resolved = isResolved || resolvedAction !== null;
  const canApprove = !resolved && (onApprove !== undefined || canResolveInternally);
  const canReject = !resolved && (onReject !== undefined || canResolveInternally);
  const canResume = canApprove || canReject;

  // Warn once on mount when the card has no way to call resume. useEffect
  // keeps this out of SSR and prevents a flood on every re-render.
  useEffect(() => {
    if (!canResume && !resolved) {
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

      setPendingAction(action);
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
        // Success: collapse to the receipt immediately so a card that lingers
        // before its `suspension_resume` item arrives can't be resolved twice.
        setResolvedAction(action);
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : "Failed to resume suspension");
      } finally {
        setPendingAction(null);
      }
    },
    [isResolving, canApprove, canReject, hasFlowKind, flowKind, item.requestId, item.suspensionId, userId, recoveryClient, streamingResolve, onApprove, onReject]
  );

  // Resolved: collapse to a compact receipt. Prefer the action this card took;
  // otherwise the threaded `resolution`; otherwise a neutral "Resolved".
  if (resolved) {
    const status: SuspensionStatus | undefined =
      resolvedAction === "approve" ? "approved"
      : resolvedAction === "reject" ? "rejected"
      : resolution;
    const outcome = resolveApprovalOutcome(status);
    return createElement(
      "div",
      {
        "data-suspension": item.suspensionId,
        "data-resolved": "true",
        className: `fsd-approval-receipt ${outcome.toneClass}`
      },
      createElement("span", { className: "fsd-approval-receipt-icon", "aria-hidden": true }, outcome.icon),
      createElement("span", { className: "fsd-approval-receipt-label" }, outcome.label),
      item.message
        ? createElement("span", { className: "fsd-approval-receipt-msg" }, item.message)
        : null
    );
  }

  const isApproveDisabled = !canApprove || isResolving;
  const isRejectDisabled = !canReject || isResolving;

  return createElement(
    "div",
    { "data-suspension": item.suspensionId, className: "fsd-approval-card" },
    // Suspension message
    createElement("p", { className: "fsd-approval-msg" }, item.message),
    // Optional data summary
    item.data !== undefined && createElement(
      "details",
      { className: "fsd-approval-details" },
      createElement("summary", { className: "fsd-approval-summary" }, "Details"),
      createElement(
        "pre",
        { className: "fsd-approval-pre" },
        JSON.stringify(item.data, null, 2)
      )
    ),
    // Error feedback
    resolveError !== null && createElement(
      "p",
      { className: "fsd-approval-error" },
      resolveError
    ),
    // Approve / Reject buttons — each uses its own per-action disabled state so
    // supplying only onApprove doesn't falsely enable the Reject button.
    createElement(
      "div",
      { className: "fsd-approval-actions" },
      createElement(
        "button",
        {
          type: "button",
          className: "fsd-approval-btn fsd-approval-approve",
          disabled: isApproveDisabled,
          onClick: () => { void handleAction("approve"); }
        },
        pendingAction === "approve" ? "Approving…" : "Approve"
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "fsd-approval-btn fsd-approval-reject",
          disabled: isRejectDisabled,
          onClick: () => { void handleAction("reject"); }
        },
        pendingAction === "reject" ? "Rejecting…" : "Reject"
      )
    )
  );
}

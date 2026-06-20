/**
 * Default approval card for suspension items in the standard item rendering pipeline.
 *
 * Self-contained: reads FlowContext for flowKind/baseUrl/userId, creates its own
 * memoized recovery client, and manages per-item in-flight/error state. An app can
 * pass onApprove/onReject handlers to override the self-contained resume logic
 * (e.g., when integrating with a page-level useSuspensions hook).
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
   * Optional override for the approve action. When supplied, replaces the
   * component's internal resumeSuspension call.
   */
  onApprove?: (data?: unknown) => void | Promise<unknown>;
  /**
   * Optional override for the reject action. When supplied, replaces the
   * component's internal resumeSuspension call.
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
 */
export function ApprovalRenderer(props: ApprovalRendererProps): ReactNode {
  const { item, onApprove, onReject } = props;
  const { flowKind, baseUrl, userId } = useFlowContext();

  const [isResolving, setIsResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const recoveryClient = useMemo(
    () => createRecoveryClient({ baseUrl }),
    [baseUrl]
  );

  // When no handlers supplied, check we have a flowKind to call resume with.
  const hasHandlers = onApprove !== undefined || onReject !== undefined;
  const canResume = hasHandlers || (flowKind !== undefined && flowKind.length > 0);

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
      if (!canResume) return;

      if (action === "approve" && onApprove !== undefined) {
        await onApprove();
        return;
      }
      if (action === "reject" && onReject !== undefined) {
        await onReject();
        return;
      }

      // Self-contained path: call the recovery client directly.
      if (flowKind === undefined || flowKind.length === 0) return;

      setIsResolving(true);
      setResolveError(null);
      try {
        await recoveryClient.resumeSuspension(flowKind, item.requestId, {
          suspensionId: item.suspensionId,
          action,
          resumedBy: userId
        });
      } catch (err) {
        setResolveError(err instanceof Error ? err.message : "Failed to resume suspension");
      } finally {
        setIsResolving(false);
      }
    },
    [canResume, flowKind, item.requestId, item.suspensionId, userId, recoveryClient, onApprove, onReject]
  );

  const isDisabled = !canResume || isResolving;

  return createElement(
    "div",
    { "data-suspension": item.suspensionId, style: { border: "1px solid #e5e7eb", borderRadius: 6, padding: 12, margin: "4px 0" } },
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
      createElement("summary", { style: { cursor: "pointer", color: "#6b7280" } }, "Details"),
      createElement(
        "pre",
        { style: { margin: "4px 0", fontSize: 11, whiteSpace: "pre-wrap", color: "#374151" } },
        JSON.stringify(item.data, null, 2)
      )
    ),
    // Error feedback
    resolveError !== null && createElement(
      "p",
      { style: { color: "red", fontSize: 12, margin: "0 0 8px 0" } },
      resolveError
    ),
    // Approve / Reject buttons
    createElement(
      "div",
      { style: { display: "flex", gap: 8 } },
      createElement(
        "button",
        {
          type: "button",
          disabled: isDisabled,
          onClick: () => { void handleAction("approve"); },
          style: {
            padding: "4px 12px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            background: isDisabled ? "#f3f4f6" : "#fff",
            cursor: isDisabled ? "not-allowed" : "pointer",
            fontSize: 13
          }
        },
        "Approve"
      ),
      createElement(
        "button",
        {
          type: "button",
          disabled: isDisabled,
          onClick: () => { void handleAction("reject"); },
          style: {
            padding: "4px 12px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            background: isDisabled ? "#f3f4f6" : "#fff",
            cursor: isDisabled ? "not-allowed" : "pointer",
            fontSize: 13
          }
        },
        "Reject"
      )
    )
  );
}

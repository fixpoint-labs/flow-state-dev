/**
 * Minimal built-in approval card for suspension items.
 *
 * This is the framework's *zero-config* default — plain, unstyled controls so a
 * `suspension` item renders something actionable with no setup. All the logic
 * (resume transport, in-flight state, the duplicate-resume guard, resolved
 * outcome) lives in `useApproval`; this component is only the bare markup.
 *
 * For a polished, themeable card, register the `Approval` component from
 * `@flow-state-dev/ui` via the `suspension` renderer slot (it's in
 * `chatAssistantRenderers`). Suppress this default with
 * `renderers={{ suspension: false }}` on `<FlowProvider>`.
 *
 * Resolution order in <ItemRenderer>:
 *   1. Custom renderer registered under renderers.suspension
 *   2. false  → suppressed (headless/custom-layout mode)
 *   3. <ApprovalRenderer> (this component)  ← default fallback for type="suspension"
 *
 * Once resolved (via this card or a matching `suspension_resume` item surfaced
 * through `resolution`), it collapses to a one-line text receipt.
 */
import { createElement, type ReactNode } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useApproval } from "../hooks/useApproval";

/**
 * Props for the built-in approval card.
 *
 * When onApprove/onReject are supplied, they replace the built-in resume call —
 * useful when a parent useSuspensions hook manages the resume and its state.
 */
export interface ApprovalRendererProps {
  /** The suspension item to render an approval card for. */
  item: SuspensionItem;
  /** When true, the card collapses to a read-only receipt. */
  isResolved?: boolean;
  /** How the suspension was resolved, when known — drives the receipt label. */
  resolution?: SuspensionStatus;
  /** Optional override for the approve action. */
  onApprove?: (data?: unknown) => void | Promise<unknown>;
  /** Optional override for the reject action. */
  onReject?: (data?: unknown) => void | Promise<unknown>;
}

/**
 * Built-in minimal default for `type === "suspension"` items. Renders the
 * message and plain Approve / Reject buttons while pending; a one-line receipt
 * once resolved. Logic is delegated to `useApproval`.
 */
export function ApprovalRenderer(props: ApprovalRendererProps): ReactNode {
  const { item, isResolved, resolution, onApprove, onReject } = props;
  const approval = useApproval(item, { isResolved, resolution, onApprove, onReject });

  if (approval.resolved) {
    return createElement(
      "div",
      { "data-suspension": item.suspensionId, "data-resolved": "true", style: { fontSize: 13, opacity: 0.85, margin: "4px 0" } },
      `${approval.outcome.icon} ${approval.outcome.label}`,
      item.message ? ` — ${item.message}` : ""
    );
  }

  return createElement(
    "div",
    { "data-suspension": item.suspensionId, style: { margin: "4px 0" } },
    createElement("p", { style: { margin: "0 0 8px 0", fontWeight: 500 } }, item.message),
    item.data !== undefined && createElement(
      "details",
      { style: { marginBottom: 8, fontSize: 12 } },
      createElement("summary", { style: { cursor: "pointer", opacity: 0.7 } }, "Details"),
      createElement(
        "pre",
        { style: { margin: "4px 0", fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.85 } },
        JSON.stringify(item.data, null, 2)
      )
    ),
    approval.error !== null && createElement(
      "p",
      { style: { color: "red", fontSize: 12, margin: "0 0 8px 0" } },
      approval.error
    ),
    createElement(
      "div",
      { style: { display: "flex", gap: 8 } },
      createElement(
        "button",
        {
          type: "button",
          disabled: !approval.canApprove || approval.isResolving,
          onClick: approval.approve
        },
        approval.pendingAction === "approve" ? "Approving…" : "Approve"
      ),
      createElement(
        "button",
        {
          type: "button",
          disabled: !approval.canReject || approval.isResolving,
          onClick: approval.reject
        },
        approval.pendingAction === "reject" ? "Rejecting…" : "Reject"
      )
    )
  );
}

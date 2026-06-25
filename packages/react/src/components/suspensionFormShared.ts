/**
 * Shared markup helpers for the bounded default HITL renderers (FIX-849).
 *
 * `QuestionRenderer`, `SelectionRenderer`, and `SchemaFormRenderer` differ only
 * in their input control; the receipt, error line, and submit/skip footer are
 * identical. These helpers keep that common chrome in one place (createElement,
 * no JSX — matching `ApprovalRenderer`). All three remain framework-minimal: the
 * polished, themeable cards live in `@flow-state-dev/ui`.
 */
import { createElement, type ReactNode } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import type { UseSuspensionFormResult } from "../hooks/useSuspensionForm";

/** Props shared by the three bounded default renderers. */
export interface SuspensionFormRendererProps {
  /** The suspension item to render an input for. */
  item: SuspensionItem;
  /** When true, the card collapses to a read-only receipt. */
  isResolved?: boolean;
  /** How the suspension was resolved, when known — drives the receipt label. */
  resolution?: SuspensionStatus;
}

/** The collapsed one-line receipt shown once a suspension has resolved. */
export function renderReceipt(item: SuspensionItem, form: UseSuspensionFormResult): ReactNode {
  return createElement(
    "div",
    {
      "data-suspension": item.suspensionId,
      "data-resolved": "true",
      style: { fontSize: 13, opacity: 0.85, margin: "4px 0" }
    },
    `${form.outcome.icon} ${form.outcome.label}`,
    item.message ? ` — ${item.message}` : ""
  );
}

/** The error line shown when a resume call fails. */
export function renderErrorLine(error: string | null): ReactNode {
  if (error === null) return null;
  return createElement(
    "p",
    { style: { color: "red", fontSize: 12, margin: "0 0 8px 0" } },
    error
  );
}

/**
 * The submit/skip footer. The Submit button is disabled until the value
 * validates; the Skip button only appears when the suspension permits `skip`.
 */
export function renderActions(form: UseSuspensionFormResult): ReactNode {
  return createElement(
    "div",
    { style: { display: "flex", gap: 8 } },
    createElement(
      "button",
      {
        type: "button",
        disabled: !form.canSubmit,
        onClick: () => {
          void form.submit();
        }
      },
      form.isResolving ? "Submitting…" : "Submit"
    ),
    form.canSkip &&
      createElement(
        "button",
        {
          type: "button",
          disabled: form.isResolving,
          onClick: () => {
            void form.skip();
          }
        },
        "Skip"
      )
  );
}

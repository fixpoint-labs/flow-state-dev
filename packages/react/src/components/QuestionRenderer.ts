/**
 * Built-in default card for a clarifying-question suspension (FIX-849).
 *
 * Chosen by `ItemRenderer` for a `human_input` suspension whose `resumeSchema` is
 * a single string (or absent). Renders the question and a free-text box; submit
 * sends the raw string back as the resume payload. Logic is delegated to
 * `useSuspensionForm`. Once resolved it collapses to a one-line receipt.
 *
 * Like `ApprovalRenderer`, this is the zero-config default — register a custom
 * `suspension` renderer (or the polished `@flow-state-dev/ui` card) to replace it.
 */
import { createElement, type ReactNode } from "react";
import { useSuspensionForm } from "../hooks/useSuspensionForm";
import {
  renderActions,
  renderErrorLine,
  renderReceipt,
  type SuspensionFormRendererProps
} from "./suspensionFormShared";

/** Free-text clarifying-question card. */
export function QuestionRenderer(props: SuspensionFormRendererProps): ReactNode {
  const { item, isResolved, resolution } = props;
  const form = useSuspensionForm(item, { isResolved, resolution });

  if (form.resolved) return renderReceipt(item, form);

  return createElement(
    "div",
    { "data-suspension": item.suspensionId, style: { margin: "4px 0" } },
    createElement("p", { style: { margin: "0 0 8px 0", fontWeight: 500 } }, item.message),
    createElement("textarea", {
      "data-suspension-input": "question",
      value: typeof form.value === "string" ? form.value : "",
      rows: 3,
      style: { width: "100%", marginBottom: 8 },
      onChange: (e: { target: { value: string } }) => form.setValue(e.target.value)
    }),
    renderErrorLine(form.error),
    renderActions(form)
  );
}

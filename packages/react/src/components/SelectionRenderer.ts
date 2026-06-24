/**
 * Built-in default card for a selection suspension (FIX-849).
 *
 * Chosen by `ItemRenderer` for a `human_input` suspension whose `resumeSchema` is
 * a top-level enum (single choice → radio buttons) or an array of an enum (multi
 * choice → checkboxes). Submit sends the chosen value(s). Logic is delegated to
 * `useSuspensionForm`; once resolved it collapses to a one-line receipt.
 */
import { createElement, type ReactNode } from "react";
import { useSuspensionForm } from "../hooks/useSuspensionForm";
import {
  renderActions,
  renderErrorLine,
  renderReceipt,
  type SuspensionFormRendererProps
} from "./suspensionFormShared";

/** Single- or multi-select card driven by an enum `resumeSchema`. */
export function SelectionRenderer(props: SuspensionFormRendererProps): ReactNode {
  const { item, isResolved, resolution } = props;
  const form = useSuspensionForm(item, { isResolved, resolution });

  if (form.resolved) return renderReceipt(item, form);

  const options = form.options ?? [];
  const multi = form.kind === "enum-multi";
  const selected = multi
    ? (Array.isArray(form.value) ? (form.value as string[]) : [])
    : typeof form.value === "string"
      ? form.value
      : "";

  const toggleMulti = (option: string) => {
    const current = Array.isArray(form.value) ? (form.value as string[]) : [];
    form.setValue(
      current.includes(option) ? current.filter((o) => o !== option) : [...current, option]
    );
  };

  return createElement(
    "div",
    { "data-suspension": item.suspensionId, style: { margin: "4px 0" } },
    createElement("p", { style: { margin: "0 0 8px 0", fontWeight: 500 } }, item.message),
    createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 } },
      ...options.map((option) =>
        createElement(
          "label",
          { key: option, style: { display: "flex", gap: 6, alignItems: "center", fontSize: 13 } },
          createElement("input", {
            type: multi ? "checkbox" : "radio",
            name: `suspension-${item.suspensionId}`,
            value: option,
            checked: multi ? (selected as string[]).includes(option) : selected === option,
            onChange: () => (multi ? toggleMulti(option) : form.setValue(option))
          }),
          option
        )
      )
    ),
    renderErrorLine(form.error),
    renderActions(form)
  );
}

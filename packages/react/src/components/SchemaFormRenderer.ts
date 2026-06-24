/**
 * Built-in default card for a flat-form suspension (FIX-849).
 *
 * Chosen by `ItemRenderer` for a `human_input` suspension whose `resumeSchema` is
 * a flat object of scalars and enums. Renders one control per property (text /
 * number / checkbox / select), validates via `useSuspensionForm`, and submits the
 * collected object. A single flat object can mix a free-text field, a selection,
 * and a checkbox — covering "one or all three in one resume".
 *
 * Nested objects, arrays of objects, and unions are out of bounds here — those
 * route to an author-supplied `render.component` renderer instead.
 */
import { createElement, type ReactNode } from "react";
import { useSuspensionForm, type SchemaField } from "../hooks/useSuspensionForm";
import {
  renderActions,
  renderErrorLine,
  renderReceipt,
  type SuspensionFormRendererProps
} from "./suspensionFormShared";

/** Render the control for one field, bound to the form value by key. */
function renderField(
  field: SchemaField,
  value: Record<string, unknown>,
  setField: (key: string, next: unknown) => void,
  error: string | undefined
): ReactNode {
  const current = value[field.key];
  let control: ReactNode;

  if (field.kind === "boolean") {
    control = createElement("input", {
      type: "checkbox",
      checked: current === true,
      onChange: (e: { target: { checked: boolean } }) => setField(field.key, e.target.checked)
    });
  } else if (field.kind === "enum") {
    control = createElement(
      "select",
      {
        value: typeof current === "string" ? current : "",
        onChange: (e: { target: { value: string } }) => setField(field.key, e.target.value)
      },
      createElement("option", { value: "" }, "Select…"),
      ...(field.options ?? []).map((option) =>
        createElement("option", { key: option, value: option }, option)
      )
    );
  } else if (field.kind === "enum-multi") {
    const selected = Array.isArray(current) ? (current as string[]) : [];
    control = createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 2 } },
      ...(field.options ?? []).map((option) =>
        createElement(
          "label",
          { key: option, style: { display: "flex", gap: 6, alignItems: "center" } },
          createElement("input", {
            type: "checkbox",
            checked: selected.includes(option),
            onChange: () =>
              setField(
                field.key,
                selected.includes(option)
                  ? selected.filter((o) => o !== option)
                  : [...selected, option]
              )
          }),
          option
        )
      )
    );
  } else {
    // string | number
    control = createElement("input", {
      type: field.kind === "number" ? "number" : "text",
      value: current === undefined || current === null ? "" : String(current),
      style: { width: "100%" },
      onChange: (e: { target: { value: string } }) => setField(field.key, e.target.value)
    });
  }

  return createElement(
    "div",
    { key: field.key, "data-field": field.key, style: { marginBottom: 8 } },
    createElement(
      "label",
      { style: { display: "block", fontSize: 13, fontWeight: 500, marginBottom: 2 } },
      field.label,
      field.required ? createElement("span", { style: { color: "red" } }, " *") : null
    ),
    field.description
      ? createElement("p", { style: { fontSize: 11, opacity: 0.7, margin: "0 0 4px 0" } }, field.description)
      : null,
    control,
    error !== undefined
      ? createElement("p", { style: { color: "red", fontSize: 11, margin: "2px 0 0 0" } }, error)
      : null
  );
}

/** Flat schema-driven form card. */
export function SchemaFormRenderer(props: SuspensionFormRendererProps): ReactNode {
  const { item, isResolved, resolution } = props;
  const form = useSuspensionForm(item, { isResolved, resolution });

  if (form.resolved) return renderReceipt(item, form);

  const value = (form.value ?? {}) as Record<string, unknown>;

  return createElement(
    "div",
    { "data-suspension": item.suspensionId, style: { margin: "4px 0" } },
    createElement("p", { style: { margin: "0 0 8px 0", fontWeight: 500 } }, item.message),
    ...form.fields.map((field) => renderField(field, value, form.setField, form.errors[field.key])),
    renderErrorLine(form.error),
    renderActions(form)
  );
}

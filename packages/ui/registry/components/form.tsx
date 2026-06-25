"use client";

import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useSuspensionForm, type SchemaField } from "@flow-state-dev/react";
import {
  SuspensionCardFrame,
  SuspensionErrorLine,
  SuspensionFooter,
  SuspensionReceipt,
} from "./suspension-card-shell";

/**
 * Polished flat-form card — the themeable counterpart to `SchemaFormRenderer` in
 * `@flow-state-dev/react` (FIX-849). Renders one control per property of a flat
 * `resumeSchema` (text / number / checkbox / select / multi-select). A single
 * form can combine a free-text field, a selection, and a checkbox. Richer schemas
 * (nested/array-of-object/union) route to a custom renderer, not this card.
 */
export function Form({
  item,
  isResolved,
  resolution,
}: {
  item: SuspensionItem;
  isResolved?: boolean;
  resolution?: SuspensionStatus;
}) {
  const form = useSuspensionForm(item, { isResolved, resolution });

  if (form.resolved) return <SuspensionReceipt item={item} form={form} />;

  const value = (form.value ?? {}) as Record<string, unknown>;

  return (
    <SuspensionCardFrame item={item}>
      <div className="flex flex-col gap-3">
        {form.fields.map((field) => (
          <FieldControl
            key={field.key}
            field={field}
            value={value[field.key]}
            error={form.errors[field.key]}
            setField={form.setField}
          />
        ))}
      </div>
      <SuspensionErrorLine error={form.error} />
      <SuspensionFooter form={form} />
    </SuspensionCardFrame>
  );
}

function FieldControl({
  field,
  value,
  error,
  setField,
}: {
  field: SchemaField;
  value: unknown;
  error: string | undefined;
  setField: (key: string, next: unknown) => void;
}) {
  const inputClass =
    "w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";

  let control: React.ReactNode;
  if (field.kind === "boolean") {
    control = (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => setField(field.key, e.target.checked)}
      />
    );
  } else if (field.kind === "enum") {
    control = (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => setField(field.key, e.target.value)}
        className={inputClass}
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === "enum-multi") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    control = (
      <div className="flex flex-col gap-1">
        {(field.options ?? []).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() =>
                setField(
                  field.key,
                  selected.includes(option)
                    ? selected.filter((o) => o !== option)
                    : [...selected, option]
                )
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  } else {
    control = (
      <input
        type={field.kind === "number" ? "number" : "text"}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => setField(field.key, e.target.value)}
        className={inputClass}
      />
    );
  }

  return (
    <div data-field={field.key}>
      <label className="mb-1 block text-sm font-medium">
        {field.label}
        {field.required ? <span className="text-red-500"> *</span> : null}
      </label>
      {field.description ? (
        <p className="mb-1 text-xs text-muted-foreground">{field.description}</p>
      ) : null}
      {control}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

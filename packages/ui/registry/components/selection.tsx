"use client";

import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useSuspensionForm } from "@flow-state-dev/react";
import {
  SuspensionCardFrame,
  SuspensionErrorLine,
  SuspensionFooter,
  SuspensionReceipt,
} from "./suspension-card-shell";

/**
 * Polished selection card — the themeable counterpart to `SelectionRenderer` in
 * `@flow-state-dev/react` (FIX-849). Single choice (enum) renders radios; multi
 * choice (array of enum) renders checkboxes. Logic comes from `useSuspensionForm`.
 */
export function Selection({
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

  const options = form.options ?? [];
  const multi = form.kind === "enum-multi";
  const selectedMulti = Array.isArray(form.value) ? (form.value as string[]) : [];
  const selectedSingle = typeof form.value === "string" ? form.value : "";

  const toggleMulti = (option: string) => {
    form.setValue(
      selectedMulti.includes(option)
        ? selectedMulti.filter((o) => o !== option)
        : [...selectedMulti, option]
    );
  };

  return (
    <SuspensionCardFrame item={item}>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <input
              type={multi ? "checkbox" : "radio"}
              name={`suspension-${item.suspensionId}`}
              value={option}
              checked={multi ? selectedMulti.includes(option) : selectedSingle === option}
              onChange={() => (multi ? toggleMulti(option) : form.setValue(option))}
            />
            {option}
          </label>
        ))}
      </div>
      <SuspensionErrorLine error={form.error} />
      <SuspensionFooter form={form} />
    </SuspensionCardFrame>
  );
}

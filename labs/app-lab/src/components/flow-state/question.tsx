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
 * Polished clarifying-question card — the themeable counterpart to
 * `QuestionRenderer` in `@flow-state-dev/react` (FIX-849). Renders a free-text
 * box; submit sends the typed string. Logic comes from `useSuspensionForm`.
 */
export function Question({
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

  return (
    <SuspensionCardFrame item={item}>
      <textarea
        value={typeof form.value === "string" ? form.value : ""}
        rows={3}
        onChange={(e) => form.setValue(e.target.value)}
        className="w-full rounded-md border bg-background p-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        placeholder="Type your answer…"
      />
      <SuspensionErrorLine error={form.error} />
      <SuspensionFooter form={form} />
    </SuspensionCardFrame>
  );
}

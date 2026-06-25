"use client";

import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { UseSuspensionFormResult } from "@flow-state-dev/react";
import { CheckIcon, CornerDownRightIcon, MinusIcon } from "lucide-react";

/**
 * Shared chrome for the polished non-binary suspension cards (FIX-849): the
 * resolved receipt and the submit/skip footer. The three cards (question,
 * selection, form) differ only in their input controls; this keeps the receipt
 * and footer identical and themeable. Counterpart to the minimal built-in
 * renderers' `suspensionFormShared` helpers in `@flow-state-dev/react`.
 */

/** Read-only receipt shown once a non-binary suspension has resolved. */
export function SuspensionReceipt({
  item,
  form,
}: {
  item: SuspensionItem;
  form: UseSuspensionFormResult;
}) {
  const status = form.resolution;
  const tone =
    status === "submitted"
      ? "border-green-500/30 bg-green-500/10 text-green-600"
      : status === "skipped"
        ? "border-border bg-muted text-muted-foreground"
        : "border-border bg-muted text-muted-foreground";
  const Icon = status === "submitted" ? CheckIcon : status === "skipped" ? CornerDownRightIcon : MinusIcon;
  return (
    <div
      data-suspension={item.suspensionId}
      data-resolved="true"
      className={`my-1.5 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${tone}`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="font-semibold">{form.outcome.label}</span>
      {item.message ? <span className="font-normal opacity-75">{item.message}</span> : null}
    </div>
  );
}

/** Submit (and, when permitted, Skip) footer for the polished cards. */
export function SuspensionFooter({ form }: { form: UseSuspensionFormResult }) {
  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        disabled={!form.canSubmit}
        onClick={() => void form.submit()}
        className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {form.isResolving ? "Submitting…" : "Submit"}
      </button>
      {form.canSkip ? (
        <button
          type="button"
          disabled={form.isResolving}
          onClick={() => void form.skip()}
          className="rounded-lg border px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip
        </button>
      ) : null}
    </div>
  );
}

/** The error line shown when a resume call fails. */
export function SuspensionErrorLine({ error }: { error: string | null }) {
  if (error === null) return null;
  return <p className="mt-2.5 text-xs text-red-500">{error}</p>;
}

/** The outer card frame shared by the pending state of every non-binary card. */
export function SuspensionCardFrame({
  item,
  children,
}: {
  item: SuspensionItem;
  children: React.ReactNode;
}) {
  return (
    <div
      data-suspension={item.suspensionId}
      className="my-1.5 rounded-xl border bg-card p-4 text-card-foreground"
    >
      <p className="mb-2.5 text-sm font-semibold">{item.message}</p>
      {children}
    </div>
  );
}

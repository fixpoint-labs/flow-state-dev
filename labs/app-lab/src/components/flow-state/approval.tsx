"use client";

import type {
  SuspensionItem,
  SuspensionResumeItem,
} from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useApproval } from "@flow-state-dev/react";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { useSessionItems } from "./session-items-context";

/**
 * Polished approval card for `type === "suspension"` items — the themeable
 * counterpart to the minimal built-in `ApprovalRenderer` in `@flow-state-dev/react`.
 * All logic (resume transport, in-flight state, duplicate-resume guard, resolved
 * outcome) comes from `useApproval`; this component is presentation only.
 *
 * Wire it as a renderer type: it's included in `chatAssistantRenderers` as
 * `suspension: Approval`. Resolved state is derived from the session item stream
 * (via `useSessionItems`), so wrap your item list in `<SessionItemsProvider>` for
 * the card to collapse to a receipt on reload — the same requirement as `TaskPlan`.
 */
export function Approval({ item }: { item: SuspensionItem }) {
  // Find the matching resume in the stream to know if (and how) this resolved.
  const sessionItems = useSessionItems();
  let isResolved = false;
  let resolution: SuspensionStatus | undefined;
  for (const it of sessionItems) {
    if (
      it.type === "suspension_resume" &&
      (it as SuspensionResumeItem).suspensionId === item.suspensionId
    ) {
      isResolved = true;
      resolution = (it as SuspensionResumeItem).resolution;
      break;
    }
  }

  const approval = useApproval(item, { isResolved, resolution });

  if (approval.resolved) {
    const status = approval.resolvedStatus;
    const tone =
      status === "approved"
        ? "border-green-500/30 bg-green-500/10 text-green-600"
        : status === "rejected"
          ? "border-red-500/30 bg-red-500/10 text-red-600"
          : "border-border bg-muted text-muted-foreground";
    const Icon =
      status === "approved" ? CheckIcon : status === "rejected" ? XIcon : MinusIcon;
    return (
      <div
        data-suspension={item.suspensionId}
        data-resolved="true"
        className={`my-1.5 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${tone}`}
      >
        <Icon className="size-3.5" aria-hidden />
        <span className="font-semibold">{approval.outcome.label}</span>
        {item.message ? (
          <span className="font-normal opacity-75">{item.message}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-suspension={item.suspensionId}
      className="my-1.5 rounded-xl border bg-card p-4 text-card-foreground"
    >
      <p className="mb-2.5 text-sm font-semibold">{item.message}</p>

      {item.data !== undefined ? (
        <details className="mb-2.5 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted p-2 text-[11px] whitespace-pre-wrap">
            {JSON.stringify(item.data, null, 2)}
          </pre>
        </details>
      ) : null}

      {approval.error !== null ? (
        <p className="mb-2.5 text-xs text-red-500">{approval.error}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!approval.canApprove || approval.isResolving}
          onClick={approval.approve}
          className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {approval.pendingAction === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={!approval.canReject || approval.isResolving}
          onClick={approval.reject}
          className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {approval.pendingAction === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}

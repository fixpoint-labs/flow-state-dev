import { useSubmit } from "@flow-state-dev/react";
import { useState } from "react";
import type { LabAdapter, LabTask, ReviewDetail } from "../adapter";
import { cn } from "../lib/utils";
import { LAND_LABEL, type LandedWork, type ReviewLand } from "./flow-state/review-hold";

/**
 * A thread's accept, shared by its card and its view. The accept offers the ways its review lists in
 * `lands` (Open a PR, Merge locally) and nothing else; a review with none offers a plain Resolve. A
 * failed landing shows why, and its way comes back as Retry. The accept reads as *Landing…* until the
 * review comes back or the work moves on, so it never reads as accepted while it is still being sent.
 */
export function useReviewAccept(adapter: LabAdapter, sessionId: string, task: Pick<LabTask, "id" | "harness">, review: ReviewDetail | undefined) {
  const lands = review?.lands ?? [];
  const failed = review?.landFailed ?? null;
  // Each review round is one failure and its tries: a review that comes back after a failed landing is a new round.
  const roundKey = review === undefined ? "" : `${failed?.land ?? ""}|${failed?.message ?? ""}|${review.landAttempts?.length ?? 0}`;
  // The round this accept answered; the buttons stay down until the review comes back.
  const [answered, setAnswered] = useState<string | null>(null);
  const submit = useSubmit(async (land?: ReviewLand) => {
    await adapter.resolve(sessionId, task.id, land);
    setAnswered(roundKey);
  });
  return {
    lands,
    failed,
    // A coding task's accept waits for its review to be read, so a plain Resolve can't go before the lands are known.
    ready: review !== undefined || task.harness === undefined,
    waiting: submit.busy || answered === roundKey,
    error: submit.error,
    accept: (land?: ReviewLand) => void submit.submit(undefined, land),
  };
}

/** The accept buttons: one per way the review lists, else a plain Resolve. A failed landing's way comes first, as Retry. */
export function AcceptButtons({
  lands,
  failed,
  disabled,
  busy,
  compact = false,
  onAccept,
}: {
  lands: ReviewLand[];
  failed: { land: ReviewLand; message: string } | null;
  disabled: boolean;
  busy: boolean;
  /** The compact card's buttons are a size smaller than the view's. */
  compact?: boolean;
  onAccept: (land?: ReviewLand) => void;
}) {
  const base = cn("rounded-md px-2 text-xs disabled:opacity-40", compact ? "py-0.5" : "py-1");
  if (lands.length === 0) {
    return (
      <button type="button" disabled={disabled} onClick={() => onAccept(undefined)} className={cn(base, "bg-primary font-semibold text-primary-foreground")}>
        {busy ? "Resolving…" : "Resolve"}
      </button>
    );
  }
  const ordered = failed === null ? lands : [failed.land, ...lands.filter((land) => land !== failed.land)];
  return (
    <>
      {ordered.map((land, i) => (
        <button
          key={land}
          type="button"
          disabled={disabled}
          data-land={land}
          onClick={() => onAccept(land)}
          className={i === 0 ? cn(base, "bg-primary font-semibold text-primary-foreground") : cn(base, "border border-border bg-muted hover:bg-accent")}
        >
          {busy ? "Landing…" : failed?.land === land ? `Retry: ${LAND_LABEL[land]}` : LAND_LABEL[land]}
        </button>
      ))}
    </>
  );
}

/** Why the last landing failed, in the landing's own words. Nothing when none failed. */
export function LandFailure({ failed }: { failed: { land: ReviewLand; message: string } | null }) {
  if (failed === null) return null;
  return (
    <p role="alert" data-land-failed={failed.land} className="mt-1 text-xs text-destructive [overflow-wrap:anywhere]">
      {failed.land === "pull-request" ? "Opening the PR failed" : "Merging locally failed"}: {failed.message}
    </p>
  );
}

/** Where the work landed, short: the pull request's link, or the branch it was merged into. */
export function LandedLink({ landed }: { landed: LandedWork }) {
  return landed.kind === "pull-request" ? (
    <a data-landed="pull-request" href={landed.url} target="_blank" rel="noreferrer" className="text-xs font-semibold underline">
      PR #{landed.number}
    </a>
  ) : (
    <span data-landed="merge" className="text-xs text-muted-foreground">
      merged into {landed.branch}
    </span>
  );
}

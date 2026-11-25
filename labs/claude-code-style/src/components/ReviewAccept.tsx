import { useSubmit } from "@flow-state-dev/react";
import { useState } from "react";
import { useApp, type CodingBoardTask, type TaskWork } from "../app";
import { cn } from "../lib/utils";
import { type LandedWork, landLabel, orderedLands, type ReviewLand } from "./flow-state/review-hold";

/**
 * A thread's accept, shared by its card and its view. The accept offers the ways its review lists in
 * `lands` (Open a PR, or Push to PR #N when one is already open from the branch; Merge locally) and nothing else; a review with none offers a plain Resolve. A
 * failed landing shows why, and its way comes back as Retry. The accept reads as *Landing…* from the
 * moment it is sent until the run's next review stop arrives, so it never reads as accepted while the
 * landing is still going on.
 */
export function useReviewAccept(sessionId: string, task: CodingBoardTask, work: TaskWork | undefined) {
  const lab = useApp();
  const review = work?.review;
  const lands = review?.lands ?? [];
  const failed = review?.landFailed ?? null;
  // One review round is one stop: a retry that fails again stops for review under a new id, even with the same message.
  const round = work?.reviewStop ?? "";
  // The round this accept answered. It holds only while the task still waits on a review: once a landing
  // moves the task on (say, to a pull request it waits on), the answered stop is history, and the composer is free.
  const [answered, setAnswered] = useState<string | null>(null);
  const awaitingReview = task.asks[0]?.ask.kind === "review";
  const submit = useSubmit(async (land?: ReviewLand) => {
    await lab.resolve(sessionId, task, land, work?.reviewStop);
    setAnswered(round);
  });
  return {
    lands,
    failed,
    // The pull request already open from the branch, which a pull-request accept goes onto (FIX-2920).
    openPullRequest: review?.openPullRequest ?? null,
    // A coding task's accept waits for its review to be read, so a plain Resolve can't go before the lands are known.
    ready: review !== undefined || task.harness == null,
    waiting: submit.busy || (awaitingReview && answered === round),
    error: submit.error,
    accept: (land?: ReviewLand) => void submit.submit(undefined, land),
  };
}

/**
 * The accept buttons: one per way the review lists, else a plain Resolve. A failed landing's way comes
 * first, as Retry. These are the lab's compact buttons, labelled as the verbs (*Open a PR*), where the
 * review card's labels its accept (*Accept: Open a PR*): the card says what is being accepted, the buttons say what happens.
 */
export function AcceptButtons({
  lands,
  failed,
  openPullRequest = null,
  disabled,
  busy,
  compact = false,
  onAccept,
}: {
  lands: ReviewLand[];
  failed: { land: ReviewLand; message: string } | null;
  /** The pull request already open from the branch: a pull-request accept pushes to it, so its button says so. */
  openPullRequest?: { number: number } | null;
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
  return (
    <>
      {orderedLands(lands, failed).map((land, i) => (
        <button
          key={land}
          type="button"
          disabled={disabled}
          data-land={land}
          onClick={() => onAccept(land)}
          className={i === 0 ? cn(base, "bg-primary font-semibold text-primary-foreground") : cn(base, "border border-border bg-muted hover:bg-accent")}
        >
          {busy ? "Landing…" : failed?.land === land ? `Retry: ${landLabel(land, openPullRequest)}` : landLabel(land, openPullRequest)}
        </button>
      ))}
    </>
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

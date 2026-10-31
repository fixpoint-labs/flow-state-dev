"use client";

import { useState, type ReactNode } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { useSuspensionResolver } from "@flow-state-dev/react";
import { CheckIcon, MinusIcon } from "lucide-react";

/**
 * A coding run's review, waiting on the user: the commits it made on its
 * branch, the judge's verdict, and **Accept** or **Ask for changes**.
 *
 * harness-manager's `reviewChanges` stops a run that committed with
 * `suspendForUser({ kind: "review" })`. Its data is `{ branch, commits,
 * subjects, judge }` and its answer is `harnessReviewAnswerSchema`'s:
 * `{ verdict: "accepted" }` or `{ verdict: "revise", words }` (harness-manager
 * README, "Reviewing a run's changes"). This card is the one place an app reads
 * that data and builds those answers.
 *
 * Two ways in:
 *
 * - {@link ReviewHold}: drawn from a task's hold (an Inbox hold's `detail` is
 *   the stop's data), with the app's own `answer`, typically the Inbox
 *   client's `answerOne(hold, { value })`.
 * - {@link ReviewSuspension}: drawn for a `suspension` item, answered through
 *   the nearest `SuspensionResolverProvider`.
 *   `SuspensionCard` routes every `kind: "review"` stop here.
 */

/** A run's review, read from its stop's data. `null` where the data had nothing readable. */
export interface ReviewDetail {
  /** The run's branch. */
  branch: string | null;
  /** How many commits it made over its base; `null` when git couldn't count them. */
  commits: number | null;
  /** Its commit subjects, newest first, at most 20. */
  subjects: string[];
  /** The judge's verdict on the run, or `null` when no judge read it. */
  judge: { verdict: string; confidence: number; reason: string } | null;
}

/** The two answers a review takes. */
export type ReviewAnswer = { verdict: "accepted" } | { verdict: "revise"; words: string };

/** The most commit subjects the card lists; the rest are counted. */
const SUBJECTS_SHOWN = 3;

/** The most characters a branch's last segment keeps before its middle is cut. */
const SEGMENT_KEEP = 24;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A review stop's data as the card reads it. Every field is checked: a field
 * that is missing or the wrong type reads as unknown, never a throw.
 */
export function reviewDetailOf(data: unknown): ReviewDetail {
  const d = isRecord(data) ? data : {};
  const judge = isRecord(d.judge) ? d.judge : null;
  return {
    branch: typeof d.branch === "string" && d.branch !== "" ? d.branch : null,
    commits: typeof d.commits === "number" && Number.isFinite(d.commits) ? d.commits : null,
    subjects: Array.isArray(d.subjects) ? d.subjects.filter((s): s is string => typeof s === "string") : [],
    judge:
      judge !== null && typeof judge.verdict === "string" && typeof judge.confidence === "number"
        ? { verdict: judge.verdict, confidence: judge.confidence, reason: typeof judge.reason === "string" ? judge.reason : "" }
        : null,
  };
}

/**
 * A branch as the card shows it: its last segment, which names the task and
 * phase. `conductor/t0/ha62…-h01…/t-7f3c--code` reads `…/t-7f3c--code`; a last
 * segment longer than 24 characters keeps its start and end.
 */
export function shortBranch(branch: string): string {
  const parts = branch.split("/");
  let last = parts[parts.length - 1]!;
  if (last.length > SEGMENT_KEEP) last = `${last.slice(0, 10)}…${last.slice(-(SEGMENT_KEEP - 11))}`;
  return parts.length === 1 ? last : `…/${last}`;
}

/** "1 commit", "3 commits", or that they couldn't be read. */
export function commitCount(review: ReviewDetail): string {
  if (review.commits === null) return "Commits couldn't be read";
  return `${review.commits} commit${review.commits === 1 ? "" : "s"}`;
}

/** "Judge: done, 0.91", or that no judge read the run. */
export function judgeLine(review: ReviewDetail): string {
  if (review.judge === null) return "No judge read this run";
  return `Judge: ${review.judge.verdict}, ${review.judge.confidence.toFixed(2)}`;
}

/**
 * The review card. `answer` sends one of the two answers; while it is in
 * flight the buttons are disabled, and a failure is shown under them with the
 * words kept. With `unanswerable` set (or no `answer`), the card shows the
 * review and that sentence, and offers no buttons. `children` sit between the
 * commits and the judge: an app's diff of the run goes there.
 */
export function ReviewHold({
  data,
  answer,
  unanswerable,
  resolved,
  children,
}: {
  /** The review stop's data: harness-manager's `{ branch, commits, subjects, judge }`. */
  data: unknown;
  /** Send the answer. Absent: the card can't answer, and says `unanswerable`. */
  answer?: (answer: ReviewAnswer) => Promise<void>;
  /** Why this review can't be answered here. */
  unanswerable?: string | null;
  /** The review was answered: the card collapses to a receipt. */
  resolved?: "accepted" | "revise" | "answered";
  children?: ReactNode;
}) {
  const review = reviewDetailOf(data);
  const [words, setWords] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReviewAnswer["verdict"] | null>(null);

  const outcome = resolved ?? sent;
  if (outcome !== null && outcome !== undefined) return <ReviewReceipt outcome={outcome} />;

  const send = async (reply: ReviewAnswer) => {
    if (answer === undefined || pending) return;
    setPending(true);
    setError(null);
    try {
      await answer(reply);
      setSent(reply.verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The answer didn't go through.");
    } finally {
      setPending(false);
    }
  };
  const revise = () => {
    const trimmed = words.trim();
    if (trimmed !== "") void send({ verdict: "revise", words: trimmed });
  };

  const more = (review.commits ?? review.subjects.length) - Math.min(review.subjects.length, SUBJECTS_SHOWN);
  const canAnswer = answer !== undefined && (unanswerable === undefined || unanswerable === null);
  return (
    <section
      aria-label="Ready for review"
      data-review-hold
      className="my-1.5 min-w-0 rounded-lg border border-success bg-success/10 px-3 py-2 text-sm [overflow-wrap:anywhere]"
    >
      <div className="font-semibold">Ready for review</div>
      <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-1 text-xs">
        <span className="shrink-0" data-review-commits>
          {commitCount(review)}
        </span>
        {review.branch === null ? null : (
          <>
            <span className="shrink-0">on</span>
            <code title={review.branch} data-review-branch className="min-w-0 truncate font-mono [overflow-wrap:normal]">
              {shortBranch(review.branch)}
            </code>
          </>
        )}
      </div>
      {review.subjects.length > 0 ? (
        <ul className="mt-1 text-xs text-muted-foreground">
          {review.subjects.slice(0, SUBJECTS_SHOWN).map((subject, i) => (
            <li key={i} title={subject} className="truncate [overflow-wrap:normal]">
              · {subject}
            </li>
          ))}
          {more > 0 ? <li>· and {more} more</li> : null}
        </ul>
      ) : null}
      {children}
      <div className="mt-1.5 text-xs" data-review-judge>
        <span className="font-semibold">{judgeLine(review)}</span>
        {review.judge && review.judge.reason !== "" ? (
          <p title={review.judge.reason} className="mt-0.5 line-clamp-3 text-muted-foreground">
            {review.judge.reason}
          </p>
        ) : null}
      </div>
      {canAnswer ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <textarea
            aria-label="What to change"
            value={words}
            rows={2}
            disabled={pending}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                revise();
              }
            }}
            placeholder="What should change? (for Ask for changes)"
            className="w-full rounded-md border border-border bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => void send({ verdict: "accepted" })}
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={pending || words.trim() === ""}
              onClick={revise}
              className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ask for changes
            </button>
          </div>
          {error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      ) : unanswerable ? (
        <p className="mt-1.5 text-xs text-muted-foreground" data-review-unanswerable>
          {unanswerable}
        </p>
      ) : null}
    </section>
  );
}

/** The card once answered: one line saying how. */
function ReviewReceipt({ outcome }: { outcome: "accepted" | "revise" | "answered" }) {
  const accepted = outcome === "accepted";
  const Icon = accepted ? CheckIcon : MinusIcon;
  const label = accepted ? "Accepted" : outcome === "revise" ? "Changes asked for" : "Reviewed";
  return (
    <div
      data-review-hold
      data-resolved="true"
      className={`my-1.5 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
        accepted ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"
      }`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="font-semibold">{label}</span>
    </div>
  );
}

/** What the card says for a review stop drawn with no resolver to answer it through. */
export const NO_RESOLVER_UNANSWERABLE =
  "This review can't be answered here: the app draws it without a SuspensionResolverProvider to send the answer through.";

/**
 * A `kind: "review"` suspension item as a review card. The answer resumes the
 * stop with `action: "submit"` and the answer as its data, through the nearest
 * `SuspensionResolverProvider`. With none mounted the card shows the review and
 * says it can't be answered here.
 */
export function ReviewSuspension({
  item,
  isResolved,
}: {
  item: SuspensionItem;
  isResolved?: boolean;
  /** Accepted for `SuspensionCard`'s call shape; a resume's status doesn't say which verdict was sent. */
  resolution?: SuspensionStatus;
}) {
  const resolver = useSuspensionResolver();
  const answer =
    resolver === null
      ? undefined
      : (reply: ReviewAnswer) => resolver({ suspensionId: item.suspensionId, requestId: item.requestId, action: "submit", data: reply });
  return (
    <ReviewHold
      data={item.data}
      {...(answer === undefined ? { unanswerable: NO_RESOLVER_UNANSWERABLE } : { answer })}
      resolved={isResolved === true ? "answered" : undefined}
    />
  );
}

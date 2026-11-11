"use client";

import { useState, type ReactNode } from "react";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { SuspensionStatus } from "@flow-state-dev/core/types";
import { resolveApprovalOutcome, useSuspensionResolver } from "@flow-state-dev/react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { MarkdownText } from "./message-response";
import { RunChecks, type RunCheck } from "./run-checks";

/**
 * A review waiting on the user: **Accept** or **Ask for changes**. For a
 * coding run's review (harness-manager's `reviewChanges`) it shows the
 * commits the run made on its branch, the project's checks (`RunChecks`) and
 * the judge's verdict; for any other
 * review it shows the stop's prompt, which holds the work under review.
 *
 * The card sends only `{ verdict: "accepted" }` or `{ verdict: "revise",
 * words }` (harness-manager's `harnessReviewAnswerSchema`). When the review
 * offers ways to land the work (`lands`), Accept is two labelled actions
 * instead, **Open a PR** and **Merge locally**, each an accept naming its
 * `land`, carrying what is in the text box as its `words`: the note goes to
 * the coding session if the landing fails. A landing that failed shows each
 * try (`landAttempts`) and its error with **Retry**. It spells none of
 * harness-manager's stop fields: an app reads a coding run's review with
 * harness-manager's browser entry and passes the result as `review`.
 *
 * Two ways in:
 *
 * - {@link ReviewHold}: drawn from a task's hold, with the app's own `answer`,
 *   typically the Inbox client's `answerOne(hold, { value })`.
 * - {@link ReviewSuspension}: drawn for a `suspension` item, answered through
 *   the nearest `SuspensionResolverProvider`. `SuspensionCard` routes a
 *   `kind: "review"` stop that takes a verdict ({@link takesReviewVerdict})
 *   here, in prompt form.
 */

/** A coding run's review, as the card draws it. `null` where the run's record had nothing readable. */
export interface ReviewDetail {
  /** The run's branch. */
  branch: string | null;
  /** How many commits it made over its base; `null` when git couldn't count them. */
  commits: number | null;
  /** Its commit subjects, newest first. */
  subjects: string[];
  /** The judge's verdict on the run, or `null` when no judge read it. */
  judge: { verdict: string; confidence: number; reason: string } | null;
  /** The ways an accept can land the work; empty when only a plain accept is offered. Absent reads as empty. */
  lands?: ReviewLand[];
  /** The last landing that failed, when the review is asked again; `null` or absent otherwise. */
  landFailed?: { land: ReviewLand; message: string } | null;
  /** Every try of that landing, oldest first; absent or empty when none failed. */
  landAttempts?: Array<{ land: ReviewLand; message: string }>;
  /** The checks the run's phase ran (harness-manager's `commandCheck`), or `null`/absent when none ran. */
  checks?: RunCheck[] | null;
}

/** A way an accept lands the work: push and open a pull request, or merge into your checkout. */
export type ReviewLand = "pull-request" | "merge";

/** The two answers a review takes; an accept may name how the work lands. */
export type ReviewAnswer = { verdict: "accepted"; land?: ReviewLand; words?: string } | { verdict: "revise"; words: string };

/** Each way to land, as its button says it. */
export const LAND_LABEL: Record<ReviewLand, string> = { "pull-request": "Open a PR", merge: "Merge locally" };

/**
 * The ways to land, with a failed landing's way first: the retry. Each way once, in the review's order.
 * Shared by the review card and the lab's thread accept, so the two never order them differently.
 */
export function orderedLands(lands: readonly ReviewLand[], failed: { land: ReviewLand } | null): ReviewLand[] {
  return failed === null ? [...lands] : [failed.land, ...lands.filter((land) => land !== failed.land)];
}

/** Why the last landing failed, in the landing's own words, or nothing when none failed. */
export function LandFailure({ failed }: { failed: { land: ReviewLand; message: string } | null }) {
  if (failed === null) return null;
  return (
    <p role="alert" data-land-failed={failed.land} className="mt-1 text-xs text-destructive">
      {failed.land === "pull-request" ? "Opening the PR failed" : "Merging locally failed"}: {failed.message}
    </p>
  );
}

/** Where an accepted run's work went, as harness-manager's output records it. */
export type LandedWork =
  | { kind: "pull-request"; url: string; number: number; branch: string; base: string }
  | { kind: "merge"; branch: string; commit: string; checkout: string; from: string };

/**
 * Where an accepted run's work went, and what comes next: the pull request's
 * link, or the branch and commit it was merged at in your checkout.
 */
export function LandedOutcome({ landed }: { landed: LandedWork }) {
  return (
    <p data-landed={landed.kind} className="mt-1 text-xs">
      {landed.kind === "pull-request" ? (
        <>
          Opened{" "}
          <a href={landed.url} target="_blank" rel="noreferrer" className="font-semibold underline">
            pull request #{landed.number}
          </a>{" "}
          into <code className="font-mono">{landed.base}</code>. Next: review and merge it.
        </>
      ) : (
        <>
          Merged into <code className="font-mono">{landed.branch}</code> at{" "}
          <code className="font-mono">{landed.commit.slice(0, 12)}</code> in{" "}
          <code className="font-mono [overflow-wrap:anywhere]">{landed.checkout}</code>. Next: push {landed.branch} when you're ready.
        </>
      )}
    </p>
  );
}

/** The most commit subjects the card lists; the rest are counted. */
const SUBJECTS_SHOWN = 3;

/** The most characters a branch's last segment keeps before its middle is cut. */
const SEGMENT_KEEP = 24;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether a stop's resume schema (its JSON Schema) takes the review's verdict:
 * branches whose `verdict` is the constant `accepted` and `revise`. A review
 * stop whose answer is something else is not this card's to draw.
 */
export function takesReviewVerdict(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const verdicts = new Set<unknown>();
  for (const branch of branches) {
    if (!isRecord(branch) || !isRecord(branch.properties) || !isRecord(branch.properties.verdict)) continue;
    verdicts.add(branch.properties.verdict.const);
  }
  return verdicts.has("accepted") && verdicts.has("revise");
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
 * commits and the checks: an app's diff of the run goes there.
 */
export function ReviewHold({
  prompt,
  review,
  answer,
  unanswerable,
  resolved,
  holdId,
  children,
}: {
  /** The stop's prompt: what a review that isn't a coding run's shows. */
  prompt?: string;
  /** A coding run's review, from harness-manager's browser reader. Absent: the card shows `prompt`. */
  review?: ReviewDetail | null;
  /** Send the answer. Absent: the card can't answer, and says `unanswerable`. */
  answer?: (answer: ReviewAnswer) => Promise<void>;
  /** Why this review can't be answered here. */
  unanswerable?: string | null;
  /** The review was answered: the card collapses to a receipt. */
  resolved?: "accepted" | "revise" | "answered";
  /**
   * Which ask this card answers: the stop's suspension id, or the hold's id.
   * A review asked again after a landing failed is a new ask, so its buttons
   * come back even when it failed with the same words. Pass it wherever a
   * review can be asked again; without it the card tells asks apart by the
   * failure's message alone.
   */
  holdId?: string | null;
  children?: ReactNode;
}) {
  const [words, setWords] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What was sent, and for which ask: a review asked again after a landing failed is a new ask.
  const failed = review?.landFailed ?? null;
  const hold = holdId ?? failed?.message ?? null;
  const [sent, setSent] = useState<{ verdict: ReviewAnswer["verdict"]; for: string | null } | null>(null);

  const outcome = resolved ?? (sent !== null && sent.for === hold ? sent.verdict : null);
  if (outcome !== null && outcome !== undefined) return <ReviewReceipt outcome={outcome} />;

  const send = async (reply: ReviewAnswer) => {
    if (answer === undefined || pending) return;
    setPending(true);
    setError(null);
    try {
      await answer(reply);
      setSent({ verdict: reply.verdict, for: hold });
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

  const more = review ? (review.commits ?? review.subjects.length) - Math.min(review.subjects.length, SUBJECTS_SHOWN) : 0;
  const canAnswer = answer !== undefined && (unanswerable === undefined || unanswerable === null);
  const lands = review?.lands ?? [];
  // A failed landing's own way goes first, as the retry.
  const ordered = orderedLands(lands, failed);
  return (
    <section
      aria-label="Ready for review"
      data-review-hold
      className="my-1.5 min-w-0 rounded-lg border border-success bg-success/10 px-3 py-2 text-sm [overflow-wrap:anywhere]"
    >
      <div className="font-semibold">Ready for review</div>
      <LandFailure failed={failed} />
      {(review?.landAttempts?.length ?? 0) > 1 ? (
        <ol data-land-attempts className="mt-1 list-decimal pl-4 text-xs text-muted-foreground">
          {review!.landAttempts!.map((attempt, i) => (
            <li key={i} title={attempt.message} className="line-clamp-2">
              Try {i + 1}: {attempt.message}
            </li>
          ))}
        </ol>
      ) : null}
      {review ? (
        <>
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
                <li key={i} title={subject} className="flex min-w-0 gap-1 [overflow-wrap:normal]">
                  <span className="shrink-0">·</span>
                  <MarkdownText inline text={subject} className="min-w-0" />
                </li>
              ))}
              {more > 0 ? <li>· and {more} more</li> : null}
            </ul>
          ) : null}
          {children}
          <RunChecks checks={review.checks ?? null} className="mt-1.5" />
          <div className="mt-1.5 text-xs" data-review-judge>
            <span className="font-semibold">{judgeLine(review)}</span>
            {review.judge && review.judge.reason !== "" ? (
              <p title={review.judge.reason} className="mt-0.5 line-clamp-3 text-muted-foreground">
                {review.judge.reason}
              </p>
            ) : null}
          </div>
        </>
      ) : prompt ? (
        <div className="mt-0.5 text-xs" data-review-prompt>
          <MarkdownText text={prompt} />
        </div>
      ) : null}
      {review ? null : children}
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
            placeholder={ordered.length === 0 ? "What should change? (for Ask for changes)" : "What should change, or a note if landing it fails"}
            className="w-full rounded-md border border-border bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <div className="flex flex-wrap gap-2">
            {ordered.length === 0 ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void send({ verdict: "accepted" })}
                className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept
              </button>
            ) : (
              ordered.map((land, i) => (
                <button
                  key={land}
                  type="button"
                  disabled={pending}
                  data-land={land}
                  // The note goes with it, for the coding session if the landing fails.
                  onClick={() => void send({ verdict: "accepted", land, ...(words.trim() !== "" ? { words: words.trim() } : {}) })}
                  className={
                    i === 0
                      ? "rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      : "rounded-md border border-border px-3 py-1 text-xs font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  }
                >
                  {failed?.land === land ? `Retry: ${LAND_LABEL[land]}` : `Accept: ${LAND_LABEL[land]}`}
                </button>
              ))
            )}
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

/** The card once answered, or ended unanswered: one line saying how. `label` overrides the answer's own. */
function ReviewReceipt({ outcome, label: given }: { outcome: "accepted" | "revise" | "answered"; label?: string }) {
  const accepted = outcome === "accepted";
  const Icon = accepted ? CheckIcon : MinusIcon;
  const label = given ?? (accepted ? "Accepted" : outcome === "revise" ? "Changes asked for" : "Reviewed");
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
 * says it can't be answered here. A stop that ended without an answer (expired,
 * cancelled, stopped) says so instead of "Reviewed".
 */
export function ReviewSuspension({
  item,
  review,
  isResolved,
  resolution,
}: {
  item: SuspensionItem;
  /** A coding run's review, when the app read one from the stop. Absent: the stop's prompt. */
  review?: ReviewDetail | null;
  isResolved?: boolean;
  /** How the stop ended, once resolved. */
  resolution?: SuspensionStatus;
}) {
  const resolver = useSuspensionResolver();
  if (isResolved === true && resolution !== undefined && resolution !== "submitted") {
    return <ReviewReceipt outcome="answered" label={resolveApprovalOutcome(resolution).label} />;
  }
  const answer =
    resolver === null
      ? undefined
      : (reply: ReviewAnswer) => resolver({ suspensionId: item.suspensionId, requestId: item.requestId, action: "submit", data: reply });
  return (
    <ReviewHold
      {...(item.message ? { prompt: item.message } : {})}
      {...(review ? { review } : {})}
      holdId={item.suspensionId}
      {...(answer === undefined ? { unanswerable: NO_RESOLVER_UNANSWERABLE } : { answer })}
      resolved={isResolved === true ? "answered" : undefined}
    />
  );
}

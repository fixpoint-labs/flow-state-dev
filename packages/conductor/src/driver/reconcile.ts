/**
 * `reconcile(observed, fresh) → Signal[]` — turning a divergence into signals.
 *
 * Conductor keeps a copy of every PR fact it has seen. The copy is an **asset,
 * not a liability**: it is the only thing a dropped event can be detected
 * against. A comment arrives for a PR conductor never saw opened; without a
 * copy that is simply lost, and with one it is a divergence — which is how
 * conductor knows to backdate the missed `pr_opened` and reduce it *before* the
 * comment that revealed the gap.
 *
 * Two rules hold throughout, and they are what separate a cache from a second
 * authority:
 *
 * - **GitHub always wins.** Reconciliation never emits a signal that walks a PR
 *   backwards. If the copy says merged and a read says open, the read is stale;
 *   the divergence is recorded (see `divergences`) and no signal is produced.
 * - **No new signal kinds.** Reconciliation re-emits the ordinary vocabulary
 *   with `synthesized: true` and a backdated `at`, so a replayed history and a
 *   live one reduce identically.
 */

import type { Signal } from "../model/signals";
import type { PullRequestFacts, ReviewFacts } from "../model/world";

/** Conductor's last-observed copy of one PR. */
export interface ObservedPr {
  readonly number: number;
  readonly state: "open" | "closed" | "merged";
  readonly headSha: string;
  readonly checks: "pending" | "success" | "failure" | null;
  readonly mergeable: boolean | null;
  readonly baseRed: boolean;
  readonly knownReviewIds: readonly string[];
  readonly observedAt: string;
}

/**
 * Project fresh submission facts into the copy conductor persists for the next
 * observation.
 *
 * The copy is what a dropped event is detected against — without it a comment on
 * a PR conductor never saw opened is simply lost. It lives here, beside
 * {@link ObservedPr} and the diff that consumes it, because every source needs
 * it and no source owns it: the GitHub reader and the local one both produce
 * `PullRequestFacts` and both persist the same projection of them.
 *
 * @param pr Facts as just read from the source.
 * @param observedAt When this read happened, ISO-8601.
 */
export function toObservedPr(pr: PullRequestFacts, observedAt: string): ObservedPr {
  return {
    number: pr.number,
    state: pr.state,
    headSha: pr.headSha,
    checks: pr.checks,
    mergeable: pr.mergeable,
    baseRed: pr.baseRed,
    knownReviewIds: pr.reviews.map((review) => review.id),
    observedAt,
  };
}

/** A fact where conductor's copy disagreed with its owner. The owner wins. */
export interface Divergence {
  readonly pullNumber: number;
  readonly fact: string;
  readonly observed: string;
  readonly fresh: string;
}

export interface ReconcileInput {
  /** The entity every synthesized signal is addressed to. */
  readonly entityId: string;
  /** Conductor's copy, keyed by PR number. */
  readonly observed: readonly ObservedPr[];
  /** What the world says right now. */
  readonly fresh: readonly PullRequestFacts[];
  /** Fallback timestamp for a synthesized signal with nothing better to anchor to. */
  readonly now: string;
}

/** How far along a PR's lifecycle a state is. Used to refuse backwards moves. */
const STATE_RANK: Record<ObservedPr["state"], number> = {
  open: 0,
  closed: 1,
  merged: 2,
};

/**
 * The earliest timestamp associated with a PR, used to backdate a synthesized
 * `pr_opened` so it orders ahead of whatever revealed the gap.
 */
function earliestKnownAt(pr: PullRequestFacts, fallback: string): string {
  const times = pr.reviews.map((r) => r.at).sort();
  return times[0] ?? fallback;
}

/** Map a review state onto the signal kind it produces. */
function reviewSignalKind(
  state: ReviewFacts["state"],
): "approved" | "changes_requested" | "review_submitted" {
  if (state === "APPROVED") return "approved";
  if (state === "CHANGES_REQUESTED") return "changes_requested";
  return "review_submitted";
}

/**
 * Compare conductor's copy against the world and produce the signals that were
 * missed, in the order they should be reduced.
 *
 * Signals come out sorted by `at`, so a synthesized `pr_opened` backdated to a
 * PR's first review reduces before the review that exposed it.
 *
 * @param input Conductor's copy, the world, and the entity to address.
 * @returns Ordered signals. Empty when the copy already agrees with the world.
 */
export function reconcile(input: ReconcileInput): Signal[] {
  const { entityId, observed, fresh, now } = input;
  const byNumber = new Map(observed.map((o) => [o.number, o]));
  const signals: Signal[] = [];

  for (const pr of fresh) {
    const prior = byNumber.get(pr.number);

    // — a PR conductor never saw open —
    if (!prior) {
      signals.push({
        kind: "pr_opened",
        entityId,
        at: earliestKnownAt(pr, now),
        synthesized: true,
        pullNumber: pr.number,
      });
      for (const review of pr.reviews) {
        signals.push({
          kind: reviewSignalKind(review.state),
          entityId,
          at: review.at,
          synthesized: true,
          reviewer: review.reviewer,
          sha: review.sha,
          pullNumber: pr.number,
        });
      }
      if (pr.state === "merged") {
        signals.push({
          kind: "merged",
          entityId,
          at: now,
          synthesized: true,
          pullNumber: pr.number,
        });
      }
      continue;
    }

    // — state moved forward —
    if (STATE_RANK[pr.state] > STATE_RANK[prior.state]) {
      signals.push({
        kind: pr.state === "merged" ? "merged" : "pr_closed",
        entityId,
        at: now,
        synthesized: true,
        pullNumber: pr.number,
      });
    }

    // — reviews conductor has not reduced over —
    const known = new Set(prior.knownReviewIds);
    for (const review of pr.reviews) {
      if (known.has(review.id)) continue;
      signals.push({
        kind: reviewSignalKind(review.state),
        entityId,
        at: review.at,
        synthesized: true,
        reviewer: review.reviewer,
        sha: review.sha,
        pullNumber: pr.number,
      });
    }

    // — CI concluded while conductor was not listening —
    if (
      pr.checks !== prior.checks &&
      (pr.checks === "success" || pr.checks === "failure")
    ) {
      signals.push({
        kind: "ci_concluded",
        entityId,
        at: now,
        synthesized: true,
        conclusion: pr.checks,
        sha: pr.headSha,
        // Which PR the checks ran on. `readWorld` reads every PR the entity
        // owns, spec included, so an unscoped conclusion from the spec PR would
        // reduce as a failure of the implementation branch.
        pullNumber: pr.number,
      });
    }

    // — mergeability lost —
    if (prior.mergeable !== false && pr.mergeable === false) {
      signals.push({
        kind: "merge_conflict",
        entityId,
        at: now,
        synthesized: true,
        pullNumber: pr.number,
      });
    }

    // — the base went green again —
    if (prior.baseRed && !pr.baseRed) {
      signals.push({
        kind: "base_recovered",
        entityId,
        at: now,
        synthesized: true,
        pullNumber: pr.number,
      });
    }
  }

  return signals.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Facts where conductor's copy disagrees with the world in a direction that
 * produces no signal — a stale read, or a copy that ran ahead.
 *
 * Kept separate from `reconcile` because these are *not* transitions: nothing
 * advances, the world's value is adopted, and the disagreement is written down
 * so a later conflict is resolvable rather than ambiguous.
 *
 * @param observed Conductor's copy.
 * @param fresh What the world says right now.
 * @returns One entry per disagreeing fact. Empty when the copy agrees.
 */
export function divergences(
  observed: readonly ObservedPr[],
  fresh: readonly PullRequestFacts[],
): Divergence[] {
  const byNumber = new Map(observed.map((o) => [o.number, o]));
  const out: Divergence[] = [];

  for (const pr of fresh) {
    const prior = byNumber.get(pr.number);
    if (!prior) continue;

    if (STATE_RANK[pr.state] < STATE_RANK[prior.state]) {
      out.push({
        pullNumber: pr.number,
        fact: "state",
        observed: prior.state,
        fresh: pr.state,
      });
    }

    if (prior.headSha !== pr.headSha) {
      out.push({
        pullNumber: pr.number,
        fact: "headSha",
        observed: prior.headSha,
        fresh: pr.headSha,
      });
    }
  }

  return out;
}

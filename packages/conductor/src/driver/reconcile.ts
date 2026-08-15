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
 *
 * There is exactly **one diff**, and a PR conductor has never seen goes through
 * it like any other, against a copy that holds nothing (`unseenPr`). A separate
 * first-observation path is not a shortcut but a second thing to keep in sync,
 * and what it forgets to emit is lost for good rather than late.
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

/**
 * The copy a PR is diffed against when conductor has never seen it — every fact
 * at the value it held before anything had happened.
 *
 * This exists so that a first observation is an *ordinary catch-up*, not a
 * second code path. The two were never different problems: a PR conductor has
 * never seen is one whose copy holds nothing, and the diff below already knows
 * how to turn "held nothing, now holds this" into signals. A separate bootstrap
 * branch has to remember every emit the diff makes, and each one it forgets is
 * lost permanently rather than temporarily — a PR first read already closed, a
 * build first read already red, a merge first read already conflicting all
 * emitted nothing, and could never emit later, because the next tick has a copy
 * that agrees. The entity waits on a gate nothing will ever release.
 *
 * Each zero below is the value that makes the diff tell the truth about a first
 * read, and the last one is the one that has to be argued rather than assumed:
 *
 * - `state: "open"` — every PR was open once, so a first read of a closed or
 *   merged one is a genuine forward move and ranks as one.
 * - `checks: null` — nothing has reported, so a settled conclusion is news.
 * - `mergeable: true` — *not known to conflict*, so a first read that is
 *   already conflicting emits `merge_conflict`.
 * - `baseRed: false` — deliberately the value that keeps `base_recovered`
 *   **silent**. A base conductor never saw red has not recovered, and there is
 *   no signal for a base going red in the first place, so `false` is both the
 *   honest prior and the one that emits nothing spurious.
 * - `knownReviewIds: []` — nothing has been reduced over, so every review
 *   replays, which is what the old bootstrap branch did explicitly.
 *
 * @param pr Facts as just read from the source.
 * @param observedAt When this read happened, ISO-8601.
 */
function unseenPr(pr: PullRequestFacts, observedAt: string): ObservedPr {
  return {
    number: pr.number,
    state: "open",
    headSha: pr.headSha,
    checks: null,
    mergeable: true,
    baseRed: false,
    knownReviewIds: [],
    observedAt,
  };
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
    const seen = byNumber.get(pr.number);

    // — a PR conductor never saw open —
    // The opening is the one thing no diff can produce, so it is synthesized
    // here and backdated so it reduces ahead of whatever revealed the gap.
    // Everything *else* a first observation reveals is left to the ordinary
    // diff below, run against a copy that holds nothing — see `unseenPr` for
    // why that unification is the fix rather than a tidy-up.
    if (!seen) {
      signals.push({
        kind: "pr_opened",
        entityId,
        at: earliestKnownAt(pr, now),
        synthesized: true,
        pullNumber: pr.number,
      });
    }
    const prior = seen ?? unseenPr(pr, now);

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
      // A machine's review is not feedback anyone is waiting on. Emitted, it
      // spends a review round against the budget and can dispatch an agent to
      // answer a bot — and conductor reading its own review back is a loop that
      // costs money every turn. The webhook path already drops a bot's review
      // on this rule (`github/signals`); this is the polling path agreeing with
      // it, so a poll and a webhook still reduce identically.
      //
      // Humanness is read off the fact, never asked of a source: `isHuman` is
      // decided structurally by whoever read the author record (GitHub's reader
      // via `github/identity`; the local source knows conductor never writes
      // into `reviews/`, so every entry there is a person's). Reaching for that
      // guard from here would put source-shaped detail inside the pure driver.
      if (!review.isHuman) continue;
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
    // A conclusion is a fact about a *commit*, not about the PR, so what makes
    // one news is a new conclusion or a new commit under it. Comparing the
    // value alone loses the case the feedback loop most depends on: the
    // previous head failed, an agent pushed a fix, and the fix failed too
    // before the next poll. Both reads say `failure`, nothing appears to move,
    // and the cursor then adopts the new head — so the copy agrees with the
    // world and no later tick can emit it. The issue sits in `awaiting_ci`
    // forever, at exactly the moment conductor was supposed to notice the fix
    // did not work.
    //
    // Still silent on a redundant tick: an unchanged world has both the same
    // conclusion and the same head. And a first observation stays a first
    // observation — `unseenPr` copies the fresh head, so what makes a settled
    // conclusion news there is the `null` prior, not a SHA that never differed.
    const concludedOnANewCommit =
      pr.checks !== prior.checks || pr.headSha !== prior.headSha;
    if (
      concludedOnANewCommit &&
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

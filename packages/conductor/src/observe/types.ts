/**
 * The observer seam — how the world is read.
 *
 * `Dispatcher` (see `../dispatch/types`) abstracts *how work gets done*. This
 * file is its mirror on the other side of the tick: it abstracts *how the world
 * is read*. A tick is
 *
 * ```
 * Observer.observe() ──▶ { world, signals } ──▶ decide() ──▶ Action[] ──▶ execute
 * ```
 *
 * and everything to the left of `decide` is vendor territory. GitHub is the
 * first implementation; a local git checkout is the second; a GitLab or Gitea
 * source would be a third. Nothing GitHub-shaped may appear in this file — the
 * same bar `dispatch/types.ts` holds. If a field only makes sense for one
 * source, it belongs in that source's options object.
 *
 * Three rules the seam depends on:
 *
 * - **The observer materializes; it never decides.** `observe` is the I/O half
 *   of a tick and it is the *only* I/O half. `decide` stays pure and synchronous
 *   because everything a gate predicate could ask has already been answered by
 *   the time it runs.
 * - **An observer reads only what the phase declared.** `World` is populated
 *   from `factsReadBy(entity.kind, entity.phase)`, and {@link Observation.facts}
 *   reports what was actually covered. A source that reads more is over-fetching
 *   (bounded, accepted); one that reads less silently hands a gate a default.
 * - **The cursor round-trips verbatim.** Conductor persists
 *   {@link Observation.cursor} and hands it back unchanged on the next call. It
 *   is what turns polling from best-effort into authoritative: the previous
 *   observation is the only thing a dropped event can be detected against.
 *
 * What is deliberately *not* here: a webhook shape, a poll interval, a
 * subscription. How a source learns that something changed is its own business —
 * an observer that woke on a webhook and one that woke on a timer both answer
 * the same question, and `reconcile` makes the two produce identical signals.
 */

import type { Divergence, ObservedPr } from "../driver/reconcile";
import type { EntityKind, Phase, WorldFact } from "../model/phases";
import type { Signal } from "../model/signals";
import type {
  ArtifactFacts,
  ChildIssueFacts,
  ConductorPolicy,
  World,
} from "../model/world";

/**
 * What an observer persists between observations. Store it verbatim and hand it
 * back unchanged.
 *
 * Deliberately structured rather than an opaque blob: both halves are read by
 * conductor's own driver, not only by the source that produced them.
 * `pullRequests` is what `reconcile` diffs against, and that diff is the shared
 * mechanism every source gets its structural signals from — a source that hid
 * its previous observation behind an opaque type would have to reimplement it.
 */
export interface ObservationCursor {
  /** Last-observed submission facts. The thing a dropped event is detected against. */
  readonly pullRequests: readonly ObservedPr[];
  /**
   * Comments already reduced over, as source-namespaced keys. Namespaced because
   * a source can carry several comment streams that number independently, and a
   * bare id can collide across them.
   */
  readonly commentKeys: readonly string[];
}

/** The cursor for an entity nothing has observed yet. */
export const EMPTY_OBSERVATION_CURSOR: ObservationCursor = {
  pullRequests: [],
  commentKeys: [],
};

/**
 * What conductor hands an observer.
 *
 * The split is the same one `read-world` already draws: **facts conductor owns
 * are inputs, facts the world owns are fetches.** `artifacts` carries
 * conductor-owned `reviewRounds` and decides which submissions are read at all;
 * `goalCheck` and `childIssues` have nowhere else to come from.
 */
export interface ObservationRequest {
  /** The entity being ticked — its kind and stored phase drive what is read. */
  readonly entity: { readonly kind: EntityKind; readonly phase: Phase };
  /** The entity every produced signal is addressed to. */
  readonly entityId: string;
  /**
   * The entity's artifacts from the ledger, carrying conductor-owned
   * `reviewRounds`. Their hosts decide which submissions are read.
   */
  readonly artifacts: readonly ArtifactFacts[];
  /** Conductor-owned. `null` when the goal check has not run. */
  readonly goalCheck?: "passed" | "failed" | null;
  /**
   * Conductor-owned, and the other half of {@link ObservationRequest.goalCheck}:
   * the revision that verdict was taken against. `null` when none has run or
   * when the revision is not known yet. Passed through verbatim — an observer
   * has no opinion on it, and dropping it makes every verdict read as unproved.
   */
  readonly goalCheckSha?: string | null;
  /** Conductor-owned. Empty for an issue. */
  readonly childIssues?: readonly ChildIssueFacts[];
  /** Repo-relative guidance paths to hash. Only read when a gate declares `guidance`. */
  readonly guidancePaths?: readonly string[];
  readonly policy?: ConductorPolicy;
  /** The cursor the previous observation returned, or {@link EMPTY_OBSERVATION_CURSOR}. */
  readonly cursor: ObservationCursor;
  /** This tick's clock, ISO-8601. Anchors signals with nothing better. */
  readonly now: string;
}

/**
 * What one observation produced: the snapshot `decide` reduces against, and
 * everything that happened since the previous one.
 */
export interface Observation {
  /** The snapshot `decide` and every gate predicate reduce against. */
  readonly world: World;
  /** Everything that happened since the last observation, ordered by `at`. */
  readonly signals: readonly Signal[];
  /**
   * Facts where conductor's copy disagreed with the source in a direction that
   * produces no signal. Not transitions — the caller records them and adopts the
   * source's value.
   */
  readonly divergences: readonly Divergence[];
  /** Persist this and pass it to the next observation. */
  readonly cursor: ObservationCursor;
  /** Which world facts this observation materialized. */
  readonly facts: readonly WorldFact[];
}

/**
 * A source conductor can read the world from.
 *
 * The mirror of {@link import("../dispatch/types").Dispatcher}: one identity
 * field and one method. Implementations must be safe to call repeatedly with the
 * same cursor — an observation is a read, and re-reading produces the same
 * signals rather than duplicating them, because `decide` is taken against the
 * *current* world rather than against signal history.
 */
export interface Observer {
  /** Source identity, recorded alongside anything this observation produced. */
  readonly source: string;
  /** Read the world once, and report what changed since the cursor. */
  observe(request: ObservationRequest): Promise<Observation>;
  /**
   * The submission hosting `branch` right now, or `null` when the source has
   * none — a lookup, not a materialization.
   *
   * **This is how a submission enters the observed world in the first place.**
   * {@link observe} reads the submissions an entity's artifacts already name,
   * which is the right rule for everything *after* an artifact exists and no
   * help at all before one does. Conductor pushes work to a branch and something
   * else opens the submission for it — the agent at the end of its run, or a
   * human — and neither of those is a fact any vendor result can be trusted to
   * report: an agent's own prose is not an authority on what GitHub holds, and a
   * human's PR is opened with conductor nowhere in the loop. Asking the source
   * which submission hosts the branch answers both cases with one question, and
   * it is the source's to answer because only the source knows.
   *
   * Deliberately **not** part of `observe`: the answer is one number, artifact
   * identity is conductor's to mint (`reviewRounds` and the artifact id have
   * nowhere else to come from), and folding the lookup into the snapshot would
   * make the reader an authority on which artifacts an entity has.
   *
   * Required rather than optional. A source that cannot answer it strands every
   * entity it observes at the moment the work is handed out, which is exactly
   * the failure this method exists to close — so a new source must answer it
   * rather than quietly not implement it.
   *
   * @param branch The branch conductor's dispatches push to for a phase.
   * @returns The submission number, newest when a branch has hosted several.
   *   `null` when nothing has been opened for it.
   */
  submissionForBranch(branch: string): Promise<number | null>;
}

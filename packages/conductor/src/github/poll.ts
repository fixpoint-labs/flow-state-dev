/**
 * The poll path — M1's primary and complete way of learning what happened.
 *
 * Webhooks are M3. Until then conductor reads GitHub fresh on every tick, and
 * that is not a degraded mode: **reconciliation is what makes polling
 * authoritative rather than best-effort.** A tick reads the world, diffs it
 * against the copy from the previous tick, and turns every gap into ordinary
 * signals. Nothing depends on having been listening at the moment an event
 * happened, which is exactly the property a webhook path has to work to keep.
 *
 * Two halves, because GitHub reports them differently:
 *
 * - **State** — PR state, reviews, CI, mergeability — is diffed by
 *   `driver/reconcile`, which owns the ordering and the "GitHub always wins"
 *   rule.
 * - **Prose** — comments — has no structural diff, so this module carries a
 *   cursor of the comments it has already reduced over.
 *
 * A first poll of an existing PR replays everything on it: every review (via
 * reconcile) and every comment. That is deliberate and consistent — conductor
 * has no record of having handled any of it, and the actions `decide` produces
 * are idempotent, so the replay collapses to the work that was outstanding.
 */

import { divergences, reconcile, type Divergence } from "../driver/reconcile";
import type { Signal } from "../model/signals";
import type { WorldFact } from "../model/phases";
import type { PullRequestFacts, World } from "../model/world";
import { EMPTY_OBSERVATION_CURSOR, type ObservationCursor } from "../observe/types";
import type { GitHubClient } from "./client";
import type { GitHubActor } from "./identity";
import { readWorld, toObservedPr, type ReadWorldInput } from "./read-world";
import {
  ISSUE_COMMENTS,
  REVIEW_COMMENTS,
  signalFromComment,
  type CommentFacts,
  type SignalParseContext,
} from "./signals";

/**
 * What conductor persists between ticks so the next one can tell new from
 * already-seen. Store it verbatim and hand it back unchanged.
 *
 * The GitHub name for {@link ObservationCursor}, which is the same thing every
 * source persists. GitHub's `commentKeys` are namespaced `"issue:123"` /
 * `"review:456"`, because the two REST comment endpoints number independently
 * and a bare id can collide across them.
 */
export type PollCursor = ObservationCursor;

/** The cursor for an entity conductor has never polled. */
export const EMPTY_POLL_CURSOR: PollCursor = EMPTY_OBSERVATION_CURSOR;

export interface PollInput extends ReadWorldInput {
  /** The entity every produced signal is addressed to. */
  readonly entityId: string;
  /** The cursor returned by the previous poll, or {@link EMPTY_POLL_CURSOR}. */
  readonly cursor: PollCursor;
  /** This tick's clock, ISO-8601. Anchors signals with nothing better. */
  readonly now: string;
}

export interface PollResult {
  /** The snapshot `decide` reduces against. */
  readonly world: World;
  /** Everything that happened since the last poll, ordered by `at`. */
  readonly signals: readonly Signal[];
  /**
   * Facts where conductor's copy disagreed with GitHub in a direction that
   * produces no signal. Not transitions — the caller records them and adopts
   * GitHub's value.
   */
  readonly divergences: readonly Divergence[];
  /** Persist this and pass it to the next poll. */
  readonly cursor: PollCursor;
  /** Which world facts this tick materialized. */
  readonly facts: readonly WorldFact[];
}

/** A comment as the two REST list endpoints report it. */
interface CommentPayload {
  id: number | string;
  user?: GitHubActor | null;
  created_at?: string | null;
}

/**
 * One comment plus which endpoint it came from.
 *
 * `source` is carried rather than folded into `key`, because the namespace is
 * needed twice and by two different consumers: the cursor keys this poll writes,
 * and the signal it produces — which is identified downstream and would collapse
 * the two streams back together if it arrived without one. See `./signals`'
 * {@link ISSUE_COMMENTS}.
 */
interface SourcedComment extends CommentFacts {
  readonly key: string;
}

/** Both comment streams on a PR: the conversation, and the review threads. */
async function readComments(
  client: GitHubClient,
  pullNumber: number,
): Promise<SourcedComment[]> {
  const sources: readonly [string, string][] = [
    [ISSUE_COMMENTS, client.path("issues", pullNumber, "comments")],
    [REVIEW_COMMENTS, client.path("pulls", pullNumber, "comments")],
  ];

  const out: SourcedComment[] = [];
  for (const [source, path] of sources) {
    const payloads = await client.paginate<CommentPayload>(path);
    for (const payload of payloads) {
      const id = String(payload.id);
      out.push({
        key: `${source}:${id}`,
        id,
        source,
        author: payload.user ?? null,
        at: payload.created_at ?? "",
        pullNumber,
      });
    }
  }
  return out;
}

/**
 * Read GitHub, diff it against the previous tick, and return everything the
 * driver needs to advance the entity.
 *
 * @param client The GitHub client.
 * @param input The entity, its ledger-owned artifacts, and the previous cursor.
 * @returns The world, ordered signals, unresolved divergences, and the next cursor.
 */
export async function pollGitHub(
  client: GitHubClient,
  input: PollInput,
): Promise<PollResult> {
  const { world, facts } = await readWorld(client, input);
  const fresh: PullRequestFacts[] = Object.values(world.pullRequests);

  const structural = reconcile({
    entityId: input.entityId,
    observed: input.cursor.pullRequests,
    fresh,
    now: input.now,
  });

  const ctx: SignalParseContext = {
    entityId: input.entityId,
    // Resolved, not assumed. A poll that cannot tell conductor's own comment
    // from a reviewer's turns every reply conductor posts into fresh feedback
    // and dispatches a paid agent to answer it. This raises rather than
    // guessing — see `./client`'s `GitHubIdentityError`.
    identity: await client.identity(),
    now: input.now,
  };

  const seen = new Set(input.cursor.commentKeys);
  const prose: Signal[] = [];
  const commentKeys: string[] = [];

  // Each PR's comment read is independent, so they run together. The results
  // are consumed in `fresh` order regardless of which response returned first,
  // which is what keeps `commentKeys` — and the prose signals before the sort —
  // in the same order a sequential read produced.
  const commentsByPr = await Promise.all(fresh.map((pr) => readComments(client, pr.number)));

  for (const comments of commentsByPr) {
    for (const comment of comments) {
      commentKeys.push(comment.key);
      if (seen.has(comment.key)) continue;
      // Author-first: a bot's comment and conductor's own are dropped here,
      // structurally, and never reach the signal list at all.
      const signal = signalFromComment(comment, ctx);
      if (signal) prose.push(signal);
    }
  }

  const signals = [...structural, ...prose].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  );

  return {
    world,
    signals,
    divergences: divergences(input.cursor.pullRequests, fresh),
    // The cursor is rebuilt from what this tick actually saw rather than
    // appended to, so it stays bounded by the PRs and comments that exist.
    cursor: {
      pullRequests: fresh.map((pr) => toObservedPr(pr, input.now)),
      commentKeys,
    },
    facts,
  };
}

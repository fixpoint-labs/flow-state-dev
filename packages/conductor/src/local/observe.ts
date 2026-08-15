/**
 * A local checkout as an {@link Observer} — the seam's second implementation,
 * and the one that proves it is a seam rather than a rename.
 *
 * The reason this exists: conductor's whole loop is unrunnable without a source,
 * and the only source was GitHub. So exercising the process end to end — a spec
 * submitted, reviewed, approved, implemented, merged, goal-checked, and the
 * restart-mid-gate that the derived-gate design exists to survive — meant
 * burning real issues and real pull requests on a repository, at real latency,
 * for a process still being shaped.
 *
 * **This is not a second fake.** `../testing/replay` is a fake and says so: it
 * is handed a world per step and a dispatcher with scripted results, which is
 * exactly right for exercising `decide`'s matrix in milliseconds and useless for
 * establishing that anything works. Everything here is read. A branch is a real
 * branch with real commits. A merge is real ancestry. A review is a file a human
 * actually wrote, at a modification time that decides which commit they were
 * looking at. If the checkout is empty, the observation is empty — there is no
 * path in this directory that answers a question nobody has resolved.
 *
 * The composition is `pollGitHub`'s, deliberately unchanged:
 *
 * ```
 * readLocalWorld() ──▶ fresh facts ──reconcile()──▶ structural signals
 *                              + unseen comments ──▶ prose signals
 * ```
 *
 * `reconcile` is the driver's, shared with GitHub. That is what keeps the two
 * sources honest against each other: neither one gets to decide what a merged
 * PR or a new review *means*, because the same pure function turns both sets of
 * facts into the same signal vocabulary.
 */

import { divergences, reconcile, toObservedPr } from "../driver/reconcile";
import type { Signal } from "../model/signals";
import type { PullRequestFacts } from "../model/world";
import type { Observation, ObservationRequest, Observer } from "../observe/types";
import { readLocalWorld, type LocalSourceOptions } from "./read-world";
import { readComments } from "./store";
import { defaultGitRunner } from "../config/discover";

/** The source identity every local observation is recorded under. */
export const LOCAL_SOURCE = "local";

/** What {@link localObserver} needs. Only `repoRoot` has no sensible default. */
export interface LocalObserverOptions {
  /** Absolute path to the checkout under management. */
  readonly repoRoot: string;
  /** The branch submissions are proposed against. Defaults to `main`. */
  readonly baseBranch?: string;
  /** How to run git. Defaults to spawning the `git` binary. */
  readonly git?: LocalSourceOptions["git"];
}

/**
 * Namespaced so a comment key cannot collide with another source's, for the
 * same reason GitHub's are namespaced across its two comment endpoints: the
 * cursor is one list, and a bare file name is not unique across submissions.
 */
function commentKey(pullNumber: number, id: string): string {
  return `local:${pullNumber}:${id}`;
}

/**
 * Read the world from a local checkout.
 *
 * @param options The checkout, its base branch, and optionally a git runner.
 * @returns An observer that reads git and the local review record.
 */
export function localObserver(options: LocalObserverOptions): Observer {
  const source: LocalSourceOptions = {
    repoRoot: options.repoRoot,
    baseBranch: options.baseBranch ?? "main",
    git: options.git ?? defaultGitRunner,
  };

  return {
    source: LOCAL_SOURCE,

    async observe(request: ObservationRequest): Promise<Observation> {
      const { world, facts } = await readLocalWorld(source, request);
      const fresh: PullRequestFacts[] = Object.values(world.pullRequests);

      const structural = reconcile({
        entityId: request.entityId,
        observed: request.cursor.pullRequests,
        fresh,
        now: request.now,
      });

      const seen = new Set(request.cursor.commentKeys);
      const prose: Signal[] = [];
      const commentKeys: string[] = [];

      for (const pr of fresh) {
        for (const comment of await readComments(source.repoRoot, pr.number)) {
          const key = commentKey(pr.number, comment.id);
          commentKeys.push(key);
          if (seen.has(key)) continue;
          // Every comment is a human's: conductor never writes into the inbox,
          // so there is no machine author to filter out. See `./store`.
          //
          // `feedback_received` and nothing finer, matching the GitHub path —
          // telling a question from a change request is a classifier's job, and
          // a tick that called a model would stop being cheap and deterministic.
          prose.push({
            kind: "feedback_received",
            entityId: request.entityId,
            at: comment.at || request.now,
            author: comment.author,
            commentId: comment.id,
            pullNumber: pr.number,
          });
        }
      }

      const signals = [...structural, ...prose].sort((a, b) =>
        a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
      );

      return {
        world,
        signals,
        divergences: divergences(request.cursor.pullRequests, fresh),
        // Rebuilt from what this observation actually saw rather than appended
        // to, so the cursor stays bounded by what exists.
        cursor: {
          pullRequests: fresh.map((pr) => toObservedPr(pr, request.now)),
          commentKeys,
        },
        facts,
      };
    },
  };
}

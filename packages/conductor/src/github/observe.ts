/**
 * GitHub as an {@link Observer} — the seam's first implementation.
 *
 * There is nothing here but the adapter. `pollGitHub` already *is* the read
 * path (fresh read + reconcile + comment cursor); this file only states that
 * the path satisfies the seam, so the tick can be written against `Observer`
 * rather than against GitHub. Behaviour is unchanged, and deliberately so: the
 * point of introducing the seam now is that the GitHub path stays the reference
 * implementation of it.
 */

import type { Observation, ObservationRequest, Observer } from "../observe/types";
import type { GitHubClient } from "./client";
import { pollGitHub } from "./poll";
import { pullRequestForBranch } from "./read-world";

/** The source identity every GitHub observation is recorded under. */
export const GITHUB_SOURCE = "github";

/**
 * Read the world from GitHub.
 *
 * @param client The GitHub client — auth, pagination, and typed errors.
 * @returns An observer that polls GitHub and reconciles against the cursor.
 */
export function githubObserver(client: GitHubClient): Observer {
  return {
    source: GITHUB_SOURCE,
    observe(request: ObservationRequest): Promise<Observation> {
      return pollGitHub(client, request);
    },
    submissionForBranch(branch: string): Promise<number | null> {
      return pullRequestForBranch(client, branch);
    },
  };
}

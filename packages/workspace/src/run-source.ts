/**
 * Where a run's files come from.
 *
 * A worker about to edit files asks one question before anything is made:
 * is this run cutting a branch of a git repository, or working on a set of
 * files kept in a collection? A **run source** answers it, from the block
 * context alone. A workspace host (`./local-host`) turns the answer into a
 * directory.
 *
 * The answer is the seam: whoever knows which repository or which files a run
 * belongs to fills the source, and the host stays ignorant of why. The host
 * reads `projectId` as nothing more than a key prefix into the collection the
 * answer names — it never looks the id up, and never learns what owns it.
 */
import type { LooseBlockContext } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import type { ProjectedEntryState } from "./types";

/**
 * Where the files kept beside a run live: one collection, addressed under the
 * answer's `projectId`.
 *
 * Carried on the answer rather than configured on the host, because a
 * collection ref is bound to the context that resolved it — the host is built
 * once at boot, with no context to resolve one from.
 */
export interface RunFiles {
  /** The collection that holds the kept files, keyed `<projectId>/<path>`. */
  collection: ResourceCollectionRef<ProjectedEntryState>;
  /**
   * What the collection IS, durably. Write arbitration keys on it — see
   * `Mount.collectionId`.
   */
  collectionId: string;
}

/**
 * The run cuts a fresh branch of a git repository.
 *
 * With `projectId` and `files`, the kept files are laid down in `project/`
 * beside the checkout and saved back; without them, the run gets the
 * checkout alone.
 */
export interface RepoRunSource {
  kind: "repo";
  /** The remote, as you would pass it to `git clone`. Checked against the host's allowlist. */
  repo: string;
  /**
   * The branch on the remote to cut from. Omitted: the remote's default
   * branch, read fresh each time a new branch is cut.
   */
  baseRef?: string;
  /** The key prefix of the kept files. Required together with `files`. */
  projectId?: string;
  /** The collection of kept files. Required together with `projectId`. */
  files?: RunFiles;
}

/**
 * The run has no repository: its working directory is the kept files,
 * hydrated before the run and saved back after.
 */
export interface FilesRunSource {
  kind: "files";
  /** The key prefix of this run's files in `files.collection`. */
  projectId: string;
  files: RunFiles;
}

/**
 * The source will not give this run any files, and says why.
 *
 * Not an error: an answer. A host handed one refuses to provision, naming the
 * reason, before anything is created.
 */
export interface RunSourceRefusal {
  kind: "refused";
  /** A stable, machine-readable reason, e.g. `"not-a-member"`. */
  reason: string;
  /** What a person reading the run's failure should be told. */
  message: string;
}

/** Everything a run source can answer. */
export type RunSourceAnswer = RepoRunSource | FilesRunSource | RunSourceRefusal;

/**
 * Resolve a run's source from its block context.
 *
 * Handed the context and nothing else, so it can only answer from what the
 * context reaches — stored, server-written data — and never from a row's
 * input, its metadata, or anything a model wrote (BP-031).
 */
export type RunSource = (ctx: LooseBlockContext) => RunSourceAnswer | Promise<RunSourceAnswer>;

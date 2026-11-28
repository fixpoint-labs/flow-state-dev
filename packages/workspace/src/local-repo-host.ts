// FIX-2933.
/**
 * `localRepoWorkspaceHost`: the workspace host for one repository on this
 * machine, the common case spelled once.
 *
 * Every run is cut from `repo` directly as a worktree, its branch kept in that
 * repository, and the host reaches no remote but the base's own upstream (see
 * `LocalWorkspaceHostOptions.localRepositories`). A host whose source changes
 * per run or per session, or that cuts from several repositories, calls
 * `localWorkspaceHost` itself.
 */
import { resolve } from "node:path";
import { localWorkspaceHost, type LocalWorkspaceHostOptions, type WorkspaceHost } from "./local-host";

/** Options for {@link localRepoWorkspaceHost}. */
export interface LocalRepoWorkspaceHostOptions
  extends Pick<LocalWorkspaceHostOptions, "root" | "setup" | "pullRequestRepo" | "pullRequestsAs" | "provisionTimeoutMs" | "now"> {
  /**
   * The repository every run is cut from. Resolved to an absolute path here,
   * because the host reads only an absolute path as a repository on this
   * machine; a relative one would be judged a remote and refused.
   */
  repo: string;
  /** The ref a new branch is cut from. Absent, the repository's `HEAD`. */
  baseRef?: string;
}

/**
 * A workspace host whose every run is a worktree of `repo`.
 *
 * @example
 *   const workspace = localRepoWorkspaceHost({ root: "/srv/runs", repo: "/srv/app", baseRef: "main" });
 */
export function localRepoWorkspaceHost(options: LocalRepoWorkspaceHostOptions): WorkspaceHost {
  const { repo: given, baseRef, ...rest } = options;
  const repo = resolve(given);
  return localWorkspaceHost({
    ...rest,
    remotes: { allow: [] },
    localRepositories: [repo],
    source: () => ({ kind: "repo", repo, ...(baseRef !== undefined ? { baseRef } : {}) }),
  });
}

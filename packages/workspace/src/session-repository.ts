/**
 * A run source for a host whose sessions each work in one repository: the
 * repository a session field names, which the server wrote when the session
 * opened (workforce's `sessionFields`, carried down every hand-over), so a run
 * finds its repository from the session it runs in, never from a task's input
 * or a request body.
 *
 * A repository the host lists (`repositories`, by real path) runs in a
 * worktree of it, whether the session names its path or a `file://` remote of
 * it: {@link listedRepository} maps it to the path the host matches. Any
 * other must pass the host's check first, so a run on a folder that isn't a
 * usable repository is refused before anything is made.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { RepositoryCheckResult } from "./local-host";
import type { RunSource } from "./run-source";

/**
 * `repository` as one of `repositories`, by its real path, when it is one: a
 * path or a `file://` remote of a folder the host lists. `undefined` for any
 * other, a network remote or a folder not on this machine included.
 */
export function listedRepository(repository: string, repositories: readonly string[]): string | undefined {
  const path = repository.startsWith("file://") ? fileURLToPath(repository) : repository;
  const real = isAbsolute(path) && existsSync(path) ? realpathSync(path) : undefined;
  return real !== undefined && repositories.includes(real) ? real : undefined;
}

/** What {@link sessionRepositorySource} reads from. */
export interface SessionRepositorySourceOptions {
  /** The session field that names the repository: a key of the session's server-written state. */
  field: string;
  /** The repositories a run works in a worktree of, by their real paths: the host's `localRepositories`. */
  repositories: readonly string[];
  /** The host's check of an unlisted repository (`WorkspaceHost.checkRepository`). Absent: any is used as named. */
  check?: (repository: string) => Promise<RepositoryCheckResult>;
}

/**
 * The run source that answers the repository the run's session works in. A
 * session naming none is refused (`no-repository`); an unlisted repository
 * `check` finds unusable is refused with its problem (`repository-unusable`).
 */
export function sessionRepositorySource(options: SessionRepositorySourceOptions): RunSource {
  return async (ctx) => {
    const repository = (ctx.session.state as Record<string, unknown> | undefined)?.[options.field];
    if (typeof repository !== "string") {
      return { kind: "refused", reason: "no-repository", message: "This session works in no repository. Open a new session on one." };
    }
    const local = listedRepository(repository, options.repositories);
    if (local !== undefined) return { kind: "repo", repo: local };
    const answer = await options.check?.(repository);
    if (answer !== undefined && !answer.usable) {
      return { kind: "refused", reason: "repository-unusable", message: `repository-unusable: ${answer.problem}` };
    }
    return { kind: "repo", repo: repository };
  };
}

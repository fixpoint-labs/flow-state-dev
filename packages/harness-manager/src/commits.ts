/**
 * The commits a run made on its branch: how many, and their subjects.
 *
 * Read from the run's checkout, against the base its branch was cut from.
 * Nothing here settles a row: a run's output carries the count and a judge
 * reads the subjects. So a checkout git cannot read answers no commits
 * rather than failing the run, and says it couldn't tell (`verified: false`),
 * so a review (FIX-2163) is never skipped on a count nobody read.
 *
 * Git runs through the workspace package's bounded `run`, the one place a
 * child process is started for this package.
 */
import { run } from "@flow-state-dev/workspace";

/** How long one git read may take. */
const GIT_READ_TIMEOUT_MS = 10_000;

/** The most commit subjects reported for one run. */
export const MAX_COMMIT_SUBJECTS = 20;

/** The commits a run made: the count, and up to {@link MAX_COMMIT_SUBJECTS} subjects, newest first. */
export interface RunCommits {
  count: number;
  subjects: string[];
  /** Git read the count against a base. `false` when no base or no checkout could be read, and the count is a fallback zero. */
  verified: boolean;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd, timeoutMs: GIT_READ_TIMEOUT_MS })).stdout;
}

/**
 * The commits on `cwd`'s HEAD that the base does not have.
 *
 * With `baseCommit`, the commit the run's branch was cut at, that commit alone
 * is the base. It comes from the run's record, never from the checkout: a run
 * shares the checkout's refs and config, so any named copy of the base is one
 * it could point at its own work. A record without it falls back to the named
 * copies: the remote's (`origin/<baseRef>`) and the local branch. No base, or
 * no checkout git can read, answers none, unverified.
 */
export async function readRunCommits(
  cwd: string,
  baseRef: string | null,
  baseCommit: string | null = null,
): Promise<RunCommits> {
  if (baseRef === null) return { count: 0, subjects: [], verified: false };
  const bases: string[] = [];
  // In the run's own checkout, a bare `HEAD` is the run's branch, never its base.
  const copies =
    baseCommit !== null
      ? [baseCommit]
      : baseRef === "HEAD"
        ? [`refs/remotes/origin/HEAD`]
        : [`refs/remotes/origin/${baseRef}`, baseRef];
  for (const base of copies) {
    try {
      await git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
      bases.push(base);
    } catch {
      // This copy of the base doesn't exist here.
    }
  }
  if (bases.length === 0) return { count: 0, subjects: [], verified: false };
  try {
    const count = Number.parseInt((await git(cwd, ["rev-list", "--count", "HEAD", "--not", ...bases])).trim(), 10);
    const subjects = (await git(cwd, ["log", `--max-count=${MAX_COMMIT_SUBJECTS}`, "--format=%s", "HEAD", "--not", ...bases]))
      .split("\n")
      .filter((line) => line.length > 0);
    if (Number.isNaN(count)) return { count: 0, subjects, verified: false };
    return { count, subjects, verified: true };
  } catch (error) {
    console.warn(
      `[harness-manager] could not read the run's commits against ${bases.join(" and ")} in ${cwd} ` +
        `(${error instanceof Error ? error.message : String(error)}); reporting none.`,
    );
    return { count: 0, subjects: [], verified: false };
  }
}

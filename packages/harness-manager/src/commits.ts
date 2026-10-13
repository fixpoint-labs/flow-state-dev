/**
 * The commits a run made on its branch: how many, and their subjects.
 *
 * Read from the run's checkout, against the base its branch was cut from.
 * Reported, never decided on: a run's output carries the count and a judge
 * reads the subjects, but nothing here settles a row. So a checkout git
 * cannot read answers no commits rather than failing the run.
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
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await run("git", args, { cwd, timeoutMs: GIT_READ_TIMEOUT_MS })).stdout;
}

/**
 * The commits on `cwd`'s HEAD that `baseRef` does not have, in any copy: the
 * remote's (`origin/<baseRef>`), the local branch, or the local branch's
 * upstream (`<baseRef>@{upstream}`, whatever its remote is called). A local
 * checkout cuts the run's branch from the newer of the local branch and its
 * upstream, and a clone from the remote's, and any copy can be ahead of
 * another, so a commit any one has is not the run's. No base, or no checkout
 * git can read, answers none.
 */
export async function readRunCommits(cwd: string, baseRef: string | null): Promise<RunCommits> {
  if (baseRef === null) return { count: 0, subjects: [] };
  const bases: string[] = [];
  // In the run's own checkout, a bare `HEAD` is the run's branch, never its base.
  const copies =
    baseRef === "HEAD" ? [`refs/remotes/origin/HEAD`] : [`refs/remotes/origin/${baseRef}`, baseRef, `${baseRef}@{upstream}`];
  for (const base of copies) {
    try {
      await git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
      bases.push(base);
    } catch {
      // This copy of the base doesn't exist here.
    }
  }
  if (bases.length === 0) return { count: 0, subjects: [] };
  try {
    const count = Number.parseInt((await git(cwd, ["rev-list", "--count", "HEAD", "--not", ...bases])).trim(), 10);
    const subjects = (await git(cwd, ["log", `--max-count=${MAX_COMMIT_SUBJECTS}`, "--format=%s", "HEAD", "--not", ...bases]))
      .split("\n")
      .filter((line) => line.length > 0);
    return { count: Number.isNaN(count) ? 0 : count, subjects };
  } catch (error) {
    console.warn(
      `[harness-manager] could not read the run's commits against ${bases.join(" and ")} in ${cwd} ` +
        `(${error instanceof Error ? error.message : String(error)}); reporting none.`,
    );
    return { count: 0, subjects: [] };
  }
}

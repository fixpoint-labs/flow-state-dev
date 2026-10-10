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
 * The commits on `cwd`'s HEAD that `baseRef` does not have. The base is read
 * as the remote's copy first (`origin/<baseRef>`), then as a local branch.
 * No base, or no checkout git can read, answers none.
 */
export async function readRunCommits(cwd: string, baseRef: string | null): Promise<RunCommits> {
  if (baseRef === null) return { count: 0, subjects: [] };
  for (const base of [`refs/remotes/origin/${baseRef}`, baseRef]) {
    try {
      await git(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
    } catch {
      continue;
    }
    try {
      const count = Number.parseInt((await git(cwd, ["rev-list", "--count", `${base}..HEAD`])).trim(), 10);
      const subjects = (await git(cwd, ["log", `--max-count=${MAX_COMMIT_SUBJECTS}`, "--format=%s", `${base}..HEAD`]))
        .split("\n")
        .filter((line) => line.length > 0);
      return { count: Number.isNaN(count) ? 0 : count, subjects };
    } catch {
      return { count: 0, subjects: [] };
    }
  }
  return { count: 0, subjects: [] };
}

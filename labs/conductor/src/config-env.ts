/**
 * Reading the environment, refusing what cannot work.
 *
 * Its own module so the guards can be **executed** by the suite rather than
 * read. A config file's checks are exactly the code nobody runs until it is too
 * late, and both of these exist because the version that looked right in review
 * was wrong on contact: one compared paths where the question was repositories,
 * the other compared numbers where the value could be `NaN`.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * The repository this process itself lives in, or `undefined` outside a
 * repository.
 *
 * `--git-common-dir` and not `--show-toplevel`: the common dir is the ONE
 * directory every worktree of a repository shares, so it identifies the
 * *repository* rather than the checkout. Comparing toplevels would call a
 * sibling worktree of Flow State a different repo, which is exactly the case
 * the guard exists to catch.
 */
export function repositoryIdentity(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    return path.resolve(dir, out);
  } catch {
    return undefined;
  }
}

/**
 * The repository checkouts are cut from. **Absent is a configuration error, not
 * a default.**
 *
 * Falling back to `process.cwd()` aims the coding agent at whatever directory
 * the dispatcher happens to run in — which, run from this package, is Flow State
 * itself. The agent would then get a worktree of the dispatcher's own repository
 * and could commit and open a pull request against the wrong project, and the
 * first symptom would be a PR nobody asked for.
 *
 * **Pointing at the dispatcher's own repository is refused by repository
 * identity, not by path equality.** Comparing resolved paths only caught the
 * one spelling — `CONDUCTOR_REPO` set to exactly this directory. Set it to the
 * repository root while running from `labs/conductor`, or to any sibling
 * worktree of it, and the strings differ while the repository is the same one,
 * so the check passed and the harm was unchanged. The rule is *the same
 * repository*, and only git can answer that.
 */
export function requireSourceRepo(): string {
  const repo = process.env.CONDUCTOR_REPO;
  if (repo === undefined || repo === "") {
    throw new Error(
      "[conductor] CONDUCTOR_REPO is not set. It names the repository the coding agent " +
        "works on, and there is no safe default: falling back to this process's directory " +
        "would point the agent at the dispatcher's own repository.",
    );
  }

  const mine = repositoryIdentity(process.cwd());
  const theirs = repositoryIdentity(repo);
  if (mine !== undefined && mine === theirs) {
    throw new Error(
      `[conductor] CONDUCTOR_REPO (${repo}) is the repository this dispatcher is itself ` +
        "running from — a different path inside it, or another of its worktrees, is still " +
        "the same repository. The point is a run driving ANOTHER repository rather than " +
        "editing the thing that dispatched it.",
    );
  }
  return repo;
}

/**
 * A positive, finite, whole number of milliseconds from the environment.
 *
 * **Every numeric setting goes through here**, because `Number()` on an
 * environment variable is not a parse: `Number("abc")` is `NaN`, and `NaN`
 * fails every comparison silently — including the manager's stale-window check,
 * which passes construction and then hands `NaN` to `AbortSignal.timeout`.
 * Measured: that throws `RangeError: The value of "delay" is out of range`,
 * mid-run, *after* the row was claimed. So the config error is charged to the
 * task as a failed attempt, once per retry, and the row settles errored for a
 * typo in a shell.
 *
 * Negative and fractional values throw the same `RangeError`. Refusing all
 * three at startup turns a run-time charge into a message before anything is
 * claimed.
 */
export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `[conductor] ${name}="${raw}" is not a positive whole number of milliseconds. ` +
        "Left unchecked this is not caught until a claimed attempt hands it to a timer " +
        "and throws, charging a config error to the task once per retry.",
    );
  }
  return value;
}

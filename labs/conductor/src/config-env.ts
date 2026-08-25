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
import { realpathSync } from "node:fs";

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
    // `realpathSync`, not `path.resolve`. Resolving lexically canonicalises the
    // SPELLING and not the location: `git rev-parse --git-common-dir` answers
    // `.git` for both a repository and a symlink to it, and a lexical resolve
    // then produces two different strings for one directory — so a symlinked
    // `CONDUCTOR_REPO` walked straight past the guard and the agent could edit
    // the dispatcher after all. Comparing identity means comparing the physical
    // path.
    return realpathSync(path.resolve(dir, out));
  } catch {
    return undefined;
  }
}

/**
 * Refuse a repository that is the one this process is running from.
 *
 * **One function, because there are two callers and they drifted.** The
 * dispatcher's config gained repository-identity comparison while the goal
 * runner kept path equality — and the goal runner is the one that launches a
 * real coding agent, so the site that kept the weaker rule had the larger blast
 * radius. Adopting a rule means moving every site that speaks the old
 * vocabulary (BP-034), and a rule that lives in one function cannot be adopted
 * halfway.
 */
export function assertDistinctRepository(
  variable: string,
  repo: string,
  from: string = process.cwd(),
): void {
  const theirs = repositoryIdentity(repo);
  if (theirs === undefined) {
    // **An unusable target is refused here, not discovered later.** Provisioning
    // is what would find it — after a row is claimed — so every retry would be
    // spent on a permanent startup error the run cannot fix.
    throw new Error(
      `[conductor] ${variable} (${repo}) is not a git repository — it does not exist, or ` +
        "it is an ordinary directory. Checkouts are cut from it with `git worktree add`, " +
        "so this fails on every attempt and no retry can fix it.",
    );
  }

  // `mine` may legitimately be undefined: a dispatcher run from outside any
  // repository has nothing to collide with. Only a MATCH is a refusal.
  const mine = repositoryIdentity(from);
  if (mine !== undefined && mine === theirs) {
    throw new Error(
      `[conductor] ${variable} (${repo}) is the repository this process is itself running ` +
        "from — a different path inside it, another of its worktrees, or a symlink to it " +
        "is still the same repository. The point is a run driving ANOTHER repository " +
        "rather than editing the thing that dispatched it.",
    );
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
export function requireSourceRepo(variable = "CONDUCTOR_REPO"): string {
  // The variable NAME is a parameter so the whole rule travels, not two thirds
  // of it. The goal runner reads a differently-named variable and was therefore
  // reusing only `assertDistinctRepository`, keeping its own copy of the
  // absent-check — which is how the last three defects on this branch started.
  const repo = process.env[variable];
  if (repo === undefined || repo === "") {
    throw new Error(
      `[conductor] ${variable} is not set. It names the repository the coding agent ` +
        "works on, and there is no safe default: falling back to this process's directory " +
        "would point the agent at the dispatcher's own repository.",
    );
  }

  assertDistinctRepository(variable, repo);
  return repo;
}

/**
 * Refuse a base ref the target repository does not have.
 *
 * `provisionCheckout` passes this straight to `git worktree add` as the
 * commit-ish for a fresh checkout, so a typo or a repository whose default
 * branch is not `main` fails **every** attempt — after the row is claimed, once
 * per retry, until the budget is gone. It is a startup fact, not a run-time
 * one, so it is checked where the operator can still see it.
 *
 * Verified with `rev-parse --verify`, the same call `branchExists` uses, so the
 * check and the thing it predicts cannot disagree.
 */
export function assertBaseRefExists(repo: string, baseRef: string): void {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], {
      cwd: repo,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new Error(
      `[conductor] CONDUCTOR_BASE_REF "${baseRef}" does not resolve to a commit in ${repo}. ` +
        "A fresh checkout is cut from it with `git worktree add`, so every attempt would " +
        "fail there and spend the row's whole retry budget on a name no retry can fix.",
    );
  }
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
 * Negative and fractional values throw the same `RangeError`. So does anything
 * past the platform timer ceiling — which is the state validating the OTHERS
 * introduced: "a positive safe integer" admits `2**32`, and
 * `AbortSignal.timeout` rejects it exactly as it rejects `NaN`, while a plain
 * `setTimeout` silently clamps to 1ms and fires immediately. Both are the same
 * defect wearing different clothes, so the bound is checked here too.
 *
 * Refusing all of them at startup turns a run-time charge into a message before
 * anything is claimed.
 */
/**
 * The largest delay the timer paths actually honour. **Measured, and the
 * measurement moved the number.**
 *
 * `AbortSignal.timeout` throws `RangeError` only above `2**32 - 1`, so that
 * looked like the ceiling. It is not: Node's timers are 32-bit *signed*, and
 * anything above `2**31 - 1` is silently clamped to 1ms with a warning — so a
 * deadline of 2^32-1 does not throw, it fires immediately and settles every row
 * errored. The louder failure was the safer one, which is why the bound is the
 * quieter limit.
 */
export const MAX_TIMER_MS = 2_147_483_647;

export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new Error(
      `[conductor] ${name}="${raw}" is not a positive whole number of milliseconds ` +
        `no greater than ${MAX_TIMER_MS}. Left unchecked this is not caught until a ` +
        "claimed attempt hands it to a timer and throws, charging a config error to the " +
        "task once per retry.",
    );
  }
  return value;
}

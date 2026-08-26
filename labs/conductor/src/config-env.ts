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
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * How long a startup git query may take.
 *
 * Short on purpose, and deliberately not `GIT_TIMEOUT_MS`. These are metadata
 * reads against a local repository — `rev-parse` answers in milliseconds — and
 * they run before anything is claimed, so a generous bound buys nothing and a
 * tight one turns a wedged filesystem into a clear startup failure instead of a
 * dispatcher that never finishes booting.
 */
const STARTUP_GIT_TIMEOUT_MS = 30_000;

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
/**
 * Turn a `--git-common-dir` answer into the identity two callers compare.
 *
 * Exported because the provisioning path needs the SAME notion of identity while
 * obtaining the raw answer differently — it runs git through the async, budgeted
 * helper rather than a synchronous startup call. Two copies of this rule would
 * be two definitions of "the same repository", and the guards that depend on it
 * would silently stop agreeing.
 *
 * `realpathSync`, not `path.resolve`. Resolving lexically canonicalises the
 * SPELLING and not the location: `git rev-parse --git-common-dir` answers `.git`
 * for both a repository and a symlink to it, and a lexical resolve then produces
 * two different strings for one directory — so a symlinked `CONDUCTOR_REPO`
 * walked straight past the guard and the agent could edit the dispatcher after
 * all. Comparing identity means comparing the physical path.
 */
export function identityFromCommonDir(dir: string, commonDir: string): string | undefined {
  try {
    return realpathSync(path.resolve(dir, commonDir.trim()));
  } catch {
    return undefined;
  }
}

export function repositoryIdentity(dir: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      // Bounded like every other child process this lab spawns. The blast
      // radius here is smaller than the run-time probes — a hang at startup
      // charges no attempt, because nothing has been claimed yet — but the rule
      // is "every child process bounds itself", and a dispatcher wedged before
      // it can serve anything is still a dispatcher nobody can diagnose.
      timeout: STARTUP_GIT_TIMEOUT_MS,
    }).trim();
    return identityFromCommonDir(dir, out);
  } catch {
    return undefined;
  }
}

/**
 * Where the dispatcher's OWN code lives, as a repository identity.
 *
 * **`process.cwd()` is not the dispatcher.** It was the only source of "my
 * repository" here, and a host started from anywhere outside its checkout — a
 * service unit, a container whose `WORKDIR` is not the source tree, a process
 * launched from `/` — made `repositoryIdentity` return `undefined`. This guard
 * only refuses on a MATCH, so an undefined identity is not a near miss: it is
 * the guard silently doing nothing, in a deployment shape that is ordinary
 * rather than exotic. Obligation A was then unenforced exactly where nobody
 * would look.
 *
 * This module's own file is a fact about the running code and does not move
 * when the process's directory does. Neither source is authoritative on its
 * own — a bundler can rewrite `import.meta.url`, and a host can legitimately run
 * from its checkout — so both are consulted and a match with EITHER refuses.
 */
function dispatcherIdentities(from: string): string[] {
  const here = (() => {
    try {
      return path.dirname(fileURLToPath(import.meta.url));
    } catch {
      return undefined;
    }
  })();
  return [from, ...(here === undefined ? [] : [here])]
    .map(repositoryIdentity)
    .filter((id): id is string => id !== undefined);
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

  // Both the process's directory AND this module's own location, because a
  // dispatcher started outside its checkout has a cwd that collides with
  // nothing while its code sits squarely in the repository being pointed at.
  // Only a MATCH is a refusal; a host genuinely unrelated to the target still
  // matches neither.
  if (dispatcherIdentities(from).includes(theirs)) {
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
 *
 * `variable` names the setting in the message, for the same reason
 * `requireSourceRepo` takes one: the whole rule has to travel to a second door,
 * not two thirds of it. Reached programmatically the failing thing is
 * `workspace.baseRef`, and an error naming an environment variable the caller
 * never set sends them looking in the wrong place.
 */
/**
 * Refuse a checkout root the host cannot hold checkouts under.
 *
 * **The one workspace path with no filesystem preflight.** `sourceRepo` gets
 * two — {@link assertDistinctRepository} and {@link assertBaseRefExists} both
 * run `git` with it as `cwd`, so a path that is not a usable directory fails
 * at construction. `root` was checked only for being spelled absolutely, and a
 * root that names a regular file (or sits under one) is not discovered until
 * `acquireCheckout` tries to create descendants beneath it — which happens
 * AFTER the claim. The row is charged an attempt, the next attempt fails
 * identically, and a permanent host misconfiguration eats the whole retry
 * budget without the agent ever running.
 *
 * **Created, not merely inspected**, because the two are the same syscall here:
 * `mkdirSync` with `recursive` succeeds on a directory that already exists and
 * throws when the path or any ancestor is a file. Checking `statSync` first
 * would answer a question about the moment before the answer is used, and would
 * still leave a missing root to fail later.
 *
 * **And a probe child, because existing as a directory is not the question.**
 * `mkdirSync` on a root that is already there creates nothing, so it succeeds
 * against a read-only mount or a directory an ACL denies — certifying a root
 * that then fails at the first `acquireCheckout`, which is the whole failure
 * this guard was added to move forward. What the guard claims is that the root
 * can HOLD checkouts, so it has to create one and take it away again.
 *
 * The probe is removed in a `finally`: a guard that litters the checkout root
 * with its own leftovers on every construction is worse than the gap it closes.
 */
export function assertCheckoutRootUsable(root: string, variable = "workspace.root"): void {
  try {
    mkdirSync(root, { recursive: true });
    // `mkdtemp` rather than a fixed name: two conductors constructed at once
    // must not collide on the probe, and a collision would read as a root that
    // cannot hold checkouts when it can.
    const probe = mkdtempSync(path.join(root, ".conductor-probe-"));
    rmSync(probe, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `[conductor] ${variable} "${root}" cannot hold checkouts: ` +
        `${error instanceof Error ? error.message : String(error)}. Each run cuts a fresh ` +
        `worktree beneath it, and that happens after the task is claimed — so an unusable ` +
        `root spends the whole retry budget on a host misconfiguration without ever ` +
        `running the agent.`,
    );
  }
}

export function assertBaseRefExists(
  repo: string,
  baseRef: string,
  variable = "CONDUCTOR_BASE_REF",
): void {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], {
      cwd: repo,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: STARTUP_GIT_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `[conductor] ${variable} "${baseRef}" does not resolve to a commit in ${repo}. ` +
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
  // `Number()` first, then the shared predicate: the env door's only extra job
  // is turning a string into a number, and the RULE about which numbers are
  // usable belongs to every door, not this one.
  return assertPositiveInt(name, Number(raw));
}

/**
 * The numeric rule itself, for a value that is already a number.
 *
 * **The programmatic door onto the same rule the env door has.** `conductorFlow`
 * is exported, so a host can pass `runTimeoutMs: NaN`, a negative, or a
 * fraction directly — bypassing `positiveIntFromEnv` entirely. Unchecked, that
 * survives `resolveOwnership`'s comparisons (`NaN` fails all of them silently)
 * and reaches `AbortSignal.timeout` only after the row is claimed and the
 * checkout provisioned, charging an attempt for a permanent misconfiguration
 * once per retry.
 *
 * Fixing the env door and not this one was the sixth instance of the same
 * class on this branch: a rule enforced at the door someone reported rather
 * than at every door onto it.
 */
export function assertPositiveInt(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new Error(
      `[conductor] ${label} must be a positive whole number no greater than ` +
        `${MAX_TIMER_MS}; got ${String(value)}. Left unchecked this is not caught until a ` +
        "claimed attempt hands it to a timer and throws, charging a config error to the " +
        "task once per retry.",
    );
  }
  return value;
}

/**
 * Refusing what cannot work, before anything is claimed.
 *
 * Its own module so the guards can be **executed** by a suite rather than read.
 * A configuration check is exactly the code nobody runs until it is too late,
 * and these exist because the version that looked right in review was wrong on
 * contact: one compared paths where the question was repositories, the other
 * compared numbers where the value could be `NaN`.
 *
 * **Nothing here reads the environment.** A guard takes the value and the name
 * to blame it on, so the same rule serves a host calling `harnessManager`
 * directly and a host that read the value out of `process.env` — the reading is
 * the caller's, the rule is one. Splitting it the other way is how the last
 * several defects in this area started: a rule enforced at the door someone
 * reported rather than at every door onto it.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";

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

/**
 * The repository a directory belongs to, or `undefined` when it is not in one.
 *
 * `--git-common-dir` and not `--show-toplevel`: the common dir is the ONE
 * directory every worktree of a repository shares, so it identifies the
 * *repository* rather than the checkout. Comparing toplevels would call a
 * sibling worktree a different repo, which is exactly the case the guard exists
 * to catch.
 */
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
 * Where the HOST's own code lives, as repository identities.
 *
 * **The host says; this module does not guess.** An earlier version consulted
 * this module's own file location as a second candidate, on the reasoning that
 * it is a fact about the running code and does not move when the process's
 * directory does. That was true while the code lived inside the application
 * that dispatched runs. Shipped as a package it is false: `import.meta.url`
 * names wherever the package was INSTALLED — under a host's `node_modules`, a
 * linked workspace, a pnpm store — which is a fact about dependency resolution
 * and says nothing about the host.
 *
 * The consequence was not a weakened guard but an unsatisfiable one. A host that
 * named its own repository and pointed a run at some OTHER repository was
 * refused whenever this package happened to be installed inside that other one,
 * with an error claiming the process was running from it. A guard a legitimate
 * host cannot satisfy is worse than no guard, because the host's only escape is
 * to stop calling it.
 *
 * **`process.cwd()` alone is not the host either**, which is the concern that
 * added the second candidate in the first place and has not gone away: a service
 * unit, a container whose `WORKDIR` is not the source tree, a process launched
 * from `/` all make `repositoryIdentity` return `undefined`. And undefined is
 * not a near miss — this guard only refuses on a MATCH, so it silently does
 * nothing.
 *
 * The answer is that such a host **passes its own root**, which is the one party
 * that actually knows. `dispatcher` is that declaration, and it is required —
 * there is deliberately no default, because every default is a guess and the
 * wrong guess here is silent. A host started from its checkout passes
 * `process.cwd()`; a host whose code spans more than one place passes a list; a
 * host with no repository at all passes `[]` and says so.
 */
function dispatcherIdentities(variable: string, dispatcher: readonly string[]): string[] {
  return dispatcher.map((where) => {
    const identity = repositoryIdentity(where);
    if (identity !== undefined) return identity;
    // **"I cannot tell" is refused, not treated as safe.**
    //
    // This guard refuses on a MATCH, so an unresolvable host matches nothing and
    // would pass — leaving the fence inert in ordinary deployment shapes (a
    // container whose WORKDIR is outside the source tree, a service unit, a
    // process launched from `/`) with nothing saying so. That is the fail-open
    // the harness version gate was changed to avoid, and the two guards in this
    // package should not disagree about what an unknown means.
    //
    // A host that genuinely has no repository — a built artifact, compiled
    // output in an image with no `.git` anywhere — says so with `[]`, which is a
    // decision on the record rather than an accident of the working directory.
    throw new Error(
      `[harness-manager] the host location "${where}" given as \`dispatcher\` is not ` +
        `inside a git repository, so this guard cannot tell whether ${variable} is the ` +
        `host's own repository. Refusing rather than permitting: the check only refuses ` +
        `on a match, so an unidentifiable host would silently pass and the fence against ` +
        `a run editing the thing that dispatched it would be off. Pass the directory the ` +
        `host's own code lives in, or \`[]\` if this host genuinely has no repository ` +
        `(a built artifact, say).`,
    );
  });
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
  dispatcher: string | readonly string[],
): void {
  const theirs = repositoryIdentity(repo);
  if (theirs === undefined) {
    // **An unusable target is refused here, not discovered later.** Provisioning
    // is what would find it — after a row is claimed — so every retry would be
    // spent on a permanent startup error the run cannot fix.
    throw new Error(
      `[harness-manager] ${variable} (${repo}) is not a git repository — it does not exist, or ` +
        "it is an ordinary directory. Checkouts are cut from it with `git worktree add`, " +
        "so this fails on every attempt and no retry can fix it.",
    );
  }

  // Only a MATCH is a refusal; a host genuinely unrelated to the target matches
  // nothing and passes. **An empty list is the host saying it has no repository
  // of its own**, which is the one way to reach that outcome without an
  // identity — see `dispatcherIdentities` for why silence is not the other.
  const mine = typeof dispatcher === "string" ? [dispatcher] : dispatcher;
  if (dispatcherIdentities(variable, mine).includes(theirs)) {
    throw new Error(
      `[harness-manager] ${variable} (${repo}) is the repository the host itself lives in ` +
        "— a different path inside it, another of its worktrees, or a symlink to it is " +
        "still the same repository. The point is a run driving ANOTHER repository rather " +
        "than editing the thing that dispatched it. If this is wrong, the host's own " +
        "location is what to correct: it defaults to the process's working directory, " +
        "and a host that runs from elsewhere passes its root as the third argument.",
    );
  }
}


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
 * The probe is removed on the next line, with nothing between the two — a guard
 * that litters the checkout root with its own leftovers on every construction is
 * worse than the gap it closes. **If a check is ever added between the create
 * and the remove**, the removal has to move into a `finally` first: today there
 * is no window for a throw to leak the probe, and that is a property of there
 * being no statement there rather than of the removal being protected.
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
      `[harness-manager] ${variable} "${root}" cannot hold checkouts: ` +
        `${error instanceof Error ? error.message : String(error)}. Each run cuts a fresh ` +
        `worktree beneath it, and that happens after the task is claimed — so an unusable ` +
        `root spends the whole retry budget on a host misconfiguration without ever ` +
        `running the agent.`,
    );
  }
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
 * `variable` names the setting in the message, so the whole rule travels to a
 * second door rather than two thirds of it. Reached programmatically the
 * failing thing is `workspace.baseRef`, and an error naming an environment
 * variable the caller never set sends them looking in the wrong place.
 */
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
      `[harness-manager] ${variable} "${baseRef}" does not resolve to a commit in ${repo}. ` +
        "A fresh checkout is cut from it with `git worktree add`, so every attempt would " +
        "fail there and spend the row's whole retry budget on a name no retry can fix.",
    );
  }
}

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


/**
 * A positive, finite, whole number of milliseconds a timer will actually honour.
 *
 * **The rule, at every door onto it.** `harnessManager` is exported, so a host
 * passes `runTimeoutMs` directly; a host that reads the value out of the
 * environment has `Number()` to do first, and `Number("abc")` is `NaN`. Either
 * way the value arrives here.
 *
 * What each refusal costs if it is not made: `NaN` fails every comparison
 * silently — including the manager's own stale-window check, so construction
 * passes and `AbortSignal.timeout` is handed `NaN` mid-run. Measured, that is
 * `RangeError: The value of "delay" is out of range`, thrown *after* the row was
 * claimed. The config error is then charged to the task as a failed attempt,
 * once per retry, and the row settles errored for a typo in a shell. Negative
 * and fractional values throw the same way. Zero is refused too: a deadline that
 * fires immediately settles every row errored without running anything.
 *
 * The ceiling is the state that validating the others introduced. "A positive
 * safe integer" admits `2**32`, which `AbortSignal.timeout` rejects exactly as
 * it rejects `NaN` — while a plain `setTimeout` silently clamps it to 1ms and
 * fires immediately. Same defect, different clothes; see {@link MAX_TIMER_MS}
 * for why the bound is the quieter of the two limits.
 *
 * Refusing all of them at construction turns a run-time charge into a message
 * before anything is claimed.
 */
export function assertPositiveInt(label: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_MS) {
    throw new Error(
      `[harness-manager] ${label} must be a positive whole number no greater than ` +
        `${MAX_TIMER_MS}; got ${String(value)}. Left unchecked this is not caught until a ` +
        "claimed attempt hands it to a timer and throws, charging a config error to the " +
        "task once per retry.",
    );
  }
  return value;
}

/**
 * Reading the environment.
 *
 * **Only the reading.** The rules these two apply — is this the repository the
 * dispatcher itself runs from, is this number one a timer will honour — belong
 * to `@flow-state-dev/harness-manager`, because they hold for every host and not
 * just for one that keeps its configuration in environment variables. What is
 * this lab's is the decision to read them from `CONDUCTOR_REPO` and friends at
 * all.
 *
 * Its own module so the reading can be **executed** by the suite rather than
 * read. A config file's checks are exactly the code nobody runs until it is too
 * late, and both of these exist because the version that looked right in review
 * was wrong on contact: one compared paths where the question was repositories,
 * the other compared numbers where the value could be `NaN`.
 */
import {
  assertDistinctRepository,
  assertPositiveInt,
} from "@flow-state-dev/harness-manager";

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
 * A positive whole number from the environment, or the fallback when unset.
 *
 * The env door onto {@link assertPositiveInt}, which is the package's. This side
 * turns a string into a number and names the variable to blame; the rule about
 * which numbers a timer can actually honour is not this door's to hold, because
 * a host calling `conductorFlow` programmatically never comes through it.
 */
export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  // `Number()` first, then the shared predicate: the env door's only extra job
  // is turning a string into a number, and the RULE about which numbers are
  // usable belongs to every door, not this one.
  return assertPositiveInt(name, Number(raw));
}

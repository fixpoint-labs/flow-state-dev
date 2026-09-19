/**
 * The fence, run rather than read — BR-14 and BR-15.
 *
 * This issue is evidence, not surface. Its whole diff lives under
 * `goals/manager-queue-lab/`: no published package gains a file, an export or a
 * changeset, and nothing under `goals/devforce-lab/` is touched either.
 *
 * **Why `devforce-lab` is named as a second fence rather than covered by the
 * first.** BR-15 says that lab runs byte for byte as before, and no behavioural
 * suite can prove a tree unchanged — it can only prove the behaviours somebody
 * thought to check. A diff gate can prove it exactly, and it is the only thing
 * that can, so the subtree is rejected here and BR-15 rests on this rather than
 * on a re-run.
 *
 * Both are asserted against `git diff` against the merge base, so the claim is
 * derived from the change itself rather than from a list somebody maintained.
 */

import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../../lib/index.mts";

/** The one subtree this issue may write. **Pinned** — cited from the epic. */
export const LAB_ROOT = "goals/manager-queue-lab/";

/** The one subtree inside the fence this issue must also leave alone. */
export const FROZEN_SUBTREE = "goals/devforce-lab/";

/** What the diff gate found. */
export interface DiffReport {
  /** The revision the diff was taken against. */
  base: string;
  /** Every path this branch changed. */
  changed: string[];
  /** Paths outside {@link LAB_ROOT}. Non-empty is a failure. */
  outside: string[];
  /** Paths inside {@link FROZEN_SUBTREE}. Non-empty is a failure. */
  frozen: string[];
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/**
 * Read this branch's diff and say what fell outside the fence.
 *
 * @param baseRef The revision to diff against. Defaults to the merge base with
 *   `origin/main`, so the answer is this branch's own change rather than
 *   everything that has landed since it started.
 * @returns What changed, and which of it was out of bounds.
 */
export function diffReport(baseRef = "origin/main"): DiffReport {
  const base = git("merge-base", baseRef, "HEAD");
  const changed = git("diff", "--name-only", `${base}...HEAD`)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    base,
    changed,
    outside: changed.filter((path) => !path.startsWith(LAB_ROOT)),
    frozen: changed.filter((path) => path.startsWith(FROZEN_SUBTREE)),
  };
}

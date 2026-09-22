/**
 * The fence, run rather than read — BR-19.
 *
 * This proof is evidence, not surface: no L1 type, no second work plane, no
 * multi-human machinery, no new substrate, nothing under `packages/`. A
 * behavioural suite can only prove the behaviours somebody thought to check; a
 * diff gate proves the fence exactly, so the claim is derived from the change
 * itself — `git diff` against the merge base, plus whatever the working tree
 * holds uncommitted — rather than from a list somebody maintained.
 */

import { execFileSync } from "node:child_process";
import { REPO_ROOT } from "../../lib/index.mts";

/** The subtrees this issue may write. **Pinned** — BR-19 names them. */
export const ALLOWED_ROOTS = ["goals/", "specs/issues/FIX-1497/"] as const;

/** What the diff gate found. */
export interface DiffReport {
  /** The revision the diff was taken against. */
  base: string;
  /** Every path this branch changed, committed or not. */
  changed: string[];
  /** Paths outside {@link ALLOWED_ROOTS}. Non-empty is a failure. */
  outside: string[];
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/**
 * Read this branch's change and say what fell outside the fence.
 *
 * @param baseRef The revision to diff against; the merge base with it is used,
 *   so the answer is this branch's own change rather than everything that has
 *   landed since it started.
 */
export function diffReport(baseRef = "origin/main"): DiffReport {
  const base = git("merge-base", baseRef, "HEAD");
  const committed = git("diff", "--name-only", `${base}...HEAD`).split("\n");
  // Uncommitted and untracked paths too: a gate that only reads commits passes
  // on a working tree that is about to be committed outside the fence.
  const pending = git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "");
  const changed = [...new Set([...committed, ...pending].map((path) => path.trim()))]
    .filter((path) => path.length > 0)
    .sort();
  return {
    base,
    changed,
    outside: changed.filter((path) => !ALLOWED_ROOTS.some((root) => path.startsWith(root))),
  };
}

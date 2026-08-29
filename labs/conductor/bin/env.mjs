/**
 * Env the lab bin fills so you can sit in a product checkout and run it.
 *
 * The config door still refuses an unset `CONDUCTOR_REPO`. This fills `.`
 * (the process cwd) and this lab's `fsdev.config.ts` only when those are
 * blank. A match with the dispatcher is still refused after the config loads.
 *
 * After the fill, a leftover `CONDUCTOR_REPO` that names a different git
 * checkout than cwd is refused. The board would otherwise operate on that
 * other tree while you are standing in this one. Unsetting only
 * `CONDUCTOR_REPO` still leaves `CONDUCTOR_EPIC` and `CONDUCTOR_CHECKOUTS`
 * pointed at that other board, so the refuse names all three.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} labRoot
 */
export function applyConductorBinDefaults(env, labRoot) {
  if (!env.CONDUCTOR_CONFIG?.trim()) {
    env.CONDUCTOR_CONFIG = path.join(labRoot, "fsdev.config.ts");
  }
  if (!env.CONDUCTOR_REPO?.trim()) {
    env.CONDUCTOR_REPO = ".";
  }
}

/**
 * Git toplevel for `dir`, or `undefined` when it is not a work tree.
 *
 * @param {string} dir
 * @returns {string | undefined}
 */
export function gitToplevel(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * When both cwd and `CONDUCTOR_REPO` are git checkouts and they differ.
 *
 * Standing in the dispatcher (the repo that contains `labs/conductor`) is
 * allowed: `CONDUCTOR_REPO` must then name the product, or the config door
 * refuses. Standing in a product checkout with a leftover other tree is not.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @param {string} [labRoot]
 * @returns {{ cwdRoot: string, repoRoot: string } | undefined}
 */
export function conductorRepoMismatch(env, cwd, labRoot) {
  const raw = env.CONDUCTOR_REPO?.trim();
  if (!raw) return undefined;
  const cwdRoot = gitToplevel(cwd);
  const repoRoot = gitToplevel(path.resolve(cwd, raw));
  if (!cwdRoot || !repoRoot || cwdRoot === repoRoot) return undefined;
  if (labRoot !== undefined) {
    const dispatcherRoot = gitToplevel(path.resolve(labRoot, "..", ".."));
    if (dispatcherRoot !== undefined && cwdRoot === dispatcherRoot) return undefined;
  }
  return { cwdRoot, repoRoot };
}

/**
 * @param {{ cwdRoot: string, repoRoot: string }} mismatch
 */
export function formatRepoMismatch(mismatch) {
  return (
    `conductor: CONDUCTOR_REPO is ${mismatch.repoRoot} but you are standing in ${mismatch.cwdRoot}.\n` +
    `cd there, or unset CONDUCTOR_REPO, CONDUCTOR_EPIC, and CONDUCTOR_CHECKOUTS together to use this checkout.\n`
  );
}

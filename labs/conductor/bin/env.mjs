/**
 * Env the lab bin fills so you can sit in a product checkout and run it.
 *
 * The config door still refuses an unset `CONDUCTOR_REPO`. This fills `.`
 * (the process cwd) and this lab's `fsdev.config.ts` only when those are
 * blank. A match with the dispatcher is still refused after the config loads.
 */
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

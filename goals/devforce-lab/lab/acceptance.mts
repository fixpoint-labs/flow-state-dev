/**
 * Running the requester's acceptance check — the lab's half of D2.
 *
 * The check itself is `acceptance-check.mjs` beside this file. What lives here
 * is the one rule about *how* it is run, which is the part that makes it
 * evidence rather than decoration:
 *
 * - **It is spawned as its own process**, so an import the produced module
 *   performs cannot reach anything the check already loaded, and two
 *   executions of the same check against two different trees cannot share a
 *   module cache.
 * - **It is run from the lab, never from the tree.** The cwd is this directory.
 *   A check the coding agent could reach is a check the coding agent could
 *   satisfy by rewriting it, and then `ignores-the-brief` cannot fail.
 * - **Both outcomes are ordinary.** BR-3 needs the check to pass against the
 *   produced tree *and* fail against the base ref, so a rejection is returned
 *   with its reason rather than thrown.
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The check the brief names, as an absolute path. Outside every checkout. */
export const ACCEPTANCE_CHECK: string = fileURLToPath(
  new URL("./acceptance-check.mjs", import.meta.url),
);

/**
 * The module path the brief names, and the check imports.
 *
 * Exported so the goal reads the produced artifact from the same constant the
 * check judges it by — two spellings of one path is how a check comes to grade
 * a file nobody produced.
 */
export const ACCEPTANCE_MODULE = "src/greeting.js";

/** How long one acceptance execution may take. Generous; it imports one module. */
const ACCEPTANCE_TIMEOUT_MS = 30_000;

export interface AcceptanceVerdict {
  /** True when the tree satisfies every behaviour the brief stated. */
  accepted: boolean;
  /** The check's own one-line wording, for the verdict and for a failure. */
  reason: string;
}

/**
 * Execute the acceptance check against one tree.
 *
 * @param tree A working tree to judge — the produced one, or the base ref.
 * @returns Whether the tree satisfies the brief, and the check's own wording.
 * @throws If the check could not be run at all (a spawn failure or a timeout),
 *   which is a broken instrument rather than a rejected tree and must never be
 *   reported as one.
 */
export function runAcceptance(tree: string): AcceptanceVerdict {
  const result = spawnSync(process.execPath, [ACCEPTANCE_CHECK, tree], {
    cwd: dirname(ACCEPTANCE_CHECK),
    encoding: "utf8",
    timeout: ACCEPTANCE_TIMEOUT_MS,
  });

  if (result.error !== undefined) {
    throw new Error(`the acceptance check could not be run — ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `the acceptance check exited ${String(result.status)} (signal ${String(result.signal)}), ` +
        `which is neither ACCEPT nor REJECT: ${result.stderr.trim()}`,
    );
  }

  return { accepted: result.status === 0, reason: result.stdout.trim() };
}

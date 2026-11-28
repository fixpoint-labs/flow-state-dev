/**
 * Named controls as scratch patches to source modules, applied as the process
 * under test loads them (`module-patch.mjs`, through `NODE_OPTIONS`). Nothing
 * is written to the checkout.
 *
 *   const env = modulePatchEnv(patches, root, mark);   // hand to the process a control starts
 *   console.error(describePatches(patches, root));      // print the patch in full
 *   assertPatched(patches, root, mark);                 // after the run: did it reach the code?
 *
 * Each patch's `from` is a regular expression that reads the same in the
 * TypeScript source and in tsx's JavaScript output. A module that has nothing
 * matching fails here, before the run, and again at load, so a control that
 * no longer applies can't pass by running unpatched. Here it is its own
 * verdict, `control patch target not found`, with its own exit code
 * ({@link PATCH_TARGET_MISSING_EXIT}), so it can't read as the control failing
 * its row.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** One rewrite of one module, by its path from the checkout root. */
export interface ModulePatch {
  module: string;
  from: string;
  to: string;
}

const HOOK = fileURLToPath(new URL("./module-patch.mjs", import.meta.url));

/**
 * The exit code when a patch's target is missing from its module. Neither 0,
 * 1 (FAIL), nor 3 (CAN'T TELL): the control never ran, so it neither failed
 * its row nor passed it.
 */
const PATCH_TARGET_MISSING_EXIT = 4;

/**
 * The environment that applies `patches` to a process serving the checkout at
 * `root`. When `mark` is set, each patched file is appended to it as it loads.
 *
 * Exits with {@link PATCH_TARGET_MISSING_EXIT} when a module at the checkout
 * has nothing a patch's `from` matches.
 */
export function modulePatchEnv(patches: readonly ModulePatch[], root: string, mark?: string): Record<string, string> {
  for (const patch of patches) {
    const source = readFileSync(join(root, patch.module), "utf8");
    if (!new RegExp(patch.from).test(source)) {
      console.error(`control patch target not found: ${patch.module} /${patch.from}/`);
      process.exit(PATCH_TARGET_MISSING_EXIT);
    }
  }
  return {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${pathToFileURL(HOOK).href}`.trim(),
    GOAL_MODULE_PATCH: JSON.stringify({ patches: patches.map((p) => ({ file: join(root, p.module), from: p.from, to: p.to })), mark }),
  };
}

/** The patches as a reader sees them: each module, the lines before and after. */
export function describePatches(patches: readonly ModulePatch[], root: string): string {
  return patches
    .map((patch) => {
      const before = readFileSync(join(root, patch.module), "utf8")
        .split("\n")
        .filter((line) => new RegExp(patch.from).test(line));
      const after = before.map((line) => line.replace(new RegExp(patch.from), patch.to));
      return [`--- a/${patch.module}`, `+++ b/${patch.module}`, ...before.map((l) => `-${l}`), ...after.map((l) => `+${l}`)].join("\n");
    })
    .join("\n");
}

/**
 * @throws When some patched module never loaded in the process the control
 *   ran, so the run shows nothing about it.
 */
export function assertPatched(patches: readonly ModulePatch[], root: string, mark: string): void {
  const marked = existsSync(mark) ? readFileSync(mark, "utf8") : "";
  for (const patch of patches) {
    if (!marked.includes(join(root, patch.module))) {
      throw new Error(`setup: the patch never reached ${patch.module} in the code under test, so this run shows nothing`);
    }
  }
}

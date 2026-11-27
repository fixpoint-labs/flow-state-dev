/**
 * Where a probe runs in the tree it grades, and how it is taken away again.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

/**
 * `probe` placed in `root` at the depth it has in `home` (so its relative
 * imports reach `root`'s code), and a cleanup that removes only what was
 * added. It goes in a folder of its own beside the goal's, so a tree that
 * already holds this goal (a later commit's) keeps its own files untouched.
 * In `home` itself the probe runs where it is.
 */
export function placeProbe(probe: string, home: string, root: string): { path: string; cleanup: () => void } {
  const goalDir = join(root, relative(home, dirname(probe)));
  if (goalDir === dirname(probe)) return { path: probe, cleanup: () => {} };
  mkdirSync(dirname(goalDir), { recursive: true });
  const own = mkdtempSync(join(dirname(goalDir), `.${basename(goalDir)}-probe-`));
  const placed = join(own, basename(probe));
  copyFileSync(probe, placed);
  return { path: placed, cleanup: () => rmSync(own, { recursive: true, force: true }) };
}

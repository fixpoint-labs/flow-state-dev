/**
 * Goal check — one word per thing: no tracked file uses a retired name or a
 * retired meaning, and the sweep that says so can still fail.
 *
 * Two legs over the same `sweep.mjs`, each in its own `node` child:
 *
 * - **The tree.** Every git-tracked file under the swept roots is scanned or
 *   excluded by a named rule, and every hit is kept for a stated reason or
 *   marked `retired-name-refusal` on its line. One open line fails the goal.
 * - **The control.** `--control` plants `parkOnAsk` in a file the sweep reads.
 *   If the sweep doesn't report it, the first leg's PASS proves nothing.
 *
 * Model-free and network-free; CI's Process guards run `sweep.mjs` directly.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runGoal } from "../../lib/verdict.mts";

const SWEEP = fileURLToPath(new URL("./sweep.mjs", import.meta.url));

function sweep(args: string[]): { status: number | null; out: string } {
  const run = spawnSync(process.execPath, [SWEEP, ...args], { encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

await runGoal((failures) => {
  const tree = sweep(["--list"]);
  if (tree.status !== 0) failures.push(`the tree: the sweep found open lines or unruled files\n${tree.out}`);

  const control = sweep(["--control"]);
  if (control.status !== 0 || !control.out.includes("CONTROL OK")) {
    failures.push(`the control: the planted parkOnAsk was not reported\n${control.out}`);
  }

  const summary = /hits: .*/.exec(tree.out)?.[0] ?? "no summary line";
  return { failures, evidence: `${summary}; the planted hit was caught` };
});

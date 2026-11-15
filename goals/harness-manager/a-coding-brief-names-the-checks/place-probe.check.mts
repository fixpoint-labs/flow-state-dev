/**
 * A tree that already holds this goal (a later commit's cached tree) keeps its
 * own goal folder and probe after a run places and removes a probe in it.
 *
 * Run: pnpm tsx goals/harness-manager/a-coding-brief-names-the-checks/place-probe.check.mts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGoal } from "../../lib/index.mts";
import { placeProbe } from "./place-probe.mts";

const GOAL = join("goals", "harness-manager", "a-coding-brief-names-the-checks");

await runGoal((failures) => {
  const home = mkdtempSync(join(tmpdir(), "place-probe-home-"));
  const root = mkdtempSync(join(tmpdir(), "place-probe-root-"));
  mkdirSync(join(home, GOAL), { recursive: true });
  writeFileSync(join(home, GOAL, "app.probe.mts"), "// this checkout's probe\n");
  mkdirSync(join(root, GOAL), { recursive: true });
  writeFileSync(join(root, GOAL, "app.probe.mts"), "// the tree's own probe\n");
  writeFileSync(join(root, GOAL, "goal.md"), "# the tree's own goal\n");

  const placed = placeProbe(join(home, GOAL, "app.probe.mts"), home, root);
  if (readFileSync(placed.path, "utf8") !== "// this checkout's probe\n") failures.push("the placed probe is not this checkout's");
  if (readFileSync(join(root, GOAL, "app.probe.mts"), "utf8") !== "// the tree's own probe\n") failures.push("placing overwrote the tree's own probe");
  placed.cleanup();
  if (existsSync(placed.path)) failures.push("cleanup left the placed probe behind");
  if (!existsSync(join(root, GOAL, "goal.md"))) failures.push("cleanup removed the tree's own goal folder");
  else if (readFileSync(join(root, GOAL, "app.probe.mts"), "utf8") !== "// the tree's own probe\n") failures.push("the tree's own probe did not survive");
  return { failures, evidence: "the tree's own goal folder and probe survive a placed probe and its cleanup" };
});

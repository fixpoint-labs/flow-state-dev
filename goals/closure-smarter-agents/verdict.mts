/**
 * The closure's verdict for one pass, over the four apps' sheets
 * (`<app>/run.mts` writes each one; `closure.mts` → `sheetFile`):
 *
 * - **control**: each ask fails at least one run in at least one app it
 *   counts in. An ask whose control never failed is a failure line here and
 *   goes to the cut run like any other (epic ER-7).
 * - **cut**: which asks pass 3 of 3 in every app they count in, so which
 *   layers the coordinator may cancel (FIX-2541 D1, epic ER-6). Not pass/fail:
 *   the evidence lists the cells, and an app with no sheet is a failure.
 * - **wrap**: every ask passes 3 of 3 in every app it counts in, and the
 *   sweep finds no date, "done" or length guidance an app wrote in its own
 *   WORKER.md files (epic ER-3). The sweep is reported on every pass.
 *
 * Run:  GOAL_PASS=wrap pnpm tsx goals/closure-smarter-agents/verdict.mts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, runGoal } from "../lib/index.mts";
import { ALL_APPS, ASKS, cellsFor, controlFails, passesEverywhere, RUNS, sweepGuidance, type App, type Sheet } from "./asks.mts";
import { closurePass, sheetFile } from "./closure.mts";

/** Each app's workers' tree, under the served root. */
const TREES: Record<App, string[]> = {
  "claude-code-style": ["labs", "claude-code-style", "workforce"],
  teammates: ["labs", "teammates", "workforce"],
  "kitchen-sink": ["apps", "kitchen-sink", "workforce"],
  "shift-manager": ["packages", "shift-manager", "teams", "devteam", "workforce"],
};

/** Every WORKER.md under `dir`, by path from `root`. */
function workerFiles(root: string, dir: string, out: Record<string, string> = {}): Record<string, string> {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) workerFiles(root, path, out);
    else if (name === "WORKER.md") out[relative(root, path)] = readFileSync(path, "utf8");
  }
  return out;
}

const p = closurePass();

await runGoal((failures, tell) => {
  const sheet: Sheet = {};
  const missing: App[] = [];
  for (const app of ALL_APPS) {
    const file = sheetFile(p.pass, app);
    if (!existsSync(file)) {
      missing.push(app);
      continue;
    }
    const kept = (JSON.parse(readFileSync(file, "utf8")) as { sheet?: Sheet }).sheet ?? {};
    for (const ask of ASKS) if (kept[ask]?.[app] !== undefined) (sheet[ask] ??= {})[app] = kept[ask]![app];
  }
  for (const app of missing) failures.push(`${app}: no ${p.pass} sheet (run ${app}/run.mts with GOAL_PASS=${p.pass})`);

  const cells = tell.over(
    "graded cells",
    ASKS.flatMap((ask) => cellsFor(p.pass, ask).flatMap((app) => (sheet[ask]?.[app] === undefined ? [] : [{ ask, app }]))),
  );
  const rows = ASKS.map((ask) => {
    const per = cellsFor(p.pass, ask).map((app) => {
      const runs = sheet[ask]?.[app] ?? [];
      return `${app} ${runs.filter((r) => r.length === 0).length}/${runs.length}`;
    });
    return { ask, per: per.join(", ") };
  });

  const swept = sweepGuidance(Object.assign({}, ...ALL_APPS.map((app) => workerFiles(p.root, join(p.root, ...TREES[app])))));

  if (p.pass === "control") {
    for (const ask of ASKS) if (!controlFails(sheet, ask)) failures.push(`control: ${ask} never failed (${rows.find((r) => r.ask === ask)!.per})`);
  } else if (p.pass === "wrap") {
    for (const ask of ASKS) if (!passesEverywhere(sheet, ask, "wrap")) failures.push(`wrap: ${ask} does not pass ${RUNS} of ${RUNS} everywhere (${rows.find((r) => r.ask === ask)!.per})`);
    for (const line of swept) failures.push(`sweep: ${line}`);
  }
  const cut = p.pass === "cut" ? ASKS.filter((ask) => passesEverywhere(sheet, ask, "cut")) : [];
  const evidence = [
    `${p.pass} pass on ${p.describe}: ${cells.length} cells`,
    ...rows.map((r) => `${r.ask}: ${r.per}${p.pass === "cut" ? (cut.includes(r.ask) ? " → passes everywhere (its layer may be cut)" : " → keeps its layer") : ""}`),
    `sweep: ${swept.length === 0 ? "no app-written date, done or length guidance" : swept.join("; ")}`,
  ];
  return { failures, evidence: evidence.join("\n") };
});

#!/usr/bin/env node
/**
 * FIX-2087 task-surface sweep: no task tool beyond the five (and `answerTask` and
 * `parkOnQuestion` until FIX-2058), nothing the epic's migration table removes is live, and
 * nothing records a task's ending except the claim gate or the drain. CI's Typecheck job runs
 * it, and again with `--control`; `run.mts` runs the same engine as the goal's sweep leg.
 *
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs            # report + verdict
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs --rows     # how each migration row is covered
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs --control  # every plant must be reported
 *   node goals/workforce-coordination/runs-on-one-task/sweep.mjs --json     # the result as one JSON line (run.mts)
 *
 * Exit 0 = PASS, 1 = FAIL, 3 = CAN'T TELL (a rule read nothing).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepTaskSurface } from "./engine.mjs";
import { MIGRATION_TABLE, ROOTS, TOOLS_ALLOWED } from "./rules.mjs";

const args = new Set(process.argv.slice(2));
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/**
 * The negative control: one plant per rule, and a claim-passing cancel besides, each in a file
 * the sweep reads through the same path as a real one. Each must be reported, and nothing else
 * may change.
 */
const PLANTS = [
  {
    rule: "tools",
    path: "packages/orchestration/src/skills/__planted_tool__.ts",
    text: 'import { defineTool } from "@flow-state-dev/core";\nexport const poke = defineTool({ name: "pokeTask", description: "Poke a task." });\n',
  },
  {
    rule: "removed",
    path: "packages/workforce/src/__planted_removed__.ts",
    text: "export const legacy = { tool: \"dispatchTask\" };\n",
  },
  {
    rule: "endings",
    path: "packages/workforce/src/__planted_complete__.ts",
    text:
      'import type { TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";\n' +
      "export async function wrapUp(rows: TaskCollectionRef, taskId: string, output: unknown) {\n  const renamed = rows;\n  await renamed.complete(taskId, output);\n}\n",
  },
  {
    rule: "endings",
    path: "packages/workforce/src/__planted_cancel__.ts",
    text:
      'import type { TaskCollectionRef, TaskClaimTicket } from "@flow-state-dev/orchestration/tasks";\n' +
      "export async function giveUp(board: TaskCollectionRef, id: string, claim: TaskClaimTicket) {\n  await board.cancel(id, \"done here\", { claim });\n}\n",
  },
];

const started = Date.now();
const control = args.has("--control");
// `--at <commit>`: sweep another commit's tree (extracted with `git archive`), against this
// checkout's migration table, rules and plants: how today's main is shown to FAIL.
const atIndex = process.argv.indexOf("--at");
const at = atIndex >= 0 ? process.argv[atIndex + 1] : undefined;
let root = repo;
let tracked;
if (at !== undefined) {
  root = mkdtempSync(join(tmpdir(), "task-surface-"));
  execFileSync("sh", ["-c", `git -C "${repo}" archive --format=tar "${at}" | tar -x -C "${root}"`]);
  tracked = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", at, "--", ...ROOTS], { encoding: "utf8" }).split("\n").filter(Boolean);
}
const table = at === undefined ? undefined : join(repo, MIGRATION_TABLE);
const plain = sweepTaskSurface({ repo: root, tracked, table });
const result = control ? sweepTaskSurface({ repo: root, tracked, table, plants: PLANTS }) : plain;
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (args.has("--json")) {
  const { findings, tools, scanned, rows } = result;
  console.log(JSON.stringify({ findings, tools, scanned, rows, allowed: Object.keys(TOOLS_ALLOWED) }));
  process.exit(0);
}

const head = at ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const excluded = [...result.files.excluded.values()].reduce((a, b) => a + b, 0);
console.log(`commit ${head} · ${secs}s`);
console.log(`files: ${result.files.tracked} tracked · ${result.files.swept} swept by the removed rule · ${excluded} excluded · ${result.files.program} in the program`);
for (const [why, n] of result.files.excluded) console.log(`  excluded ${n} · ${why}`);
console.log(`tools offered (${result.tools.length}): ${result.tools.join(", ")}`);
console.log(`ending writes: ${result.scanned.endings} · by recorder ${JSON.stringify(result.recorders)}`);
console.log(`removed: ${result.rows.length} migration rows · ${result.scanned.removedText} text hits (${result.scanned.marked} marked retired-name-refusal · ${result.scanned.kept} kept by reason) · ${result.scanned.removedTyped} typed reads`);
if (args.has("--rows")) for (const r of result.rows) console.log(`  ${r.by.padEnd(28)} ${r.row.slice(0, 110)}`);

const byRule = (rule) => result.findings.filter((f) => f.rule === rule);
if (control) {
  // Exactly the plants: each reported, and nothing else changed against the plain run.
  const key = (f) => `${f.rule} ${f.where} ${f.what}`;
  const before = new Set(plain.findings.map(key));
  const added = result.findings.filter((f) => !before.has(key(f)));
  const missed = PLANTS.filter((p) => !added.some((f) => f.rule === p.rule && f.where.startsWith(p.path)));
  const stray = added.filter((f) => !PLANTS.some((p) => f.rule === p.rule && f.where.startsWith(p.path)));
  for (const p of PLANTS) console.log(`  plant ${p.rule.padEnd(8)} ${p.path}: ${missed.includes(p) ? "MISSED" : "reported"}`);
  for (const f of stray) console.log(`  stray   ${f.rule} ${f.where}  ${f.what}`);
  if (missed.length > 0 || stray.length > 0 || added.length !== PLANTS.length) {
    console.log(`CONTROL BROKEN: ${missed.length} plant(s) passed, ${stray.length} other line(s) changed, ${added.length} added for ${PLANTS.length} plants`);
    process.exit(1);
  }
  console.log(`CONTROL OK: the plain run's ${plain.findings.length} live lines and exactly the ${PLANTS.length} plants`);
  process.exit(0);
}

if (result.scanned.tools === 0 || result.scanned.endings === 0 || result.rows.length === 0) {
  console.log(`CAN'T TELL — a rule read nothing (tools ${result.scanned.tools}, endings ${result.scanned.endings}, rows ${result.rows.length})`);
  process.exit(3);
}
if (result.findings.length === 0) {
  console.log("PASS — no task tool beyond the allow list, nothing the migration table removes is live, every ending write is a recorder's");
  process.exit(0);
}
console.log(`FAIL — ${result.findings.length} live lines (tools ${byRule("tools").length} · removed ${byRule("removed").length} · endings ${byRule("endings").length})`);
for (const f of result.findings) console.log(`  ${f.rule.padEnd(8)} ${f.where}  ${f.what}`);
process.exit(1);

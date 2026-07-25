/**
 * The goals sweep — `pnpm goal:all`.
 *
 * The README has promised this since the library was created ("once a few goals
 * exist"); there are now more than twenty. Discovers every `goal.md` under
 * `goals/`, runs its sibling `run.mts`, and prints one summary table.
 *
 * Runs sequentially and by design: a model-backed goal costs real inference,
 * several drive the same app, and interleaved child stdio makes a failure
 * impossible to read. The sweep is a deliberate act, not a watch loop.
 *
 *   pnpm goal:all                  # every goal with a runner
 *   pnpm goal:all --model-free     # only goals whose goal.md says Model: n/a
 *   pnpm goal:all suspension       # only goals whose path contains "suspension"
 *   pnpm goal:all --list           # show what would run, run nothing
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const GOALS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

interface Goal {
  /** Path relative to `goals/`, e.g. `suspension/resumes-after-a-cold-restart`. */
  id: string;
  dir: string;
  hasRunner: boolean;
  /** True when goal.md declares `Model: n/a` / `none` — costs no inference. */
  modelFree: boolean;
}

/** Recursively find every directory holding a `goal.md`, skipping `_template`. */
function discover(dir: string, found: Goal[] = []): Goal[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name === "lib" || entry.name === "scripts") continue;
    if (entry.name === "_template" || entry.name === "fixtures") continue;
    const child = join(dir, entry.name);
    const goalMd = join(child, "goal.md");
    let isGoal = false;
    try {
      isGoal = statSync(goalMd).isFile();
    } catch {
      isGoal = false;
    }
    if (isGoal) {
      const spec = readFileSync(goalMd, "utf8");
      // Two goal.md schemas are in use: the template's field list (`**Model:**`)
      // and the trading-desk prose form (`**Model.**`). Accept both.
      const modelLine = /^\*\*Model[:.]\*\*(.*)$/m.exec(spec);
      const declared = (modelLine?.[1] ?? "").trim().toLowerCase();
      found.push({
        id: relative(GOALS_ROOT, child),
        dir: child,
        hasRunner: hasFile(join(child, "run.mts")),
        modelFree: declared.startsWith("n/a") || declared.startsWith("none"),
      });
    } else {
      discover(child, found);
    }
  }
  return found;
}

function hasFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const USAGE = `pnpm goal:all [options] [path-filter...]

  --list         Show what would run; run nothing.
  --model-free   Only goals whose goal.md declares Model: n/a / none.
  --help         This message.

  Any non-option argument is a substring matched against the goal's path.
  With no filters, EVERY goal runs — including model-backed ones, which cost
  real inference.`;

const args = process.argv.slice(2);

// Reject unknown options rather than ignoring them. A typo (`--modelfree`) or a
// bare `--help` would otherwise fall through with both mode flags false and no
// path filter, which selects the ENTIRE corpus and starts every model-backed
// goal — a discovery command or a slip must never spend real inference.
const KNOWN_OPTIONS = new Set(["--list", "--model-free", "--help"]);
const unknown = args.filter((a) => a.startsWith("-") && !KNOWN_OPTIONS.has(a));
if (unknown.length > 0) {
  console.error(`Unknown option(s): ${unknown.join(", ")}\n\n${USAGE}`);
  process.exit(2);
}
if (args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}

const listOnly = args.includes("--list");
const modelFreeOnly = args.includes("--model-free");
const filters = args.filter((a) => !a.startsWith("-"));

const all = discover(GOALS_ROOT).sort((a, b) => a.id.localeCompare(b.id));
const selected = all.filter((goal) => {
  if (modelFreeOnly && !goal.modelFree) return false;
  if (filters.length > 0 && !filters.some((f) => goal.id.includes(f))) return false;
  return true;
});

const missingRunner = selected.filter((g) => !g.hasRunner);
const runnable = selected.filter((g) => g.hasRunner);

if (listOnly) {
  for (const goal of selected) {
    const tags = [goal.modelFree ? "model-free" : "model-backed", goal.hasRunner ? "" : "NO RUNNER"]
      .filter(Boolean)
      .join(", ");
    console.log(`${goal.id}  (${tags})`);
  }
  console.log(`\n${selected.length} goal(s) selected of ${all.length} total.`);
  process.exit(0);
}

if (runnable.length === 0) {
  console.error("No runnable goals matched.");
  process.exit(1);
}

const results: { id: string; verdict: "PASS" | "FAIL"; note: string }[] = [];

for (const [index, goal] of runnable.entries()) {
  const header = `[${index + 1}/${runnable.length}] ${goal.id}`;
  console.log(`\n${"=".repeat(Math.min(header.length + 4, 80))}\n${header}\n${"=".repeat(Math.min(header.length + 4, 80))}`);

  // stdout is INHERITED, not piped.
  //
  // A goal that drives `fsdev run` without `--quiet` streams the CLI's full
  // NDJSON item log — unbounded, growing with item count and answer length.
  // Capturing that through a pipe hits `spawnSync`'s default 1 MiB `maxBuffer`,
  // which returns ENOBUFS with a NULL status: an expensive goal that actually
  // PASSED would be reported as failed, and its child may outlive the runner.
  //
  // Raising `maxBuffer` only moves the cliff. Inheriting removes it: the goal's
  // output streams straight to the terminal (better for a long sweep anyway),
  // and the verdict comes from the EXIT CODE, which `runGoal` already
  // guarantees — 0 for PASS, 1 for FAIL. The PASS evidence line has by then
  // already been printed by the goal itself, so nothing is lost by not
  // re-capturing it here.
  const run = spawnSync("pnpm", ["tsx", join(goal.dir, "run.mts")], {
    cwd: GOALS_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });

  // `status` is null when the child was killed by a signal; treat that as FAIL.
  results.push({
    id: goal.id,
    verdict: run.status === 0 ? "PASS" : "FAIL",
    note:
      run.status === 0
        ? ""
        : run.status === null
          ? `killed by signal ${run.signal ?? "unknown"}`
          : `exit ${run.status}`,
  });
}

const failed = results.filter((r) => r.verdict === "FAIL");

console.log(`\n${"=".repeat(80)}\nGOAL SWEEP SUMMARY\n${"=".repeat(80)}`);
for (const result of results) {
  console.log(
    `${result.verdict}  ${result.id}${result.note !== "" ? `  (${result.note})` : ""}`,
  );
}
if (missingRunner.length > 0) {
  console.log(`\n${missingRunner.length} goal(s) have a goal.md but NO run.mts (not run):`);
  for (const goal of missingRunner) console.log(`      ${goal.id}`);
}
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (missingRunner.length > 0 ? `, ${missingRunner.length} unimplemented` : ""),
);

process.exit(failed.length === 0 ? 0 : 1);

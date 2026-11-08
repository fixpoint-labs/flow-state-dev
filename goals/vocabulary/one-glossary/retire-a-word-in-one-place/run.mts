/**
 * Goal check — one glossary: a word is retired by one glossary entry, and every
 * vocabulary check enforces it on its next run, with no rule lost in the move.
 *
 * Every leg runs in a throwaway copy of one commit (`git archive`, then a fresh
 * repository whose `main` is that commit), so the checks list tracked files and
 * diff added lines exactly as CI does, and this checkout is never touched.
 *
 * - **Lever.** Two words generated now, so no rule can already know them. One
 *   entry retires the first by name; a second entry names the side-chain
 *   check's matcher for the second. Plants: the first word in two packages'
 *   source and on a published page, the second in a `.ts` file, and a third
 *   word nobody retired. The sweep and the guard must report the first word's
 *   plants, the side-chain check the second's, and nobody the third. With the
 *   entries removed and the plants left in, all three must pass. The copy's
 *   diff must touch only the glossary and the plants.
 * - **Parity.** On the move's own commit (`MOVED`), the check files from before
 *   the move (`BEFORE`) and the ones that read the glossary must print the same counts:
 *   the sweep's hits, kept, marked and open and its open-by-rule; the guard's
 *   stripped per exception and counted per term; the side-chain check's
 *   findings; and every `--control` verdict. Skipped when the commit has no
 *   glossary (the control).
 *
 * Model-free. `--at <ref>` reads another commit (default `HEAD`). The control is
 * `--at <BEFORE>`: there no check reads the glossary, so the lever leg must FAIL.
 * `--parity-at <ref>` replays parity on another tree (default `MOVED`), so the
 * parity leg's own control (a commit on `MOVED` that drops a rule) can reach it.
 *
 * Run: pnpm tsx goals/vocabulary/one-glossary/retire-a-word-in-one-place/run.mts [--at <ref>] [--parity-at <ref>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { goalTmpDir } from "../../../lib/paths.mts";
import { runGoal } from "../../../lib/verdict.mts";

/** The commit the move was built on: main with the approved spec merged, every check still holding its own lists. */
const BEFORE = "0f1056861c07f2e39c11bc2a1e3c37231b757de0";
/**
 * The move's last commit, before any later issue edited the glossary. Parity is the claim that
 * the move lost no rule, so it is read there: from FIX-2354 on, each issue changes what the
 * checks read on purpose, and the pre-move files would differ by exactly that.
 */
const MOVED = "a3655381ede427f17a1ef1d628003e9ab2f0fa78";
const GLOSSARY = "docs/contributing/glossary.mjs";
const ENTRIES_OPEN = "export const ENTRIES = [\n";
/** The check files the move changed, restored from BEFORE for the parity leg. */
const PRE_MOVE_FILES = [
  "goals/vocabulary/one-word-per-thing/rules.mjs",
  "goals/vocabulary/one-word-per-thing/sweep.mjs",
  "scripts/check-retired-terms.mjs",
  "scripts/validate-side-chain-vocabulary.mjs",
];
/** The three checks, exactly as CI's steps (and `pnpm typecheck`) run them. */
const SWEEP = ["goals/vocabulary/one-word-per-thing/sweep.mjs"];
const GUARD = ["scripts/check-retired-terms.mjs"];
const SIDE_CHAIN = ["scripts/validate-side-chain-vocabulary.mjs"];

const at = process.argv.includes("--at") ? process.argv[process.argv.indexOf("--at") + 1] : "HEAD";
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const commit = execFileSync("git", ["rev-parse", at], { cwd: repo, encoding: "utf8" }).trim();
const parityAt = process.argv.includes("--parity-at") ? process.argv[process.argv.indexOf("--parity-at") + 1] : MOVED;

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

/** A fresh repository holding `tree`'s tree (default: the commit read) as `main`, with this checkout's installs linked in. */
function copyOf(label: string, tree: string = commit): string {
  const dir = join(goalTmpDir("one-glossary"), label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["archive", tree], { cwd: repo, maxBuffer: 1024 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1024 * 1024 * 1024 });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `copy of ${tree}`]);
  // The side-chain check parses with ts-morph; `node_modules` is gitignored, so the link is never read as a file.
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  return dir;
}

type Run = { status: number | null; out: string };
function check(dir: string, script: string[], extra: string[] = []): Run {
  // GITHUB_BASE_REF unset, so the guard diffs added lines against the copy's own main.
  const env = { ...process.env, GITHUB_BASE_REF: "" };
  const r = spawnSync(process.execPath, [...script, ...extra], { cwd: dir, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function write(dir: string, path: string, text: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** Add entries the way an owner does: first in the list. Where there is no glossary, the same text in a new file. */
function withEntries(text: string | undefined, entries: string[]): string {
  const block = entries.map((e) => `  ${e},\n`).join("");
  if (text === undefined) return `${ENTRIES_OPEN}${block}];\n`;
  if (!text.includes(ENTRIES_OPEN)) throw new Error(`${GLOSSARY} no longer opens its entries with \`export const ENTRIES = [\``);
  return text.replace(ENTRIES_OPEN, `${ENTRIES_OPEN}${block}`);
}

await runGoal((failures, tell) => {
  const evidence: string[] = [`commit ${commit.slice(0, 10)}`];

  // ---- Lever ----
  const word = () => `zq${randomBytes(4).toString("hex")}Term`;
  const [retired, sideChainOnly, untouched] = [word(), word(), word()];
  const dir = copyOf("lever");
  const glossaryPath = join(dir, GLOSSARY);
  const original = existsSync(glossaryPath) ? readFileSync(glossaryPath, "utf8") : undefined;
  const plants = {
    "packages/core/src/zz-goal-plant.ts": `export const ${retired} = 1;\nexport const ${untouched} = 2;\n`,
    "packages/engine/src/zz-goal-plant.ts": `export const ${retired} = 1;\n`,
    "apps/docs/docs/zz-goal-plant.md": `# Planted\n\nCall \`${retired}\` here.\n\nOr call \`${untouched}\`.\n`,
    "packages/orchestration/src/zz-goal-plant.ts": `export function ${sideChainOnly}() {}\n`,
  };
  writeFileSync(
    glossaryPath,
    withEntries(original, [
      `{ term: "Planted ${retired}", means: "A word this goal retires.", retires: [{ name: "${retired}" }] }`,
      `{ term: "Planted ${sideChainOnly}", means: "A word this goal retires for the side-chain check.", retires: [{ name: "${sideChainOnly}", check: "side-chain" }] }`,
    ]),
  );
  for (const [path, text] of Object.entries(plants)) write(dir, path, text);
  git(dir, ["add", "-A"]);

  const changed = git(dir, ["status", "--porcelain"]).split("\n").filter(Boolean).map((l) => l.slice(3));
  const allowed = new Set([GLOSSARY, ...Object.keys(plants)]);
  const stray = changed.filter((p) => !allowed.has(p));
  if (stray.length > 0) failures.push(`lever: the copy's diff touches more than the glossary and the plants: ${stray.join(", ")}`);

  const sweep = check(dir, SWEEP, ["--list"]);
  const guard = check(dir, GUARD, ["--list"]);
  const sideChain = check(dir, SIDE_CHAIN, ["--json"]);
  const textPlants = ["packages/core/src/zz-goal-plant.ts", "packages/engine/src/zz-goal-plant.ts", "apps/docs/docs/zz-goal-plant.md"];
  for (const path of tell.over("lever: text-check plants", textPlants)) {
    if (sweep.status === 0 || !new RegExp(`^\\s+${retired}\\t${path.replace(/[./]/g, "\\$&")}:\\d+`, "m").test(sweep.out)) {
      failures.push(`lever: the plant is refused — the sweep did not report ${retired} in ${path}`);
    }
    if (guard.status === 0 || !new RegExp(`^${path.replace(/[./]/g, "\\$&")}:\\d+\\s+\\[${retired}\\]`, "m").test(guard.out)) {
      failures.push(`lever: the plant is refused — the guard did not report ${retired} in ${path}`);
    }
  }
  let findings: Array<{ file: string; detail: string }> = [];
  try {
    findings = JSON.parse(sideChain.out.slice(sideChain.out.indexOf("[")));
  } catch {
    failures.push(`lever: the side-chain check printed no findings list\n${sideChain.out.slice(0, 400)}`);
  }
  if (sideChain.status === 0 || !findings.some((f) => f.file === "packages/orchestration/src/zz-goal-plant.ts" && f.detail === sideChainOnly)) {
    failures.push(`lever: the plant is refused — the side-chain check did not report ${sideChainOnly}`);
  }
  // Each plant of an unretired word sits on its own line, so a report naming it is a report of it.
  if (sweep.out.includes(untouched) || guard.out.includes(untouched) || findings.some((f) => f.detail.includes(untouched))) {
    failures.push(`lever: a word no entry retires (${untouched}) was reported`);
  }
  if (sweep.out.includes(sideChainOnly) || guard.out.includes(sideChainOnly)) {
    failures.push(`lever: the text checks reported ${sideChainOnly}, which only the side-chain check matches`);
  }
  // Remove the entries; the plants stay. Every check must clear.
  if (original === undefined) rmSync(glossaryPath);
  else writeFileSync(glossaryPath, original);
  git(dir, ["add", "-A"]);
  const cleared = { sweep: check(dir, SWEEP), guard: check(dir, GUARD), sideChain: check(dir, SIDE_CHAIN) };
  for (const [name, r] of Object.entries(cleared)) {
    if (r.status !== 0) failures.push(`lever: with the entries removed, ${name} still fails\n${r.out.slice(-600)}`);
  }
  evidence.push(`lever: ${retired} refused by the sweep and the guard in ${textPlants.length} plants, ${sideChainOnly} by the side-chain check; all three pass with the entries removed`);

  // ---- Parity ----
  if (original === undefined) {
    evidence.push("parity: skipped, this commit has no glossary");
    return { failures, evidence: evidence.join("; ") };
  }
  const after = copyOf("parity", parityAt);
  const runAll = (d: string) => ({
    sweep: check(d, SWEEP),
    sweepControl: check(d, SWEEP, ["--control"]),
    guard: check(d, GUARD),
    guardControl: check(d, GUARD, ["--control"]),
    sideChain: check(d, SIDE_CHAIN, ["--json"]),
  });
  const now = runAll(after);
  for (const path of PRE_MOVE_FILES) write(after, path, git(repo, ["show", `${BEFORE}:${path}`]));
  const then = runAll(after);

  const lines = (out: string, re: RegExp) => out.split("\n").filter((l) => re.test(l)).map((l) => l.trim());
  const sweepCounts = (r: Run) => [...lines(r.out, /^hits: /), ...lines(r.out, /^open lines: /), JSON.stringify(Object.entries(JSON.parse(/^open by rule: (.*)$/m.exec(r.out)?.[1] ?? "{}")).sort())];
  const guardCounts = (r: Run) => [...lines(r.out, /^exception \S+: \d+ stripped$/), ...lines(r.out, /^\S+: \d+ counted/)].sort();
  const compare = (name: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`parity: ${name} differs\n  before the move: ${JSON.stringify(b)}\n  reading the glossary: ${JSON.stringify(a)}`);
  };
  compare("the sweep's counts", sweepCounts(now.sweep), sweepCounts(then.sweep));
  compare("the guard's counts", tell.over("parity: guard count lines", guardCounts(now.guard)), guardCounts(then.guard));
  compare("the side-chain findings", now.sideChain.out.trim(), then.sideChain.out.trim());
  compare("the sweep's control", lines(now.sweepControl.out, /^CONTROL /), lines(then.sweepControl.out, /^CONTROL /));
  compare("the guard's control", tell.over("parity: guard control verdicts", lines(now.guardControl.out, /^plant |^CONTROL /)), lines(then.guardControl.out, /^plant |^CONTROL /));
  for (const k of Object.keys(now) as Array<keyof typeof now>) compare(`${k}'s exit code`, now[k].status, then[k].status);
  evidence.push(`parity: ${sweepCounts(now.sweep)[0] ?? "no sweep summary"}; ${guardCounts(now.guard).length} guard count lines and ${lines(now.guardControl.out, /^plant |^CONTROL /).length} guard control verdicts match the pre-move checks, at ${parityAt.slice(0, 9)}`);

  return { failures, evidence: evidence.join("; ") };
});

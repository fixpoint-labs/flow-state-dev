/**
 * Goal check — new code says entry: a change that names a resource "row" in
 * new code, or uses one of the six phrases anywhere, is stopped before it
 * merges, while store adapters and UI list modules keep their rows (FIX-2631).
 *
 * Every leg runs in a throwaway copy of one commit's tree (`git archive`, then a
 * fresh repository whose `main` is that commit), with the rule as built in this
 * checkout laid over it (`docs/contributing/glossary.mjs`,
 * `scripts/check-retired-terms.mjs`). The hook's loop and CI's run lines are
 * read from the tree under test (`.husky/pre-push`, `.github/workflows/ci.yml`)
 * and run as they are written, so a step that is missing there is missing here.
 *
 * - **open.** The guard's whole-tree run reports nothing under the resource
 *   entry, over every tracked file.
 * - **adds.** One commit on a topic branch adds names generated now: a row
 *   local in a package picked at random outside the kept paths, a `T…Row` type
 *   parameter in another, and a phrase in a test name. Each is reported both
 *   ways: by the hook (its whole-tree run, then its loop over the pushed sha
 *   against `merge-base origin/main <sha>`) and by CI (its run lines, base
 *   `HEAD^1`). Each run exits 1.
 * - **keeps.** The same commit adds a `row` local in a store adapter and in a
 *   `components/` file, and edits a line that already declares `row`. Neither
 *   way reports any of them.
 *
 * Model-free. `--at <ref>` reads another commit's tree (default `HEAD`).
 * Controls:
 *   GOAL_CONTROL=no-base   the hook has no origin/main, CI's run lines lose their base: must FAIL on adds
 *   --at <main before FIX-2631>  must FAIL on open (the phrases) and on adds (no added reach there)
 *
 * Run: pnpm tsx goals/vocabulary/resource-names/new-code-says-entry/run.mts [--at <ref>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT, goalTmpDir, runGoal } from "../../../lib/index.mts";

const SLUG = "new-code-says-entry";
const RULE_FILES = ["docs/contributing/glossary.mjs", "scripts/check-retired-terms.mjs"];
const GUARD = "scripts/check-retired-terms.mjs";
const RULE = "collection-row";
/** The kept paths, from the decided rule (FIX-2479 "Decided, not asked"), not from the glossary. */
const KEPT = /^packages\/(?:store-[^/]+|engine\/src\/stores)\/|(?:^|\/)(?:components|surfaces)\//;

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "no-base") {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: no-base`);
  process.exit(2);
}
const at = process.argv.includes("--at") ? process.argv[process.argv.indexOf("--at") + 1]! : "HEAD";
const commit = execFileSync("git", ["rev-parse", at], { cwd: REPO_ROOT, encoding: "utf8" }).trim();

const git = (cwd: string, args: string[]) =>
  execFileSync("git", ["-c", "user.name=goal", "-c", "user.email=goal@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

function write(dir: string, path: string, text: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** A fresh repository holding `commit`'s tree with the rule as built laid over it, committed as `main`. */
function copyOf(label: string): string {
  const dir = join(goalTmpDir(SLUG), label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["archive", commit], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1024 * 1024 * 1024 });
  for (const path of RULE_FILES) write(dir, path, readFileSync(join(REPO_ROOT, path), "utf8"));
  // The guard reads names with TypeScript's parser; `node_modules` is gitignored, so the link is never committed.
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `copy of ${commit}`]);
  return dir;
}

type Run = { status: number | null; out: string };
/** Run a script as husky runs a hook: `sh -e`, so a failing line stops it. */
const sh = (dir: string, script: string, input = ""): Run => {
  const r = spawnSync("sh", ["-e", "-c", script], { cwd: dir, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/**
 * The hook's guard steps, as `.husky/pre-push` writes them: its whole-tree run, and its loop over the
 * pushed refs. Each is its own script: under `sh -e` the first failing step would stop the rest, and
 * each reach is graded on its own.
 */
function hookSteps(dir: string): string[] {
  const hook = readFileSync(join(dir, ".husky/pre-push"), "utf8").split("\n");
  const whole = hook.filter((l) => l.startsWith(`node ${GUARD}`));
  const start = hook.findIndex((l) => /^while read\b/.test(l));
  const end = hook.findIndex((l, i) => i > start && /^done\b/.test(l));
  const loop = start >= 0 && end > start ? [hook.slice(start, end + 1).join("\n")] : [];
  return [...whole.map((l) => `${l} --list ${RULE}`), ...loop];
}

/** Several steps, each run on its own; the way fails when any step does. */
const steps = (dir: string, scripts: string[], input = ""): Run => {
  const runs = scripts.map((s) => sh(dir, s, input));
  return { status: runs.some((r) => r.status !== 0) ? 1 : 0, out: runs.map((r) => r.out).join("\n") };
};

/** CI's guard run lines, as `.github/workflows/ci.yml` writes them, `--control` left out. */
function ciScript(dir: string): string[] {
  const ci = readFileSync(join(dir, ".github/workflows/ci.yml"), "utf8");
  return [...ci.matchAll(/^\s+run: (node scripts\/check-retired-terms\.mjs.*)$/gm)].map((m) => m[1]!.trim()).filter((l) => !l.includes("--control"));
}

/** The paths a run reports, `path:line`, under the resource entry. */
const reported = (out: string) => new Set([...out.matchAll(/^(\S+?):(\d+) {2}\[collection-row\]/gm)].map((m) => `${m[1]}:${m[2]}`));

await runGoal(async (failures, tell) => {
  const evidence: string[] = [`tree ${commit.slice(0, 10)}${CONTROL ? ` · control ${CONTROL}` : ""}`];

  // ---- open ----
  const dir = copyOf("open");
  const open = sh(dir, `node ${GUARD} --list ${RULE}`);
  const tracked = Number(/^tracked files: (\d+)$/m.exec(open.out)?.[1] ?? 0);
  tell.over("open: tracked files the guard read", tracked > 0 ? [tracked] : []);
  const openLines = [...reported(open.out)];
  if (openLines.length > 0) failures.push(`open: OPEN ${openLines.length} under the resource entry:\n    ${openLines.slice(0, 20).join("\n    ")}`);
  else evidence.push(`open: OPEN 0 over ${tracked} tracked files`);

  // ---- adds and keeps: one topic commit ----
  const id = randomBytes(3).toString("hex");
  const pkgs = readdirSync(join(dir, "packages")).filter((p) => !KEPT.test(`packages/${p}/`) && readdirSync(join(dir, "packages", p)).includes("src"));
  const pick = () => pkgs.splice(Math.floor(Math.random() * pkgs.length), 1)[0]!;
  const [localPkg, typePkg, testPkg] = [pick(), pick(), pick()];
  const adds: Record<string, string> = {
    [`packages/${localPkg}/src/zz-goal-${id}.ts`]: `export function zq${id}(list: string[]) {\n  const zq${id}Row = list[0];\n  return zq${id}Row;\n}\n`,
    [`packages/${typePkg}/src/zz-goal-${id}.ts`]: `export function zq${id}<TZq${id}Row>(x: TZq${id}Row) {\n  return x;\n}\n`,
    [`packages/${testPkg}/test/zz-goal-${id}.test.ts`]: `it("reads each task's rows for zq${id}", () => {});\n`,
  };
  const keeps: Record<string, string> = {
    [`packages/store-sqlite/src/zz-goal-${id}.ts`]: `export function zq${id}(list: string[]) {\n  const row = list[0];\n  return row;\n}\n`,
    [`packages/react/src/components/zz-goal-${id}.tsx`]: `export function zq${id}(list: string[]) {\n  const row = list[0];\n  return row;\n}\n`,
  };
  // An edit to a line that already declares a row local, outside the kept paths.
  const old = git(dir, ["grep", "-n", "-E", "^\\s*const row = .*;$", "--", "packages/*/src/*.ts"])
    .split("\n")
    .map((l) => /^([^:]+):(\d+):/.exec(l))
    .find((m) => m !== null && !KEPT.test(m[1]!));
  if (old === undefined) failures.push("keeps: no line declaring a row local outside the kept paths to edit");
  for (const [path, text] of Object.entries({ ...adds, ...keeps })) write(dir, path, text);
  if (old) {
    const lines = readFileSync(join(dir, old[1]!), "utf8").split("\n");
    lines[Number(old[2]) - 1] += " // edited by the goal";
    writeFileSync(join(dir, old[1]!), lines.join("\n"));
  }
  git(dir, ["checkout", "-q", "-b", "topic"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "topic"]);
  const sha = git(dir, ["rev-parse", "HEAD"]).trim();
  const base = git(dir, ["rev-parse", "main"]).trim();
  if (CONTROL !== "no-base") git(dir, ["update-ref", "refs/remotes/origin/main", base]);

  const ciLines = ciScript(dir).map((l) => (CONTROL === "no-base" ? l.replace(/ --added-since \S+/, "") : l));
  const ways: Record<string, Run> = {
    // git hands the hook each pushed ref: <local ref> <local sha> <remote ref> <remote sha>; a deletion's local sha is all zeros.
    hook: steps(dir, hookSteps(dir), `refs/heads/topic ${sha} refs/heads/topic ${"0".repeat(40)}\n(delete) ${"0".repeat(40)} refs/heads/gone ${base}\n`),
    ci: steps(dir, ciLines.map((l) => (l.includes("--added-since") ? l : `${l} --list ${RULE}`))),
  };
  // The local is declared on line 2; the type parameter and the test name on line 1.
  const addLines = Object.keys(adds).map((p, i) => `${p}:${i === 0 ? 2 : 1}`);
  for (const [way, run] of Object.entries(ways)) {
    const got = reported(run.out);
    for (const line of tell.over(`adds: names committed (${way})`, addLines)) if (!got.has(line)) failures.push(`adds: the ${way} run did not report ${line}`);
    if (run.status === 0) failures.push(`adds: the ${way} run passed with the committed names`);
    const kept = [...got].filter((l) => Object.keys(keeps).some((p) => l.startsWith(`${p}:`)) || (old && l.startsWith(`${old[1]}:`)));
    if (kept.length > 0) failures.push(`keeps: the ${way} run reported ${kept.join(", ")}`);
  }
  evidence.push(`adds: ${addLines.join(", ")} on the hook's merge base and CI's HEAD^1`);
  evidence.push(`keeps: a row local in store-sqlite and react/components, and an edit to ${old ? `${old[1]}:${old[2]}` : "nothing"}, reported by neither`);
  evidence.push(`ci ran: ${ciLines.join(" ; ")}`);
  return { failures, evidence: evidence.join("; ") };
});

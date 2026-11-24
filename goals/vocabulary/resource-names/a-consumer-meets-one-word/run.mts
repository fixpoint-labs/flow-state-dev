/**
 * Goal check — resource names: someone building on the packages meets one word
 * for a stored thing, *resource*, and *Status* for a lifecycle; the resource
 * rule holds it over the whole tree; a hold stored under the retired marker
 * still reads and answers.
 *
 * The rule legs run in a throwaway copy of one commit's tree (`git archive`,
 * then a fresh repository whose `main` is that commit), with the resource
 * rule as built in this checkout laid over it (`docs/contributing/glossary.mjs`
 * and `scripts/check-retired-terms.mjs`), run as CI runs it. At `HEAD` the
 * overlay is the commit's own files; under `--at <ref>` it asks what the rule
 * finds in that older tree.
 *
 * - **open.** The guard's whole-tree run reports no line under the resource
 *   entry, over every tracked file.
 * - **reaches.** Names generated now (a `…Row` type in one package, a
 *   `use…CollectionItem` export in another, a lifecycle `…State`), committed
 *   into the copy's `main` so no diff holds them, are each reported by the
 *   same run: the rule reads the tree, not the lines a change adds.
 * - **control.** The guard's `--control` refuses its planted `FooRow` type and
 *   `useFooCollectionItem` export, in more than one package.
 * - **exemptions.** The resource entry keeps nothing beyond the store-adapter
 *   and UI-list path rules, D2's stored field names and D4's released quotes:
 *   each path rule keeps only files of its kind, the quote rule names only the
 *   three released messages on published pages, and the matcher carries no
 *   narrowing context.
 * - **hold.** `legacy-hold.mts`: a task stored with a `"row"` hold is listed by
 *   the Inbox read as `"task"`, answered through `updateTask`, and the hold
 *   closes, for a question and a confirm. Runs on this checkout's code only.
 *
 * Model-free. `--at <ref>` reads another commit's tree (default `HEAD`); the
 * hold leg is skipped there. Controls:
 *   --at <origin/main before FIX-2479>   must FAIL on open, with the open names listed
 *   GOAL_CONTROL=no-row-read             the hold parse stops reading "row": must FAIL hold
 *
 * Run: pnpm tsx goals/vocabulary/resource-names/a-consumer-meets-one-word/run.mts [--at <ref>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, type ModulePatch } from "../../../lib/index.mts";

const RULE_FILES = ["docs/contributing/glossary.mjs", "scripts/check-retired-terms.mjs"];
const GUARD = "scripts/check-retired-terms.mjs";
const RULE = "collection-row";
const HOLD_LEG = join(REPO_ROOT, "goals/vocabulary/resource-names/a-consumer-meets-one-word/legacy-hold.mts");

/** What each kept kind of path may hold, read from the decided rule (FIX-2479 "Decided, not asked"), not from the glossary. */
const STORE_ADAPTER = /^packages\/store-[^/]+\/|^packages\/engine\/src\/stores\/|^packages\/contracts\/src\/helpers\/write-version\.ts$/;
const UI_LIST = /(?:^|\/)(?:components|surfaces)\//;
const PUBLISHED_PAGE = /^(?:apps\/docs\/(?:docs|guides)\/.*\.mdx?|packages\/[^/]+\/README\.md)$/;
/** The three released messages D4 lets a published page quote, as the released packages throw them. */
const RELEASED = [
  "A row of an owner-private collection is readable only by the user it belongs to.",
  "A row of an owner-writes collection is written only by the user it belongs to.",
  'Collection pattern "tenant/**" can reach the rows of owner-private collection "tenant/~u"',
];

const CONTROLS: Record<string, ModulePatch[]> = {
  // The parse no longer reads the retired marker forward: a stored "row" hold stays "row".
  "no-row-read": [{ module: "packages/orchestration/src/tasks/schema/hold.ts", from: 'const RETIRED_OWN_HOLD_MARKER = "row";', to: 'const RETIRED_OWN_HOLD_MARKER = "zz-no-marker";' }],
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}

const at = process.argv.includes("--at") ? process.argv[process.argv.indexOf("--at") + 1]! : "HEAD";
const commit = execFileSync("git", ["rev-parse", at], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();

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

/** A fresh repository holding `commit`'s tree with the rule as built laid over it, and `extra` files, all committed as `main`. */
function copyOf(label: string, extra: Record<string, string> = {}): string {
  const dir = join(goalTmpDir("a-consumer-meets-one-word"), label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["archive", commit], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar, maxBuffer: 1024 * 1024 * 1024 });
  for (const path of RULE_FILES) write(dir, path, readFileSync(join(REPO_ROOT, path), "utf8"));
  for (const [path, text] of Object.entries(extra)) write(dir, path, text);
  // The guard reads names with TypeScript's parser (FIX-2631 D2); `node_modules` is gitignored, so the link is never committed.
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `copy of ${commit}`]);
  return dir;
}

type Run = { status: number | null; out: string };
function guard(dir: string, args: string[]): Run {
  // GITHUB_BASE_REF unset, as a local run: a rule that still read added lines would see none here.
  const r = spawnSync(process.execPath, [GUARD, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_BASE_REF: "" }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The lines the guard's `--list` reports under the resource entry: `path:line  [collection-row]  text`. */
const resourceLines = (out: string) => out.split("\n").filter((line) => line.includes(`  [${RULE}]  `));

await runGoal(async (failures, tell) => {
  const evidence: string[] = [`tree ${commit.slice(0, 10)}${commit === head ? "" : ` with the rule as built at ${head.slice(0, 10)}`}`];

  // ---- open ----
  const tree = copyOf("open");
  const listed = guard(tree, ["--list", RULE]);
  const tracked = Number(/^tracked files: (\d+)$/m.exec(listed.out)?.[1] ?? 0);
  tell.over("open: tracked files the guard read", tracked > 0 ? [tracked] : []);
  const open = resourceLines(listed.out);
  if (open.length > 0) failures.push(`open: OPEN ${open.length} — the resource entry reports, at whole-tree scope:\n    ${open.join("\n    ")}`);
  else evidence.push(`open: OPEN 0 over ${tracked} tracked files`);

  // ---- reaches ----
  const id = randomBytes(3).toString("hex");
  const names = { row: `Zq${id}Row`, item: `useZq${id}CollectionItem`, state: `Zq${id}State` };
  const plants: Record<string, string> = {
    [`packages/harness-manager/src/zz-goal-${id}.ts`]: `export type ${names.row} = { id: string };\n`,
    [`packages/react/src/zz-goal-${id}.ts`]: `export function ${names.item}() {}\n`,
    [`packages/workspace/src/zz-goal-${id}.ts`]: `export type ${names.state} =\n  | "idle"\n  | "done";\n`,
  };
  const planted = guard(copyOf("reaches", plants), ["--list", RULE]);
  const reached = resourceLines(planted.out);
  for (const path of tell.over("reaches: names committed to main", Object.keys(plants))) {
    if (!reached.some((line) => line.startsWith(`${path}:1  `))) failures.push(`reaches: the whole-tree run did not report ${path}, committed to main with no diff to hold it`);
  }
  if (planted.status === 0) failures.push("reaches: the guard passed with the committed names in the tree");
  evidence.push(`reaches: ${reached.length - open.length} committed names reported (${Object.values(names).join(", ")})`);

  // ---- control ----
  const control = guard(tree, ["--control"]);
  const { PLANTS } = await import(`${pathToFileURL(join(tree, GUARD)).href}?${RUN_STAMP}`);
  const ours = (PLANTS as Array<{ path: string; line: string; term: string | null }>).filter((p) => p.term === RULE);
  const packageOf = (path: string) => /^(packages\/[^/]+)\//.exec(path)?.[1];
  const fooRow = ours.filter((p) => /\bFooRow\b/.test(p.line));
  const fooItem = ours.filter((p) => /\buseFooCollectionItem\b/.test(p.line));
  const rowPackages = new Set(fooRow.map((p) => packageOf(p.path)).filter(Boolean));
  if (rowPackages.size < 2) failures.push(`control: the guard plants a FooRow type in ${rowPackages.size} package(s); it must plant one in more than one`);
  if (fooItem.length === 0) failures.push("control: the guard plants no useFooCollectionItem export");
  for (const p of tell.over("control: FooRow and useFooCollectionItem plants", [...fooRow, ...fooItem])) {
    if (!new RegExp(`^plant ${p.path.replace(/[./]/g, "\\$&")}:\\d+ \\(${RULE}(?:, read [\\w-]+)?\\): refused$`, "m").test(control.out)) failures.push(`control: the guard's --control did not refuse ${p.path} (${p.line})`);
  }
  if (control.status !== 0) failures.push(`control: the guard's --control failed\n${control.out.split("\n").filter((l) => /SLIPPED|CONTROL/.test(l)).join("\n")}`);
  evidence.push(`control: FooRow refused in ${[...rowPackages].join(", ")}, useFooCollectionItem in ${fooItem.map((p) => packageOf(p.path)).join(", ")}`);

  // ---- exemptions ----
  const glossary = await import(`${pathToFileURL(join(tree, "docs/contributing/glossary.mjs")).href}?${RUN_STAMP}`);
  const rule = glossary.TREE_RULES?.find((r: { id: string }) => r.id === RULE);
  if (rule === undefined) failures.push(`exemptions: the glossary has no whole-tree rule "${RULE}" (TREE_RULES)`);
  else if ("context" in rule) failures.push("exemptions: the resource matcher still narrows its Row declarations by a context");
  const kept = ((glossary.TREE_EXEMPTIONS ?? []) as Array<Record<string, any>>).filter((e) => (e.rules ?? []).includes(RULE));
  const paths = git(tree, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const SHAPES: Record<string, string> = { "store-adapter-rows": "id,path,rules,why", "ui-list-rows": "id,path,rules,why", "stored-field-names": "fields,id,rules,why", "released-quotes": "id,pages,quotes,rules,why" };
  for (const e of tell.over("exemptions: the resource entry's exemptions", kept)) {
    const shape = Object.keys(e).sort().join(",");
    if (SHAPES[e.id] !== shape) {
      failures.push(`exemptions: "${e.id ?? e.why}" (${shape}) is none of the allowed four: store-adapter and UI-list path rules, D2's stored field names, D4's released quotes`);
      continue;
    }
    if (e.id === "store-adapter-rows" || e.id === "ui-list-rows") {
      const kind = e.id === "store-adapter-rows" ? STORE_ADAPTER : UI_LIST;
      const stray = paths.filter((p) => e.path.test(p) && !kind.test(p));
      if (stray.length > 0) failures.push(`exemptions: "${e.id}" keeps files that are not ${e.id === "store-adapter-rows" ? "a store adapter" : "a UI list module"}: ${stray.slice(0, 5).join(", ")}`);
    }
    if (e.id === "released-quotes") {
      const stray = paths.filter((p) => e.pages.test(p) && !PUBLISHED_PAGE.test(p));
      if (stray.length > 0) failures.push(`exemptions: the released-quote rule reads pages that are not published: ${stray.slice(0, 5).join(", ")}`);
      const quotes = e.quotes as RegExp[];
      if (quotes.length !== RELEASED.length) failures.push(`exemptions: the released-quote rule names ${quotes.length} texts, not the three released messages`);
      for (const text of RELEASED) if (!quotes.some((q) => new RegExp(q.source).test(text))) failures.push(`exemptions: the released-quote rule does not name "${text}"`);
      for (const q of quotes) if (!RELEASED.some((text) => new RegExp(q.source).test(text))) failures.push(`exemptions: the released-quote rule names /${q.source}/, which is no released message`);
    }
  }
  evidence.push(`exemptions: ${kept.map((e) => e.id).join(", ")}`);

  // ---- hold ----
  if (commit !== head) {
    evidence.push("hold: skipped, it runs on this checkout's code only");
    return { failures, evidence: evidence.join("; ") };
  }
  const patches = CONTROLS[CONTROL] ?? [];
  const mark = join(goalTmpDir("a-consumer-meets-one-word"), `patch-mark-${RUN_STAMP}`);
  if (patches.length > 0) console.error(`control ${CONTROL}:\n${describePatches(patches, REPO_ROOT)}`);
  const hold = spawnSync(process.execPath, [...process.execArgv, HOLD_LEG], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(patches.length > 0 ? modulePatchEnv(patches, REPO_ROOT, mark) : {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (patches.length > 0) assertPatched(patches, REPO_ROOT, mark);
  const last = hold.stdout.trim().split("\n").at(-1) ?? "";
  let result: { failures: string[]; evidence: string[] } | undefined;
  try {
    result = JSON.parse(last);
  } catch {
    failures.push(`hold: the leg printed no result (exit ${hold.status})\n${hold.stderr.slice(-800)}`);
  }
  if (result !== undefined) {
    failures.push(...result.failures);
    evidence.push(...tell.over("hold: legs graded", result.evidence));
  }
  return { failures, evidence: evidence.join("; ") };
});

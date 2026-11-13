/**
 * Goal: docs-pages › it fails what the standard forbids.
 *
 * A docs page that runs over its budget, has an unknown type, hides an untitled TypeScript example
 * in a list, or has a record missing a pass, and a figure with a hex or named colour, a `<style>`
 * block or no key, each fails CI naming the rule it broke; a run given no page fails; a clean page
 * with a full record passes. Model-free: real path, no LLM.
 *
 * It copies the files CI's docs steps read into a scratch tree (this checkout's, or another
 * commit's with GOAL_COMMIT), with this checkout's installed dependencies. For each fixture under
 * `fixtures/` it puts the fixture's files into the revamp's pages folder, runs the commands CI runs
 * there, reads their exit code and output, and takes the fixture out again. It never imports the
 * checker or the lint, and never reads their rule tables. The commands:
 *   - `node scripts/check-docs-page.mjs`, CI's "Every docs page" step on main (`:ci` legs);
 *   - `node scripts/check-docs-page.mjs <page>`, what pass 4 of the loop runs (`:named` legs);
 *   - the docs package's `lint:brand` script in `apps/docs`, which CI's "Lint docs brand rules"
 *     step runs through pnpm.
 * The `ci` legs check the tree's own ci.yml runs the first and the last: a check CI never runs
 * stops nothing.
 *
 *   pnpm tsx goals/docs-pages/fail-what-the-standard-forbids/run.mts
 *   GOAL_COMMIT=<sha> …   the same check on that commit's files. `main` before the page checker
 *                         was extended must FAIL the indented fence, no path given, every figure
 *                         leg and the record leg (goal.md → Controls).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { goalTmpDir, REPO_ROOT, runGoal } from "../../lib/index.mts";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const PAGES = "docs/contributing/docs-revamp/pages";
// What CI's docs steps read: the checker, the lint and what each loads, the pages, the sitemap, the
// site's diagrams and stylesheet, and the design system's page.css the lint reads its classes from.
const TREE_PATHS = [
  "scripts",
  ".github/workflows/ci.yml",
  "apps/docs/package.json",
  "apps/docs/scripts",
  "apps/docs/src/css",
  "apps/docs/docs",
  "apps/docs/guides",
  "apps/docs/blog",
  "docs/contributing/docs-revamp",
  "specs/epics",
  "labs/design-system/package.json",
  "labs/design-system/page.css",
];

const commit = process.env.GOAL_COMMIT ?? "";
const scratch = goalTmpDir("docs-pages");
const root = join(scratch, "tree");

/** The scratch tree: this checkout's files, or `commit`'s, resolving dependencies the way this checkout does. */
function scratchTree(): string {
  mkdirSync(root, { recursive: true });
  let describe: string;
  if (commit === "") {
    for (const p of TREE_PATHS) cpSync(join(REPO_ROOT, p), join(root, p), { recursive: true });
    const head = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "--short=9", "HEAD"], { encoding: "utf8" }).trim();
    describe = `this checkout's files at \`${head}\``;
  } else {
    const sha = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", `${commit}^{commit}`], { encoding: "utf8" }).trim();
    const tar = execFileSync("git", ["-C", REPO_ROOT, "archive", "--format=tar", sha, "--", ...TREE_PATHS], { maxBuffer: 512 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", root], { input: tar });
    describe = `\`${sha.slice(0, 9)}\` (GOAL_COMMIT=${commit})`;
  }
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
  cpSync(join(REPO_ROOT, "apps/docs/node_modules"), join(root, "apps/docs/node_modules"), { recursive: true, verbatimSymlinks: true, filter: (src) => !src.includes("/.cache") });
  return describe;
}

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? filesUnder(join(dir, name)).map((f) => join(name, f)) : [name]));
}

/** Run `fn` with fixture `name`'s files in the pages folder, and take them out after. */
function withFixture<T>(name: string, fn: () => T): T {
  const files = filesUnder(join(FIXTURES, name));
  for (const f of files) cpSync(join(FIXTURES, name, f), join(root, PAGES, f));
  try {
    return fn();
  } finally {
    for (const f of files) rmSync(join(root, PAGES, f));
  }
}

type Run = { code: number; out: string };
const sh = (cwd: string, cmd: string, args: string[] = []): Run => {
  const r = spawnSync("sh", ["-c", `${cmd} "$@"`, "sh", ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
};
const checker = (...pages: string[]): Run => sh(root, "node scripts/check-docs-page.mjs", pages);
const lintScript = (): string => JSON.parse(readFileSync(join(root, "apps/docs/package.json"), "utf8")).scripts?.["lint:brand"] ?? "";
const figureLint = (): Run => sh(join(root, "apps/docs"), lintScript());

/** The checker's report as `{ page: problems[] }`, from its `FAIL <page> (…)` / `ok   <page> (…)` lines and the indented problems under each. */
function report(out: string): Map<string, { ok: boolean; problems: string[] }> {
  const pages = new Map<string, { ok: boolean; problems: string[] }>();
  let current: string[] | undefined;
  for (const line of out.split("\n")) {
    const head = /^(FAIL|ok  ) (\S+) \(/.exec(line);
    if (head) {
      current = [];
      pages.set(head[2], { ok: head[1] !== "FAIL", problems: current });
    } else if (/^ {5}\S/.test(line) && current) current.push(line.trim());
  }
  return pages;
}

const quote = (r: Run) => r.out.trim().split("\n").slice(0, 8).join(" | ");

await runGoal((failures, tell) => {
  const tree = scratchTree();
  try {
    // ci: CI runs both commands, so what fails here fails a PR.
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    if (!/^\s+run: node scripts\/check-docs-page\.mjs\s*$/m.test(ci)) failures.push("ci:checker: ci.yml has no step that runs `node scripts/check-docs-page.mjs` over every page");
    if (!/^\s+run: pnpm --filter @flow-state-dev\/docs lint:brand\s*$/m.test(ci)) failures.push("ci:figure-lint: ci.yml has no step that runs the docs package's lint:brand");
    if (!/^node scripts\/lint-brand\.mjs$/.test(lintScript())) failures.push(`ci:figure-lint: the docs package's lint:brand is "${lintScript()}", not node scripts/lint-brand.mjs`);

    // Each bad page fails CI's run and pass 4's, naming its page and only its rule.
    const pageCases: { leg: string; fixture: string; rule: RegExp }[] = [
      { leg: "over-budget", fixture: "over-budget", rule: /^\d+ words, budget 1500$/ },
      { leg: "over-budget (a recipe)", fixture: "over-budget-recipe", rule: /^\d+ words, budget 800$/ },
      { leg: "unknown-type", fixture: "unknown-type", rule: /^unknown `type` "guide"$/ },
      { leg: "indented-fence", fixture: "indented-fence", rule: /^1 ts code block\(s\) with no title="path"$/ },
      { leg: "record-missing-pass", fixture: "record-missing-pass", rule: /^record: no pass 9$/ },
    ];
    tell.over("page fixtures", pageCases.filter((c) => existsSync(join(FIXTURES, c.fixture))));
    for (const c of pageCases) {
      const page = `${PAGES}/${filesUnder(join(FIXTURES, c.fixture)).find((f) => /^goal-[\w-]+\.md$/.test(f) && !/\.(record|facts)\.md$/.test(f))}`;
      withFixture(c.fixture, () => {
        const runs: [string, Run][] = [["ci", checker()]];
        // Pass 4 reads the page rules only; the record is CI's to read.
        if (c.fixture !== "record-missing-pass") runs.push(["named", checker(page)]);
        for (const [how, run] of runs) {
          const seen = report(run.out);
          const mine = seen.get(page);
          const others = [...seen].filter(([p, r]) => p !== page && !r.ok).map(([p]) => p);
          if (run.code !== 1) failures.push(`${c.leg}:${how}: exited ${run.code}, not 1 · ${quote(run)}`);
          else if (!mine || mine.ok) failures.push(`${c.leg}:${how}: ${page} is not reported failing · ${quote(run)}`);
          else if (mine.problems.length !== 1 || !c.rule.test(mine.problems[0])) failures.push(`${c.leg}:${how}: ${page} fails with ${JSON.stringify(mine.problems)}, not its one rule ${c.rule}`);
          if (others.length) failures.push(`${c.leg}:${how}: pages the fixture did not add fail too: ${others.join(", ")}`);
        }
      });
    }

    // no-path-given: a run with no page to read fails, rather than passing having read nothing.
    const aside = join(scratch, "pages-aside");
    renameSync(join(root, PAGES), aside);
    mkdirSync(join(root, PAGES));
    try {
      const empty = checker();
      if (empty.code !== 1) failures.push(`no-path-given: with no page under ${PAGES}, the checker exited ${empty.code}, not 1 · ${quote(empty)}`);
      else if (!/no page/i.test(empty.out)) failures.push(`no-path-given: it failed without saying it found no page · ${quote(empty)}`);
    } finally {
      rmSync(join(root, PAGES), { recursive: true });
      renameSync(aside, join(root, PAGES));
    }

    // Each bad figure fails the lint, a finding on its file naming its rule.
    const figureCases: { leg: string; fixture: string; rule: string; detail: RegExp }[] = [
      { leg: "hex-colour", fixture: "hex-colour", rule: "colour", detail: /#ff0000/ },
      { leg: "colour-name", fixture: "colour-name", rule: "colour", detail: /\bred\b/ },
      { leg: "style-block", fixture: "style-block", rule: "svg", detail: /<style>/ },
      { leg: "no-key", fixture: "no-key", rule: "key", detail: /0 key elements/ },
    ];
    tell.over("figure fixtures", figureCases.filter((c) => existsSync(join(FIXTURES, c.fixture))));
    for (const c of figureCases) {
      const file = filesUnder(join(FIXTURES, c.fixture))[0];
      withFixture(c.fixture, () => {
        const run = figureLint();
        const findings = run.out.split("\n").filter((l) => l.includes(`${PAGES}/${file}:`));
        if (run.code !== 1) failures.push(`${c.leg}: the figure lint exited ${run.code}, not 1 · ${quote(run)}`);
        else if (!findings.some((l) => new RegExp(`:\\d+ ${c.rule}: `).test(l) && c.detail.test(l))) {
          failures.push(`${c.leg}: no ${c.rule} finding on ${file} matching ${c.detail}; findings on it: ${JSON.stringify(findings)} · ${quote(run)}`);
        }
      });
    }

    // clean: a page with a full record and a clean figure passes both.
    const cleanPage = `${PAGES}/goal-clean.md`;
    withFixture("clean", () => {
      const run = checker();
      const seen = report(run.out);
      if (run.code !== 0) failures.push(`clean:checker: exited ${run.code} · ${quote(run)}`);
      if (!seen.get(cleanPage)?.ok) failures.push(`clean:checker: ${cleanPage} is not reported ok · ${quote(run)}`);
      const lint = figureLint();
      if (lint.code !== 0) failures.push(`clean:figure-lint: exited ${lint.code} · ${quote(lint)}`);
    });

    return {
      failures,
      evidence: `on ${tree}: CI runs the checker and the figure lint; ${pageCases.length} bad pages each fail CI's run (and pass 4's) on their one rule, a run with no page fails, ${figureCases.length} bad figures each fail the lint on their rule, and the clean page with its record and figure passes both`,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

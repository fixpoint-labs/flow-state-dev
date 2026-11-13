/**
 * Goal: docs-for-agents › it serves every page as Markdown.
 *
 * Every docs page the site builds has a clean Markdown twin at its URL plus `.md`, and
 * `llms.txt` lists it. Model-free: real path, no LLM.
 *
 * In a scratch `git worktree` of the commit under test (sharing this checkout's installed
 * dependencies), it adds one held-out page (a figure, a table, an admonition and a code tab),
 * runs the production site build, then walks the built HTML. A docs page is an HTML file whose
 * body holds a rendered Markdown article (`theme-doc-markdown`); its URL is its canonical link.
 * For each one it reads the file that URL plus `.md` maps to under the build, and grades:
 *   - markdown-exists: the file is there.
 *   - no-jsx: outside code, it has no component tag, import, export or `{…}` expression.
 *   - prose-matches: its words match the HTML article's text to within 2% (a drawing counts as
 *     its description, the text a reader without it gets).
 *   - listed: `llms.txt` links that file.
 *   - held-out-passes: the added page is among the pages graded, and passes all four.
 * Nothing it does touches this checkout's files.
 *
 *   pnpm tsx goals/docs-for-agents/serves-every-page-as-markdown/run.mts
 *   GOAL_CONTROL=main …   the same check on origin/main (GOAL_BASE names another ref), which
 *                         serves no Markdown: must FAIL markdown-exists on 100% of pages.
 *   GOAL_CONTROL=tampered … the commit under test, with three pages' output spoiled after the
 *                         build (a component appended, half the text cut, the entry dropped
 *                         from llms.txt): must FAIL no-jsx, prose-matches and listed, each on
 *                         exactly its one page.
 *
 * The commit under test is HEAD: commit before running it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { workspaceManifests } from "../../../scripts/workspace-members.mjs";
import { fixturePath, goalTmpDir, REPO_ROOT, runGoal } from "../../lib/index.mts";
import { article, drift, htmlText, jsxLeft, markdownPathOf, markdownText, words } from "./grade.mts";

const control = process.env.GOAL_CONTROL ?? "";
if (!["", "main", "tampered"].includes(control)) throw new Error(`unknown GOAL_CONTROL "${control}"; this goal knows "main" and "tampered"`);
const ref = control === "main" ? (process.env.GOAL_BASE ?? "origin/main") : "HEAD";

const scratch = goalTmpDir("docs-for-agents");
const tree = join(scratch, "tree");
const site = join(scratch, "site");
const HELD_OUT_URL = "/docs/goal-held-out/held-out";
const TOLERANCE = 0.02;

/** A scratch tree of `ref` that resolves dependencies the way this checkout does. */
function scratchTree(): void {
  execFileSync("git", ["worktree", "add", "--detach", tree, ref], { cwd: REPO_ROOT, stdio: "ignore" });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(tree, "node_modules"));
  for (const folder of workspaceManifests(REPO_ROOT).map(dirname)) {
    const from = join(REPO_ROOT, folder, "node_modules");
    if (!existsSync(from) || !existsSync(join(tree, folder))) continue;
    cpSync(from, join(tree, folder, "node_modules"), {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !src.startsWith(join(from, ".cache")),
    });
  }
  const pageDir = join(tree, "apps", "docs", "docs", "goal-held-out");
  execFileSync("mkdir", ["-p", pageDir]);
  for (const name of ["held-out.mdx", "held-out.svg"]) copyFileSync(fixturePath(import.meta.url, name), join(pageDir, name));
}

function buildSite(): { code: number; log: string } {
  rmSync(site, { recursive: true, force: true });
  const run = spawnSync("pnpm", ["exec", "docusaurus", "build", "--out-dir", site], {
    cwd: join(tree, "apps", "docs"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const log = join(scratch, "build.log");
  writeFileSync(log, `${run.stdout}\n${run.stderr}`);
  return { code: run.status ?? 1, log };
}

function htmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith(".html") ? [path] : [];
  });
}

/** Spoil three pages' output, so each assertion has one page it must fail on. */
function tamper(pages: string[]): string[] {
  const file = (url: string) => join(site, markdownPathOf(url).slice(1));
  const candidates = pages.filter((p) => p !== HELD_OUT_URL);
  // Cutting a page with code could leave a fence open and leak into no-jsx; pick one without.
  const prose = candidates.find((p) => !readFileSync(file(p), "utf8").includes("```"));
  const [jsx, unlisted] = candidates.filter((p) => p !== prose);
  if (prose === undefined) throw new Error("tampered: no page without code to cut");
  writeFileSync(file(jsx), `${readFileSync(file(jsx), "utf8")}\n<Figure svg={X} caption="c" description="d" />\n`);
  const text = readFileSync(file(prose), "utf8");
  writeFileSync(file(prose), text.slice(0, Math.floor(text.length / 2)));
  const index = join(site, "llms.txt");
  const link = markdownPathOf(unlisted);
  writeFileSync(index, readFileSync(index, "utf8").split("\n").filter((l) => !l.includes(`${link})`)).join("\n"));
  return [jsx, prose, unlisted];
}

await runGoal((failures, tell) => {
  scratchTree();
  try {
    const built = buildSite();
    if (built.code !== 0) {
      failures.push(`site-builds: the build exited ${built.code}; its output is ${built.log}`);
      return { failures, evidence: "" };
    }
    const all = tell.over("built HTML files", htmlFiles(site));
    const pages: { url: string; html: string }[] = [];
    for (const file of all) {
      const html = readFileSync(file, "utf8");
      const body = article(html);
      if (body === undefined) continue;
      const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(html)?.[1];
      if (canonical === undefined) {
        failures.push(`page-url: ${relative(site, file)} has a docs article but no canonical link`);
        continue;
      }
      pages.push({ url: new URL(canonical).pathname, html: body });
    }
    tell.over("docs pages (HTML files with a docs article)", pages);
    const tampered = control === "tampered" ? tamper(pages.map((p) => p.url)) : [];

    const index = existsSync(join(site, "llms.txt")) ? readFileSync(join(site, "llms.txt"), "utf8") : "";
    const listed = new Set([...index.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => new URL(m[1]).pathname));

    const failed = { "markdown-exists": [] as string[], "no-jsx": [] as string[], "prose-matches": [] as string[], listed: [] as string[] };
    let worst = 0;
    for (const { url, html } of pages) {
      const path = markdownPathOf(url);
      const file = join(site, path.slice(1));
      if (!existsSync(file)) {
        failed["markdown-exists"].push(url);
        continue;
      }
      const markdown = readFileSync(file, "utf8");
      const leak = jsxLeft(markdown);
      if (leak !== undefined) failed["no-jsx"].push(`${url} (${JSON.stringify(leak)})`);
      const d = drift(words(markdownText(markdown)), words(htmlText(html)));
      worst = Math.max(worst, d);
      if (d > TOLERANCE) failed["prose-matches"].push(`${url} (${(d * 100).toFixed(1)}%)`);
      if (!listed.has(path)) failed.listed.push(url);
    }

    const n = pages.length;
    for (const [name, urls] of Object.entries(failed)) {
      if (urls.length === 0) continue;
      const pct = ((urls.length / n) * 100).toFixed(0);
      failures.push(`${name}: ${urls.length} of ${n} pages (${pct}%) fail, e.g. ${urls.slice(0, 5).join(", ")}`);
    }
    const heldOut = pages.some((p) => p.url === HELD_OUT_URL);
    const heldOutFailed = Object.entries(failed).filter(([, urls]) => urls.some((u) => u.split(" ")[0] === HELD_OUT_URL));
    if (!heldOut) failures.push(`held-out-passes: the added page ${HELD_OUT_URL} is not among the docs pages built`);
    else if (heldOutFailed.length > 0) failures.push(`held-out-passes: the added page fails ${heldOutFailed.map(([k]) => k).join(", ")}`);
    if (tampered.length > 0) failures.push(`(control tampered: ${tampered.join(", ")})`);

    return {
      failures,
      evidence:
        `${ref}: ${n} docs pages of ${all.length} HTML files each have a Markdown twin with no JSX, listed in llms.txt; ` +
        `worst prose drift ${(worst * 100).toFixed(2)}% (limit ${TOLERANCE * 100}%); the held-out page (figure, table, admonition, code tabs) passes`,
    };
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", tree], { cwd: REPO_ROOT, stdio: "ignore" });
  }
});

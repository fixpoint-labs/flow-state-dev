/**
 * Goal: api-reference › it follows the doc comment.
 *
 * A changed doc comment on a published export changes the built API reference, with no page
 * edited by hand. Model-free: real path, no LLM.
 *
 * In a scratch copy of the tree (a detached `git worktree` of the commit under test, sharing
 * this checkout's installed dependencies), it:
 *   a. adds a marker sentence to the doc comment of one root export in each of the 27
 *      sections, runs the site build the way CI's reference build does
 *      (`FSD_API_REFERENCE=1 docusaurus build`, which builds the packages' types itself),
 *      and reads each section's built root page, as HTML, for its marker;
 *   b. deletes one package's published entry declaration and runs the build again: it must
 *      fail, and its output must name that package.
 * Nothing it does touches this checkout's files.
 *
 *   pnpm tsx goals/api-reference/follows-the-doc-comment/run.mts
 *   GOAL_CONTROL=main pnpm tsx goals/api-reference/follows-the-doc-comment/run.mts
 *     the same check against `origin/main` (GOAL_BASE to name another ref), which has no
 *     generator: it must FAIL leg a's `carries-the-edited-sentence` on 27 of 27, and leg b's
 *     `fails-naming-the-package`.
 *
 * The commit under test is HEAD: commit before running it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goalTmpDir, loadFixture, REPO_ROOT, RUN_STAMP, runGoal } from "../../lib/index.mts";

interface Marked {
  slug: string;
  file: string;
  name: string;
  kind: "function" | "interface" | "type";
}
const fixture = loadFixture<{ exports: Marked[]; unreadable: { slug: string; name: string; remove: string } }>(
  import.meta.url,
  "markers.json",
);

const control = process.env.GOAL_CONTROL ?? "";
if (control !== "" && control !== "main") throw new Error(`unknown GOAL_CONTROL "${control}"; this goal knows "main"`);
const ref = control === "main" ? (process.env.GOAL_BASE ?? "origin/main") : "HEAD";

const scratch = goalTmpDir("api-reference");
const tree = join(scratch, "tree");
const site = join(scratch, "site");
const markerOf = (slug: string) => `Reference marker ${slug} ${RUN_STAMP.replace("_", "")} reads through.`;

/** A scratch tree of `ref` that resolves dependencies the way this checkout does. */
function scratchTree(): void {
  execFileSync("git", ["worktree", "add", "--detach", tree, ref], { cwd: REPO_ROOT, stdio: "ignore" });
  // The store and root links are shared; each workspace folder's own links are copied, so a
  // workspace dependency (`../../core`) resolves inside the scratch tree, not here.
  symlinkSync(join(REPO_ROOT, "node_modules"), join(tree, "node_modules"));
  for (const parent of ["packages", "apps"]) {
    for (const name of readdirSync(join(REPO_ROOT, parent))) {
      const from = join(REPO_ROOT, parent, name, "node_modules");
      if (!existsSync(from) || !existsSync(join(tree, parent, name))) continue;
      cpSync(from, join(tree, parent, name, "node_modules"), {
        recursive: true,
        verbatimSymlinks: true,
        filter: (src) => !src.includes(`${join(parent, name, "node_modules", ".cache")}`),
      });
    }
  }
}

/** Adds the marker as the first sentence of the doc comment directly above `name`'s declaration. */
function mark({ file, name, kind, slug }: Marked): string | undefined {
  const path = join(tree, file);
  if (!existsSync(path)) return `${slug}: ${file} is not in ${ref}`;
  const text = readFileSync(path, "utf8");
  const keyword = kind === "function" ? "(?:async\\s+)?function\\*?" : kind;
  const decl = new RegExp(`(/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/)(\\s*export\\s+(?:declare\\s+)?${keyword}\\s+${name}\\b)`);
  const m = decl.exec(text);
  if (!m) return `${slug}: no doc comment directly above \`export ${kind} ${name}\` in ${file}`;
  const comment = `/**\n * ${markerOf(slug)}\n *${m[1].slice(3)}`;
  writeFileSync(path, text.slice(0, m.index) + comment + m[2] + text.slice(m.index + m[0].length));
  return undefined;
}

/** Runs the site build in the scratch tree; returns its exit code and combined output. */
function buildSite(env: Record<string, string>): { code: number; output: string } {
  rmSync(site, { recursive: true, force: true });
  const run = spawnSync("pnpm", ["exec", "docusaurus", "build", "--out-dir", site], {
    cwd: join(tree, "apps", "docs"),
    env: { ...process.env, FSD_API_REFERENCE: "1", ...env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { code: run.status ?? 1, output: `${run.stdout}\n${run.stderr}` };
}

/** Every HTML file under `dir`. */
function htmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? htmlFiles(path) : name.endsWith(".html") ? [path] : [];
  });
}

/** The text a reader sees on a built page: tags, scripts and styles removed, entities decoded. */
function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

await runGoal((failures, tell) => {
  scratchTree();
  try {
    // Leg a: every section's built root page carries the sentence added to its comment.
    const setup = fixture.exports.map(mark).filter((e): e is string => e !== undefined);
    if (setup.length > 0) return { failures: setup.map((e) => `setup: ${e}`), evidence: "" };

    const a = buildSite({});
    if (a.code !== 0) failures.push(`a · site-builds: the build exited ${a.code}: ${a.output.trim().split("\n").slice(-12).join(" | ")}`);
    tell.over("a · built site HTML pages", htmlFiles(site));
    let carried = 0;
    for (const { slug, name } of fixture.exports) {
      const page = join(site, "docs", "reference", "api", slug, "index.html");
      if (!existsSync(page)) {
        failures.push(`a · carries-the-edited-sentence · ${slug}: no built page at docs/reference/api/${slug}/`);
        continue;
      }
      if (pageText(readFileSync(page, "utf8")).includes(markerOf(slug))) carried++;
      else failures.push(`a · carries-the-edited-sentence · ${slug}: the page does not carry the sentence added to ${name}'s comment`);
    }

    // Leg b: a package that can't be read fails the build, by name. Types are not rebuilt,
    // so the deleted declaration stays deleted.
    rmSync(join(tree, fixture.unreadable.remove), { force: true });
    const b = buildSite({ FSD_API_REFERENCE_SKIP_TYPES: "1" });
    tell.over("b · build output lines", b.output.split("\n").filter((l) => l.trim() !== ""));
    if (b.code === 0) failures.push(`b · fails-naming-the-package: the build passed with ${fixture.unreadable.remove} deleted`);
    else if (!b.output.includes(`cannot read ${fixture.unreadable.name}`)) {
      failures.push(`b · fails-naming-the-package: the build failed without naming ${fixture.unreadable.name}`);
    }

    return {
      failures,
      evidence:
        `${ref}: ${carried} of ${fixture.exports.length} sections' built root pages carry their comment's marker ` +
        `(${fixture.exports.filter((e) => e.kind !== "function").map((e) => `${e.slug} · ${e.name}`).join(", ")} are types); ` +
        `with ${fixture.unreadable.remove} deleted the build exits ${b.code} naming ${fixture.unreadable.name}`,
    };
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", tree], { cwd: REPO_ROOT, stdio: "ignore" });
  }
});

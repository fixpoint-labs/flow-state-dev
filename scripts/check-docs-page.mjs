/**
 * Mechanical checks for docs-revamp pages, and the check that each page went through every pass
 * of the writing loop.
 *
 * Page rules: prose word count against the budget for the page's `type`, the words the writing
 * standard bans, em-dashes, long tables, and TypeScript examples that do not name their file,
 * fenced at any indent (an example inside a list item counts). Code blocks and figures are not
 * capped: a concept page shows its idea in as many short examples and figures as it needs (the
 * brief's concept/reference contract). Frontmatter, code blocks, MDX imports and figures (a
 * `<Figure … />` line, with its caption and description) are not counted as words. A fence is
 * read as CommonMark reads it (backticks or tildes, closed by the same character at the opener's
 * length or longer), and a page that ends inside one fails.
 *
 * Record rules: every page has a `<page>.record.md` beside it, next to its `<page>.facts.md`.
 * The record names the page's sitemap entry and has one section per pass, plus the rows the depth
 * pass moved to Reference:
 *
 *   Sitemap: C-07
 *
 *   ## 1 · Fact sheet            ## 6 · Depth pass
 *   ## 2 · Cold-read questions   ## 7 · docs-editor
 *   ## 3 · Draft                 ## 8 · Revise
 *   ## 4 · Machine checks        ## 9 · Cold read
 *   ## 5 · Fact check            ## 10 · Owner read
 *   ## Reference rows
 *
 * A section is matched by its number; its body may not be empty. Pass 3's body may start with
 * `Skipped` (and say why) only on a page the sitemap lists as kept, piloted or drafted, and whose
 * `title` is that entry's title. Kept means a source verdict of *Keep* or *Keep, trim* (an audit
 * note after a `;` is allowed), with every other source moved off the page (`to …`); a source with
 * no verdict is not moved off. Pass 10's body starts with `Read` or `Not sampled`. No other pass
 * may start with `Skipped` or `Not sampled`. `Reference rows` may say `None.`
 *
 * A page edited by a change needs a new pass 4 and pass 5 entry in that change (`--changed-since`).
 * A record or fact sheet whose page is gone fails.
 *
 *   node scripts/check-docs-page.mjs                    every page under the default root, with
 *                                                       its record. What CI runs on main
 *   node scripts/check-docs-page.mjs --changed-since <ref>   the pages a change touched (a record
 *                                                       or fact sheet names its page), with their
 *                                                       records. What CI runs on a PR
 *   node scripts/check-docs-page.mjs <page.md> [...]    the page rules for the pages named: pass 4
 *                                                       runs this before passes 5 to 10 exist.
 *                                                       `--record` checks their records too
 *   node scripts/check-docs-page.mjs --sitemap          the sitemap as the skipped-draft rule reads
 *                                                       it: the kept, piloted and drafted ids. A
 *                                                       line naming an entry in a shape the parse
 *                                                       cannot read fails it
 *   --root <dir>   the repository the default paths resolve against (default: this one)
 *
 * Exits 1 when any page fails, and when it is given no page to check: a default root with no page
 * in it, or a named file that is not a page. `--changed-since` with no changed page prints that
 * and exits 0; a change to this script or to the sitemap checks every page.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Moves to apps/docs/{docs,guides} at cutover (FIX-2705).
const PAGES = "docs/contributing/docs-revamp/pages";
const SITEMAP = "specs/epics/FIX-2696/SITEMAP";
// Written before the record existed; FIX-2701 brings it to the loop and drops it from here.
const PREDATES_RECORD = new Set([`${PAGES}/blocks.md`]);

const BUDGET = { start: 800, concept: 1500, catalog: 1500, tutorial: 2500, recipe: 800 };
const BANNED = [
  "now", "no longer", "still", "anymore", "deliberate", "deliberately", "simply", "just",
  "powerful", "seamless", "frictionless", "robust", "first-class", "load-bearing", "by construction",
];
const PASSES = 10;
const SIDECAR = /\.(record|facts)\.md$/;

/**
 * A page's fenced code blocks, as CommonMark reads them: a fence closes only on a line of the
 * opener's character (backtick or tilde) at least as long. Returns the page without its fenced
 * lines, each opening fence line, and the one left open at the end of the page, if any.
 */
function fencesOf(raw) {
  const kept = [];
  const openers = [];
  let open = null;
  raw.split("\n").forEach((line, i) => {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/);
    if (!open) {
      if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
        open = { marker: fence[1], line: i + 1, text: fence[1] + (fence[2].trim().split(/\s/)[0] ?? "") };
        openers.push(line);
      } else kept.push(line);
    } else if (fence && fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length && !fence[2].trim()) {
      open = null;
    }
  });
  return { rest: kept.join("\n"), openers, unclosed: open };
}

/** The page rules over one page's text; returns its type, word count and problems. */
function pageProblems(raw) {
  const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const type = front?.[1].match(/^type:\s*["']?([\w-]+)["']?\s*$/m)?.[1];
  const title = front?.[1].match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1];
  // Frontmatter becomes blank lines, so a fence's line number is the page's.
  const { rest, openers, unclosed } = fencesOf(raw.replace(/^---\n[\s\S]*?\n---\n/, (m) => "\n".repeat(m.split("\n").length - 1)));
  const prose = rest
    .replace(/^\*.*Description for the site's `?Figure`?:.*\*$/gm, "")
    .replace(/^<Figure\b.*\/>$/gm, "")
    .replace(/^import .* from "[^"]+";$/gm, "");
  const words = prose.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  const problems = [];
  if (!type) problems.push("no `type` in frontmatter");
  else if (type !== "reference" && !BUDGET[type]) problems.push(`unknown \`type\` "${type}"`);
  else if (BUDGET[type] && words > BUDGET[type]) problems.push(`${words} words, budget ${BUDGET[type]}`);
  const untitled = openers.filter((f) => /^[ \t]*(`{3,}|~{3,})tsx?\b(?![^\n]*title=)/.test(f)).length;
  if (untitled) problems.push(`${untitled} ts code block(s) with no title="path"`);
  if (unclosed) problems.push(`a ${unclosed.text} fence opened on line ${unclosed.line} is never closed`);
  const text = prose.replace(/`[^`]*`/g, "");
  for (const word of BANNED) {
    const hits = text.match(new RegExp(`\\b${word}\\b`, "gi"));
    if (hits) problems.push(`"${word}" ×${hits.length}`);
  }
  const dashes = (text.match(/—/g) ?? []).length;
  if (dashes > 2) problems.push(`${dashes} em-dashes (limit 2)`);
  for (const table of prose.match(/(^\|.*\|\n)+/gm) ?? []) {
    const count = table.trim().split("\n").length - 2;
    if (type !== "reference" && count > 6) problems.push(`a table with ${count} body lines (limit 6)`);
  }
  return { type, title, words, problems };
}

/** A sitemap verdict as the record check reads it: lower case, `Keep; trim` as `keep, trim`, an audit note after `;` dropped. */
function verdict(text) {
  const v = text.trim().toLowerCase().replace(/^keep[;,]\s*trim\b/, "keep, trim");
  return v.startsWith("keep, trim") ? "keep, trim" : v.split(";")[0].trim();
}

/** Kept: one source the audit kept as it is, and every other source moved off the page. */
function isKept(verdicts) {
  const kept = verdicts.map(verdict).filter((v) => v === "keep" || v === "keep, trim");
  return kept.length > 0 && verdicts.map(verdict).every((v) => v === "keep" || v === "keep, trim" || v.startsWith("to "));
}

const sitemapCache = new Map();
/**
 * Every sitemap entry by id: its title and whether it is kept, piloted or drafted. Read once per
 * sitemap directory, on the first skipped draft. Throws on a line that names an entry in a shape
 * this parse does not read, so a reworded entry cannot quietly change what a skip may claim.
 */
function sitemap(dir) {
  if (sitemapCache.has(dir)) return sitemapCache.get(dir);
  const entries = new Map();
  const unread = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
  if (!files.length) throw new Error(`no sitemap section files in ${dir}`);
  const ID = String.raw`([SCKBR]-\d{1,2})`;
  for (const file of files) {
    const lines = readFileSync(join(dir, file), "utf8").split("\n");
    let header = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A row of a table whose last column is the audit's source verdict.
      if (/^\|/.test(line) && /^\|[\s|:-]+\|$/.test(lines[i + 1] ?? "")) header = line.split("|").map((c) => c.trim());
      const row = line.match(new RegExp(`^\\|\\s*${ID}\\s*\\|`));
      if (row && header[1] === "Id" && header.at(-2) === "Source verdict") {
        const cells = line.split("|").map((c) => c.trim());
        entries.set(row[1], { title: cells[2], status: isKept([cells.at(-2)]) ? "kept" : null });
        continue;
      }
      // A heading entry (`### C-02 · Blocks`), or a one-paragraph one (`**B-13 · Title** · …`).
      const head = line.match(new RegExp(`^### ${ID} · (.+)$`)) ?? line.match(new RegExp(`^\\*\\*${ID} · (.+?)\\*\\*`));
      if (!head) {
        // Any other line that opens on an id, bar a heading over a range of table rows (`### K-20 to K-27 · …`).
        const named = new RegExp(`^(#{1,6} |\\*\\*|\\|\\s*)${ID}\\b`).test(line);
        if (named && !new RegExp(`^### ${ID} to ${ID} · `).test(line)) unread.push(`${file}:${i + 1}: an entry the sitemap parse cannot read: ${line}`);
        continue;
      }
      let end = i + 1;
      const stop = line.startsWith("###") ? /^(#{1,3} |---$)/ : /^(\s*$|#{1,3} |\*\*[SCKBR]-\d)/;
      while (end < lines.length && !stop.test(lines[end])) end++;
      const body = lines.slice(i, end).join("\n");
      const slugLine = line.startsWith("###") ? (lines.slice(i + 1, end).find((l) => l.trim()) ?? "") : line;
      // The sources run to the next label (`From: …`); a `·` separates them, and each source's
      // verdict is its last parenthesis. A source with none has no verdict, and is not moved off.
      const sources = (body.match(/Sources?[.:]\**\s*(.*)/)?.[1] ?? "").split(/\.\s+(?=[A-Z][\w ]*:)/)[0];
      const verdicts = sources ? sources.split(" · ").map((s) => [...s.matchAll(/\(([^()]*)\)/g)].at(-1)?.[1] ?? "") : [];
      const status = /· piloted\b/.test(slugLine) ? "piloted"
        : /· drafted\b/.test(slugLine) ? "drafted"
        : isKept(verdicts) ? "kept" : null;
      entries.set(head[1], { title: head[2].trim(), status });
    }
  }
  if (unread.length) throw new Error(unread.join("\n"));
  sitemapCache.set(dir, entries);
  return entries;
}

/** A record's sections, by pass number (or heading), each to its trimmed body. */
function sectionsOf(raw) {
  const sections = new Map();
  for (const part of raw.split(/^## /m).slice(1)) {
    const [heading, ...rest] = part.split("\n");
    sections.set(heading.match(/^(\d+)\s*·/)?.[1] ?? heading.trim(), rest.join("\n").trim());
  }
  return sections;
}

/**
 * The record rules for one page; returns its problems. `before` is the record as the change's
 * base had it, given when the change edited the page itself: passes 4 and 5 must then be new.
 */
function recordProblems(pagePath, title, before) {
  const path = pagePath.replace(/\.md$/, ".record.md");
  if (!existsSync(path)) return [`no record: ${basename(path)} beside the page`];
  const raw = readFileSync(path, "utf8");
  const problems = [];
  const sections = sectionsOf(raw);
  if (before) {
    const old = sectionsOf(before);
    for (const n of ["4", "5"]) {
      if (sections.get(n) && sections.get(n) === old.get(n)) problems.push(`record: the page changed and pass ${n} did not; run it again on the edited page`);
    }
  }
  for (let n = 1; n <= PASSES; n++) {
    if (!sections.has(String(n))) problems.push(`record: no pass ${n}`);
    else if (!sections.get(String(n))) problems.push(`record: pass ${n} is empty`);
    // A pass that did not run may say so only where the loop allows it: the draft, and the owner read.
    else if (n !== 3 && /^Skipped\b/.test(sections.get(String(n)))) problems.push(`record: pass ${n} is marked skipped; only pass 3 may be`);
    else if (n !== PASSES && /^Not sampled\b/.test(sections.get(String(n)))) problems.push(`record: pass ${n} says \`Not sampled\`; only pass ${PASSES} may`);
  }
  if (!sections.has("Reference rows")) problems.push("record: no `Reference rows` section");
  const owner = sections.get(String(PASSES));
  if (owner && !/^(Read|Not sampled)\b/.test(owner)) problems.push(`record: pass ${PASSES} says neither \`Read\` nor \`Not sampled\``);
  if (/^Skipped\b/.test(sections.get("3") ?? "")) {
    const id = raw.match(/^Sitemap:\s*(\S+)\s*$/m)?.[1];
    const entry = id && sitemap(join(ROOT, SITEMAP)).get(id);
    if (!id) problems.push("record: pass 3 skipped, and no `Sitemap: <id>` line to say why it may be");
    else if (!entry) problems.push(`record: pass 3 skipped, and the sitemap has no entry ${id}`);
    else if (!entry.status) problems.push(`record: pass 3 skipped, and the sitemap lists ${id} as neither kept, piloted nor drafted`);
    else if (entry.title.toLowerCase() !== (title ?? "").toLowerCase()) problems.push(`record: pass 3 skipped for ${id} "${entry.title}", and the page's title is "${title ?? ""}"`);
  }
  return problems;
}

/** Every page under `dir`: Markdown that is not a record or a fact sheet. */
function pagesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md") && !SIDECAR.test(f))
    .map((f) => join(dir, f))
    .sort();
}

/** The records and fact sheets among `paths` (absolute) that are on disk and whose page is not. */
function orphansOf(paths) {
  return paths.filter((f) => SIDECAR.test(f) && existsSync(f) && !existsSync(f.replace(SIDECAR, ".md"))).sort();
}

/** Every record and fact sheet under `dir`. */
function sidecarsUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map(String).filter((f) => SIDECAR.test(f)).map((f) => join(dir, f));
}

/**
 * The pages a change since `ref` touched: a page, its record or its fact sheet, deleted ones
 * included, so a page whose record went is checked. A change to this script or to the sitemap can
 * break a record it never touched, so it checks every page. A page the change edited carries the
 * record its base had (none for a page new to the loop). `orphans` are the records and fact sheets
 * in the change whose page is gone. A git failure other than the base having no record throws.
 */
function changedSince(ref) {
  // LC_ALL=C keeps git's messages in English, so the stderr match below holds in any locale.
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } });
  const script = relative(ROOT, fileURLToPath(import.meta.url));
  const paths = script.startsWith("..") ? [PAGES, SITEMAP] : [PAGES, SITEMAP, script];
  const changed = git("diff", "--name-only", "--no-renames", ref, "HEAD", "--", ...paths).split("\n").filter(Boolean);
  const inPages = changed.filter((f) => f.startsWith(`${PAGES}/`) && f.endsWith(".md"));
  const named = inPages.map((f) => join(ROOT, f.replace(SIDECAR, ".md")));
  const all = changed.some((f) => !f.startsWith(`${PAGES}/`)) ? pagesUnder(join(ROOT, PAGES)) : [];
  const files = [...new Set([...all, ...named])].filter(existsSync).sort();
  const sidecars = named.flatMap((p) => [".record.md", ".facts.md"].map((ext) => p.replace(/\.md$/, ext)));
  const orphans = orphansOf(all.length ? sidecarsUnder(join(ROOT, PAGES)) : sidecars);
  const before = new Map();
  for (const rel of inPages.filter((f) => !SIDECAR.test(f))) {
    const at = `${ref}:${rel.replace(/\.md$/, ".record.md")}`;
    try {
      before.set(join(ROOT, rel), git("show", at));
    } catch (err) {
      // The base had no record: the page is new to the loop, and nothing in it is stale.
      if (err.status === 128 && /does not exist|exists on disk, but not in/.test(String(err.stderr))) continue;
      throw new Error(`git show ${at} failed: ${String(err.stderr ?? err.message).trim()}`);
    }
  }
  return { files, before, orphans };
}

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  if (!value) throw new Error(`${name} needs a value`);
  return value;
};
const ROOT = resolve(flag("--root") ?? fileURLToPath(new URL("..", import.meta.url)));
const record = args.includes("--record") && args.splice(args.indexOf("--record"), 1).length > 0;
const since = flag("--changed-since");
if (args.includes("--sitemap")) {
  const entries = [...sitemap(join(ROOT, SITEMAP))].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const ids = (status) => entries.filter(([, e]) => e.status === status).map(([id]) => id);
  const [kept, piloted, drafted] = ["kept", "piloted", "drafted"].map(ids);
  console.log(`${entries.length} entries: ${kept.length} kept, ${piloted.length} piloted, ${drafted.length} drafted`);
  console.log(`kept: ${kept.join(" ")}\npiloted: ${piloted.join(" ")}\ndrafted: ${drafted.join(" ")}`);
  process.exit(0);
}
// Pass 4 names its page before passes 5 to 10 exist; every other run reads the record.
const records = record || Boolean(since) || !args.length;

let files;
let before = new Map();
let orphans = [];
if (since) {
  ({ files, before, orphans } = changedSince(since));
  if (!files.length && !orphans.length) {
    console.log(`no page under ${PAGES} changed since ${since}; nothing to check`);
    process.exit(0);
  }
} else if (args.length) {
  files = [...new Set(args.map((f) => resolve(f.replace(SIDECAR, ".md"))))];
} else {
  files = pagesUnder(join(ROOT, PAGES));
  if (!files.length) {
    console.log(`FAIL no page found under ${PAGES}`);
    process.exit(1);
  }
  orphans = orphansOf(sidecarsUnder(join(ROOT, PAGES)));
}

let failed = orphans.length > 0;
for (const orphan of orphans) {
  console.log(`FAIL ${relative(ROOT, orphan)}: its page ${basename(orphan.replace(SIDECAR, ".md"))} does not exist`);
}
for (const file of files) {
  const rel = relative(ROOT, file);
  const shown = rel.startsWith("..") ? file : rel;
  if (!existsSync(file)) {
    console.log(`FAIL ${shown}: no such page`);
    failed = true;
    continue;
  }
  const { type, title, words, problems } = pageProblems(readFileSync(file, "utf8"));
  if (records && !PREDATES_RECORD.has(rel)) problems.push(...recordProblems(file, title, before.get(file)));
  console.log(`${problems.length ? "FAIL" : "ok  "} ${shown} (${type ?? "?"}, ${words} words)`);
  for (const problem of problems) console.log(`     ${problem}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);

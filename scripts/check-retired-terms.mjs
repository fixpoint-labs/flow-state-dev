#!/usr/bin/env node
/**
 * Guard: Workforce's retired words stay retired.
 *
 * One idea, one name. This guard reads every line of every tracked file and
 * fails on a retired word anywhere it isn't kept on purpose. Which words, what
 * each says instead, which are read on Workforce's ground only, the areas and
 * the exceptions all come from the glossary (`docs/contributing/glossary.mjs`).
 * This file owns how it finds them: the areas walk, the ground, the token
 * strip and the added-lines scan.
 *
 * ## Totality, twice
 *
 * Every tracked file lands in exactly one area, in scope or kept (history,
 * process, `goals/`, root configuration), or the run fails naming it: a new
 * folder nobody classified is the hole a remembered list can't see. Then every
 * match of a retired term on an in-scope line is either stripped by a named
 * exception or counted, and any counted match fails the run.
 *
 * ## Exceptions strip a token, never a line
 *
 * So a second retired word on an excepted line still counts. Each exception
 * names the terms it may strip and the rule behind it. An exception that strips
 * nothing fails the run: an exception nobody needs is a hole waiting for a
 * live use. Never widen an exception to go green: rename the line.
 *
 * ## Ground is a surface, not a folder
 *
 * A term marked `ground: "workforce"` has live meanings elsewhere (the engine's
 * flow kind, a project's members, a chat thread), so it is scanned on
 * Workforce's ground only: Workforce's and
 * Shift Manager's packages and pages, any path that names Workforce (the
 * kitchen-sink app's `workforce/` tree, the React panels, the architecture
 * notes), the glossary's Workforce and Shift Manager sections, and any file
 * that imports Workforce or Shift Manager, wherever it sits.
 *
 * ## The glossary
 *
 * Each term the glossary flags `published` is defined by exactly one row of the
 * published glossary page. Shift Manager's rows name its screens (its Roster
 * screen beside Workforce's roster), so they don't count toward a term.
 *
 * ## Added lines
 *
 * A retirement the glossary reads at `added-lines` scope (today, the resource
 * entry's) is refused only on a line the checkout adds against the base ref:
 * the existing tree keeps its names until they are renamed. A declaration of a
 * name the rule retires counts; a use does not. Docs prose the rule names counts
 * in a page. Its exemptions (a rendered table row) come from the glossary too.
 * History, process, goals and root config stay out of scope, same as the other
 * terms.
 *
 * Run: node scripts/check-retired-terms.mjs [--root <dir>] [--list [term]] [--control]
 *   --root     scan another checkout (default: this repository)
 *   --list     print every counted line, or only one term's
 *   --control  plant lines that must be refused into the tree (in memory) and
 *              require each refused; exits 1 if any slips through
 * Exits 1 on any counted line, unclassified file, stale exception or glossary
 * row out of place.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADDED_LINE_EXEMPTIONS,
  ADDED_LINE_RULES,
  AREAS,
  GUARD_EXEMPTIONS as EXCEPTIONS,
  GUARD_TERMS as TERMS,
  PERSON_PINS,
  PUBLISHED_TERMS,
} from "../docs/contributing/glossary.mjs";

/** The glossary's areas, terms, exceptions and pins, re-exported for this guard's tests and codemods. */
export { AREAS, EXCEPTIONS, PERSON_PINS, TERMS };

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The area a path falls in, or undefined when none names it. */
export const areaOf = (path) => AREAS.find((a) => a.re.test(path));

/**
 * Workforce's paths. The bare `workforce` alternation is meant: a path that
 * names Workforce (kitchen-sink's `workforce/` tree, `lib/workforce-shell.ts`,
 * the architecture notes) is its surface wherever it sits.
 */
const WORKFORCE_PATHS = /^packages\/(workforce|shift-manager)\/|^apps\/docs\/docs\/(workforce|shift-manager)\/|^apps\/docs\/docs\/glossary\/(workforce|shift-manager)\.svg$|workforce/i;
const WORKFORCE_IMPORT = /["']@flow-state-dev\/(?:workforce|shift-manager)(?:\/[^"']*)?["']/;
const GLOSSARY = "apps/docs/docs/glossary.md";
/** The glossary is Workforce's ground from its Workforce section on. */
const GLOSSARY_WORKFORCE_HEADING = /^## Workforce\b/;

/**
 * Which lines of a file are on Workforce's ground.
 * @returns {(index: number) => boolean}
 */
export function workforceGround(path, text) {
  if (path === GLOSSARY) {
    const start = text.split("\n").findIndex((line) => GLOSSARY_WORKFORCE_HEADING.test(line));
    return (index) => start >= 0 && index >= start;
  }
  const on = WORKFORCE_PATHS.test(path) || WORKFORCE_IMPORT.test(text);
  return () => on;
}

const TERM_IDS = new Set(TERMS.map((t) => t.id));
for (const e of EXCEPTIONS) for (const t of e.terms) if (!TERM_IDS.has(t)) throw new Error(`exception ${e.id} names unknown term ${t}`);

const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|wasm)$/i;

const count = (re, s) => {
  re.lastIndex = 0;
  return (s.match(re) ?? []).length;
};

const applyStrip = (e, path, line) => {
  if (typeof e.strip === "function") return e.strip(path, line);
  e.strip.lastIndex = 0;
  return line.replace(e.strip, " ");
};

/**
 * Scan one in-scope file.
 * @param {string} path
 * @param {string} text
 * @param {object[]} exceptions
 * @param {Record<string, number>} [stripped] counts per exception id, added to
 * @returns {{ term: string; line: number; text: string }[]} the counted lines
 */
export function scanFile(path, text, exceptions, stripped = {}) {
  const hits = [];
  const onGround = workforceGround(path, text);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const term of TERMS) {
      if (term.ground === "workforce" && !onGround(i)) continue;
      if (count(term.re, raw) === 0) continue;
      let line = raw;
      for (const e of exceptions) {
        if (!e.terms.includes(term.id)) continue;
        if (e.where && !e.where(path, text)) continue;
        const next = applyStrip(e, path, line);
        if (next === line) continue;
        const removed = count(term.re, line) - count(term.re, next);
        if (removed > 0) stripped[e.id] = (stripped[e.id] ?? 0) + removed;
        line = next;
      }
      if (count(term.re, line) > 0) hits.push({ term: term.id, line: i + 1, text: raw.trim().slice(0, 160) });
    }
  }
  return hits;
}

/**
 * Whether a `*Row` declaration names a resource, by the rule's context: the file
 * is a collection module, the line says collection, or the name does.
 * @param {{ context: { file: RegExp; line: RegExp; name: RegExp } }} rule
 * @param {string} path
 * @param {string} line
 * @param {string} name
 */
function inContext(rule, path, line, name) {
  return rule.context.file.test(path) || rule.context.line.test(line) || rule.context.name.test(name);
}

/** The exemptions that keep one added-lines rule's words. */
const exemptionsOf = (rule) => ADDED_LINE_EXEMPTIONS.filter((e) => e.rules.includes(rule.id));

const DOC_FILE = /\.(?:md|mdx)$/;

/**
 * The glossary's added-lines retirements, refused on lines a change adds.
 * `added` is the 1-based line numbers added in `path`. A line the change did
 * not add is ignored, and so is a file outside this guard's in-scope areas.
 * Each rule refuses, on an added line: its `prose` in a page; a declaration of
 * a name built on its item word (`declaresItem`); and a `…Row` declaration
 * (`declaresRow`) in its context. An exemption's `line` keeps the whole line,
 * its `path` keeps the file's declarations, its `name` keeps one name.
 * @param {string} path
 * @param {string} text
 * @param {Set<number>} added
 * @returns {{ term: string; line: number; text: string }[]}
 */
export function scanCollectionRows(path, text, added) {
  const area = areaOf(path);
  if (area === undefined || !area.scope) return [];
  if (added === undefined || added.size === 0) return [];
  const lines = text.split("\n");
  const hits = [];
  const isDoc = DOC_FILE.test(path);
  for (const rule of ADDED_LINE_RULES) {
    const keeps = exemptionsOf(rule);
    const keptPath = keeps.some((e) => e.path?.test(path));
    for (const n of [...added].sort((a, b) => a - b)) {
      const raw = lines[n - 1];
      if (raw === undefined) continue;
      if (keeps.some((e) => e.line?.test(raw))) continue;
      const hit = { term: rule.id, line: n, text: raw.trim().slice(0, 160) };
      if (isDoc && rule.prose.test(raw)) {
        hits.push(hit);
        continue;
      }
      if (keptPath) continue;
      const declared = (re) => {
        re.lastIndex = 0;
        const names = [];
        for (let m = re.exec(raw); m !== null; m = re.exec(raw)) names.push(m[1]);
        return names.filter((name) => !keeps.some((e) => e.name?.test(name)));
      };
      if (declared(rule.declaresItem).length > 0 || declared(rule.declaresRow).some((name) => inContext(rule, path, raw, name))) hits.push(hit);
    }
  }
  return hits;
}

/**
 * Added-line numbers from one unified diff (`git diff -U0`). Keys are repo-relative
 * paths. Context and deletions are not added lines. A `+++` header is read only
 * outside a hunk, so an added line whose text starts with `++` still counts.
 * @param {string} diff
 * @returns {Map<string, Set<number>>}
 */
export function parseUnifiedAddedLines(diff) {
  /** @type {Map<string, Set<number>>} */
  const map = new Map();
  let path = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      path = null;
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      const raw = line.slice(4);
      if (raw === "/dev/null") path = null;
      else if (raw.startsWith("b/")) path = raw.slice(2);
      else path = raw;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = path !== null;
      continue;
    }
    if (!inHunk || path === null || line === "") continue;
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      let set = map.get(path);
      if (set === undefined) map.set(path, (set = new Set()));
      set.add(newLine);
      newLine++;
      continue;
    }
    if (line.startsWith("-")) continue;
    newLine++;
  }
  return map;
}

/**
 * The ref added lines are measured against. CI's pull_request event sets
 * `GITHUB_BASE_REF`. A local checkout uses `origin/main` when it exists.
 * @param {string} root
 */
export function baseRef(root) {
  const fromEnv = process.env.GITHUB_BASE_REF;
  if (fromEnv !== undefined && fromEnv !== "") return `origin/${fromEnv}`;
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { cwd: root, stdio: "ignore" });
    return "origin/main";
  } catch {
    return "main";
  }
}

/**
 * Run git in `root` and return stdout.
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  return execFileSync("git", ["-c", "color.ui=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Lines this working tree adds relative to {@link baseRef}, plus every line of
 * an untracked file. One diff against the base, so the line numbers match the
 * files on disk (committed changes and uncommitted edits together).
 * @param {string} root
 * @returns {Map<string, Set<number>>}
 */
export function addedLines(root) {
  const base = baseRef(root);
  let diff;
  try {
    diff = git(root, ["diff", "-U0", "--no-color", base]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not diff against ${base} to find added lines. In CI this means the checkout is shallow. Locally, fetch the base branch first. ${message}`,
    );
  }
  const map = parseUnifiedAddedLines(diff);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  for (const path of untracked.split("\0").filter(Boolean)) {
    if (BINARY.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    let set = map.get(path);
    if (set === undefined) map.set(path, (set = new Set()));
    const count = text.split("\n").length;
    for (let i = 1; i <= count; i++) set.add(i);
  }
  return map;
}

/**
 * Added lines, in scope, that the glossary's added-lines retirements refuse.
 * @param {string} [root]
 * @returns {{ path: string; term: string; line: number; text: string }[]}
 */
export function findAddedCollectionRows(root = ROOT) {
  const hits = [];
  for (const [path, lines] of addedLines(root)) {
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    for (const hit of scanCollectionRows(path, text, lines)) hits.push({ path, ...hit });
  }
  return hits;
}

/** The glossary's published terms: each is defined by exactly one row of the published page. */
export const GLOSSARY_TERMS = PUBLISHED_TERMS;

/**
 * Count the glossary's rows per term, Shift Manager's screens left out.
 * @returns {{ missing: string[]; repeated: string[] }}
 */
export function checkGlossary(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const m = /^\|\s*\*\*(.+?)\*\*\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (m === null || m[2] === "Shift Manager") continue;
    rows.set(m[1], (rows.get(m[1]) ?? 0) + 1);
  }
  return {
    missing: GLOSSARY_TERMS.filter((t) => !rows.has(t)),
    repeated: [...rows].filter(([, n]) => n > 1).map(([t]) => t),
  };
}

/**
 * The census over a tree. Pure over its inputs, so a test hands it a fixture.
 * @param {{ files: Map<string, string>; paths: string[] }} tree every path, and
 *   the text of each one that reads as text
 * @param {{ extraExceptions?: object[] }} [options]
 */
export function census({ files, paths }, { extraExceptions = [] } = {}) {
  const exceptions = [...EXCEPTIONS, ...extraExceptions];
  const unscoped = [];
  const areaCounts = {};
  const stripped = {};
  const hits = [];
  for (const path of paths) {
    const area = areaOf(path);
    if (area === undefined) {
      unscoped.push(path);
      continue;
    }
    areaCounts[area.id] = (areaCounts[area.id] ?? 0) + 1;
    if (!area.scope) continue;
    // A file left under its old name can be silent in its text, so the path counts too.
    for (const hit of scanFile(path, path, exceptions, stripped)) hits.push({ path, area: area.id, ...hit, line: 0 });
    if (BINARY.test(path)) continue;
    const text = files.get(path);
    if (text === undefined) continue;
    for (const hit of scanFile(path, text, exceptions, stripped)) hits.push({ path, area: area.id, ...hit });
  }
  const stale = exceptions.filter((e) => !stripped[e.id]).map((e) => e.id);
  const glossaryText = files.get(GLOSSARY);
  const glossary = glossaryText === undefined ? { missing: [...GLOSSARY_TERMS], repeated: [] } : checkGlossary(glossaryText);
  const ok = unscoped.length === 0 && hits.length === 0 && stale.length === 0 && glossary.missing.length === 0 && glossary.repeated.length === 0;
  return { files: paths.length, unscoped, areaCounts, stripped, hits, stale, glossary, ok };
}

/** Every tracked path under `root`, and the text of each one that is text. */
export function readTrackedTree(root = ROOT) {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  const files = new Map();
  for (const path of paths) {
    if (BINARY.test(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      continue; // a tracked file deleted in the working tree
    }
    if (!text.includes("\0")) files.set(path, text);
  }
  return { files, paths };
}

/**
 * Lines planted into a tree, each hiding a retired word beside a token an
 * exception strips, or in a goal's path (a goal's name has no exception).
 * Every one must be refused. A line goes on the end of the
 * file when the tree already has it.
 */
export const PLANTS = [
  { path: "packages/workforce/src/zz-planted.ts", line: "// The researcher runs on the agent kind of flow; its flowKind is unchanged.", term: "kind" },
  { path: "packages/workforce/src/zz-planted.ts", line: "// as goals/workforce-seats/a-seat-shows/ proves", term: "seat" },
  { path: "packages/workforce/src/zz-planted.ts", line: "const leaseAtClaim = 1; // each seat is listed", term: "seat" },
  { path: "apps/docs/docs/zz-planted.md", line: "Run `goals/mailbox-boards/it-drains/run.mts`.", term: "mailbox" },
  { path: "packages/workforce/src/zz-planted.ts", line: "export const roomLineSchema = z.object({});", term: "room" },
  { path: "packages/workforce/src/zz-planted.ts", line: "// wakeMemberWorkers remembers the thread", term: "member" },
  { path: "packages/workforce/src/zz-planted.ts", line: "// a project member wakes each member of the mailbox's thread", term: "thread" },
  { path: "packages/workforce/src/zz-planted.ts", line: 'export const domains = ["seats", "skills"];', term: "seat" },
  { path: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: 'import { openRoster } from "@flow-state-dev/workforce";', term: null },
  { path: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: "const slot: TaskAssignee = pick(row); // the seat this pane opens", term: "seat" },
  { path: "apps/kitchen-sink/components/zz-planted-pane.tsx", line: "// the pane shows the worker's kind beside its flow kind", term: "kind" },
  { path: "packages/orchestration/src/task-board/zz-planted.ts", line: "// a dispatcher seat hands this row to a hired seat", term: "seat" },
  { path: "apps/kitchen-sink/flows/zz-board/flow.ts", line: 'const board = taskBoard({ name: "triage", workers }); // each seat runs inline', term: "seat" },
  { path: "apps/kitchen-sink/flows/zz-board/flow.ts", line: "if (envelope.seat === name) return;", term: "seat" },
  { path: "apps/kitchen-sink/flows/zz-board/flow.ts", line: "// a hired seat answers elsewhere", term: "seat" },
  { path: PERSON_PINS[0].path, line: "If you can't help, say how to reach a person, and tell the person who signed in.", term: "person" },
  { path: GLOSSARY, line: "| **Worker** | workforce | A second definition. | Worker |", term: null },
  { path: "zz-planted-folder/notes.md", line: "Nothing retired here.", term: null },
  // A resource in a collection named as a row, refused on an added line. In memory, so the control does not need a dirty tree.
  { path: "packages/orchestration/src/tasks/collection/zz-planted.ts", line: "export type WidgetRow = { id: string };", term: "collection-row" },
  { path: "apps/docs/docs/zz-collection-planted.md", line: "Each collection row is stored beside the worker.", term: "collection-row" },
];

/** An exception that matches nothing, which the run must report stale. */
export const STALE_PLANT = { id: "zz-planted-stale", terms: ["seat"], strip: /zz-never-matches/g, why: "planted" };

/**
 * Plant {@link PLANTS} and {@link STALE_PLANT} into a tree and report, for
 * each, whether the census refused it.
 * @param {{ files: Map<string, string>; paths: string[] }} tree
 */
export function control(tree) {
  const files = new Map(tree.files);
  const paths = [...tree.paths];
  const lineOf = new Map();
  for (const plant of PLANTS) {
    const before = files.get(plant.path);
    if (before === undefined) paths.push(plant.path);
    const text = before === undefined ? plant.line : `${before.replace(/\n$/, "")}\n${plant.line}`;
    files.set(plant.path, `${text}\n`);
    lineOf.set(plant, text.split("\n").length);
  }
  const r = census({ files, paths }, { extraExceptions: [STALE_PLANT] });
  const results = PLANTS.filter((p) => p.term !== null).map((p) => {
    const line = lineOf.get(p);
    const refused = ADDED_LINE_RULES.some((rule) => rule.id === p.term)
      ? scanCollectionRows(p.path, files.get(p.path) ?? "", new Set([line])).some((h) => h.line === line)
      : r.hits.some((h) => h.path === p.path && h.line === line && h.term === p.term);
    return { what: `${p.path}:${line} (${p.term})`, refused };
  });
  results.push({ what: "a second glossary row for Worker", refused: r.glossary.repeated.includes("Worker") });
  results.push({ what: "an exception that strips nothing", refused: r.stale.includes(STALE_PLANT.id) });
  results.push({ what: "a folder no area names", refused: r.unscoped.includes("zz-planted-folder/notes.md") });
  return { results, ok: results.every((x) => x.refused) };
}

/**
 * @param {ReturnType<typeof census>} r
 * @param {{ path: string; term: string; line: number; text: string }[]} rowHits
 */
function print(r, rowHits) {
  console.log(`tracked files: ${r.files}`);
  console.log("areas: " + AREAS.map((a) => `${a.id}${a.scope ? "" : " (kept)"} ${r.areaCounts[a.id] ?? 0}`).join(" · "));
  for (const e of EXCEPTIONS.map((x) => x.id)) console.log(`exception ${e}: ${r.stripped[e] ?? 0} stripped`);
  const byTerm = {};
  for (const h of r.hits) byTerm[h.term] = (byTerm[h.term] ?? 0) + 1;
  for (const t of TERMS) if (byTerm[t.id]) console.log(`  ${t.id}: ${byTerm[t.id]} counted (say ${t.say})`);
  if (rowHits.length > 0) {
    for (const rule of ADDED_LINE_RULES) {
      const own = rowHits.filter((h) => h.term === rule.id);
      if (own.length === 0) continue;
      console.error(`  ${rule.id}: ${own.length} added line(s) use a word the ${rule.term} entry retires (say ${rule.say}: ${rule.anchor.join(", ")})`);
      for (const h of own) console.error(`  ${h.path}:${h.line}  ${h.text}`);
    }
  }
  if (r.unscoped.length > 0) console.error(`UNSCOPED (no area): ${r.unscoped.join(", ")}`);
  if (r.stale.length > 0) console.error(`STALE EXCEPTIONS (remove them): ${r.stale.join(", ")}`);
  if (r.glossary.missing.length > 0) console.error(`GLOSSARY: no row for ${r.glossary.missing.join(", ")}`);
  if (r.glossary.repeated.length > 0) console.error(`GLOSSARY: more than one row for ${r.glossary.repeated.join(", ")}`);
  const lines = new Set(r.hits.map((h) => `${h.path}:${h.line}`));
  const inFiles = new Set(r.hits.map((h) => h.path));
  if (r.hits.length > 0) console.error(`FAIL · ${lines.size} lines in ${inFiles.size} files use a retired term`);
  if (rowHits.length > 0) console.error(`FAIL · ${rowHits.length} added line(s) use a retired word`);
  if (r.ok && rowHits.length === 0) console.log("check-retired-terms: PASS · no retired term outside its exceptions, every exception strips something, every file has an area, one glossary row per term, no added line uses a retired word");
}

function main() {
  const at = process.argv.indexOf("--root");
  const root = at >= 0 ? process.argv[at + 1] : ROOT;
  const tree = readTrackedTree(root);
  if (process.argv.includes("--control")) {
    const { results, ok } = control(tree);
    for (const x of results) console.log(`plant ${x.what}: ${x.refused ? "refused" : "SLIPPED THROUGH"}`);
    console.log(ok ? "CONTROL PASS · every plant was refused" : "CONTROL FAIL");
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const r = census(tree);
  let rowHits = [];
  let rowError = null;
  try {
    rowHits = findAddedCollectionRows(root);
  } catch (error) {
    rowError = error instanceof Error ? error.message : String(error);
  }
  if (process.argv.includes("--list")) {
    const which = process.argv[process.argv.indexOf("--list") + 1];
    for (const h of r.hits) if (which === undefined || which.startsWith("--") || h.term === which) console.log(`${h.path}:${h.line}  [${h.term}]  ${h.text}`);
    for (const h of rowHits) if (which === undefined || which.startsWith("--") || h.term === which) console.log(`${h.path}:${h.line}  [${h.term}]  ${h.text}`);
  }
  print(r, rowHits);
  if (rowError !== null) {
    console.error(rowError);
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.ok && rowHits.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

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
 * ## Whole-tree rules
 *
 * A retirement the glossary reads at `tree` scope (today, the resource entry's)
 * matches by shape rather than by one word: in code, a name it declares or
 * exports (each matcher runs over the whole file, so a declaration may span
 * lines); in a page, its prose. Every line of every in-scope file counts, the
 * existing tree as much as a change. Its exemptions come from the glossary too:
 * a path keeps a file's `…Row` names, and the quote rule strips a released
 * message's text on the pages it names, never the line. Each must keep
 * something, or it is stale. History, process, goals and root config stay out
 * of scope, same as the other terms.
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
  AREAS,
  GUARD_EXEMPTIONS as EXCEPTIONS,
  GUARD_TERMS as TERMS,
  PERSON_PINS,
  PUBLISHED_TERMS,
  TREE_EXEMPTIONS,
  TREE_RULES,
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
  // A contributor area reads retired names only, never an English meaning (FIX-2354 D1).
  const namesOnly = areaOf(path)?.reach === "name";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    for (const term of TERMS) {
      if (term.ground === "workforce" && !onGround(i)) continue;
      if (namesOnly && term.reach === "meaning") continue;
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

/** The exemptions that keep one whole-tree rule's words. */
const exemptionsOf = (rule) => TREE_EXEMPTIONS.filter((e) => e.rules.includes(rule.id));

const DOC_FILE = /\.(?:md|mdx)$/;
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** The 1-based line each match of the global `re` starts on, in `text`, with what it captured. */
function matchLines(re, text) {
  re.lastIndex = 0;
  const found = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    found.push({ line: text.slice(0, m.index).split("\n").length, name: m.slice(1).find((g) => g !== undefined) ?? m[0] });
    if (m[0] === "") re.lastIndex++;
  }
  return found;
}

/**
 * The glossary's whole-tree retirements over one file, every line of it. A
 * file outside this guard's in-scope areas is ignored. In code: a type
 * declared with Row in its name (`declaresRow`), an exported value built on
 * Row, directly or through an export list (`exportsRow`, `exportsRowInList`, `exportsRowInPattern`), any name built on CollectionItem (`namesItem`), and a
 * lifecycle named State (`declaresState`); a kept `path` drops the four Row
 * matchers only. In a page: the rule's `prose`, once a quote rule has stripped
 * the released texts it names from a page it covers.
 * @param {string} path
 * @param {string} text
 * @param {Record<string, number>} [kept] counts per exemption id, added to
 * @returns {{ term: string; line: number; text: string }[]}
 */
export function scanTreeRules(path, text, kept = {}) {
  const area = areaOf(path);
  if (area === undefined || !area.scope) return [];
  const lines = text.split("\n");
  const hits = [];
  for (const rule of TREE_RULES) {
    const keeps = exemptionsOf(rule);
    const at = new Set();
    if (CODE_FILE.test(path)) {
      const keptPath = keeps.find((e) => e.path?.test(path));
      for (const re of [rule.declaresRow, rule.exportsRow, rule.exportsRowInList, rule.exportsRowInPattern]) {
        const found = typeof re === "function" ? re(text).map((h) => ({ line: text.slice(0, h.index).split("\n").length, name: h.name })) : matchLines(re, text);
        if (keptPath === undefined) for (const f of found) at.add(f.line);
        else if (found.length > 0) kept[keptPath.id] = (kept[keptPath.id] ?? 0) + found.length;
      }
      for (const re of [rule.namesItem, rule.declaresState]) for (const f of matchLines(re, text)) at.add(f.line);
    } else if (DOC_FILE.test(path)) {
      const quoting = keeps.filter((e) => e.pages?.test(path));
      lines.forEach((raw, i) => {
        let line = raw;
        for (const e of quoting) {
          const next = e.quotes.reduce((l, re) => l.replace(re, " "), line);
          if (next !== line) kept[e.id] = (kept[e.id] ?? 0) + 1;
          line = next;
        }
        if (rule.prose.test(line)) at.add(i + 1);
      });
    }
    for (const n of [...at].sort((a, b) => a - b)) hits.push({ term: rule.id, line: n, text: (lines[n - 1] ?? "").trim().slice(0, 160) });
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
    for (const hit of scanTreeRules(path, text, stripped)) hits.push({ path, area: area.id, ...hit });
  }
  const stale = [...exceptions, ...TREE_EXEMPTIONS].filter((e) => !stripped[e.id]).map((e) => e.id);
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
  // A resource named as a row or a collection item, and a lifecycle named State, in any package (FIX-2479).
  { path: "packages/orchestration/src/tasks/collection/zz-planted.ts", line: "export type FooRow = { id: string };", term: "collection-row" },
  { path: "packages/workforce/src/zz-planted-resource.ts", line: "export type FooRow = { id: string };", term: "collection-row" },
  { path: "packages/client/src/zz-planted.ts", line: "export function useFooCollectionItem() {}", term: "collection-row" },
  { path: "packages/harness-manager/src/zz-planted.ts", line: "export async function readFooRow() {}", term: "collection-row" },
  { path: "packages/workspace/src/zz-planted.ts", line: 'export type FooState = "idle" | "done";', term: "collection-row" },
  { path: "apps/docs/docs/zz-collection-planted.md", line: "Each collection row is stored beside the worker.", term: "collection-row" },
  // A released quote is kept as text, not as a line: a second use beside it still counts.
  {
    path: "apps/docs/docs/zz-quote-planted.md",
    line: 'It throws "A row of an owner-writes collection is written only by the user it belongs to." for each row of the shared collection.',
    term: "collection-row",
  },
  // A retired name in a contributor doc and in a skill, the trees agents read most (FIX-2354).
  { path: "docs/contributing/zz-planted.md", line: "Locality is decided by `isInProcessDispatcher`.", term: "isInProcessDispatcher" },
  { path: ".agents/skills/zz-planted/SKILL.md", line: "Locality is decided by `isInProcessDispatcher`.", term: "isInProcessDispatcher" },
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
    const refused = r.hits.some((h) => h.path === p.path && h.line === line && h.term === p.term);
    return { what: `${p.path}:${line} (${p.term})`, refused };
  });
  results.push({ what: "a second glossary row for Worker", refused: r.glossary.repeated.includes("Worker") });
  results.push({ what: "an exception that strips nothing", refused: r.stale.includes(STALE_PLANT.id) });
  results.push({ what: "a folder no area names", refused: r.unscoped.includes("zz-planted-folder/notes.md") });
  return { results, ok: results.every((x) => x.refused) };
}

/** @param {ReturnType<typeof census>} r */
function print(r) {
  console.log(`tracked files: ${r.files}`);
  console.log("areas: " + AREAS.map((a) => `${a.id}${a.scope ? "" : " (kept)"} ${r.areaCounts[a.id] ?? 0}`).join(" · "));
  for (const e of EXCEPTIONS.map((x) => x.id)) console.log(`exception ${e}: ${r.stripped[e] ?? 0} stripped`);
  for (const e of TREE_EXEMPTIONS.map((x) => x.id)) console.log(`exemption ${e}: ${r.stripped[e] ?? 0} kept`);
  const byTerm = {};
  for (const h of r.hits) byTerm[h.term] = (byTerm[h.term] ?? 0) + 1;
  for (const t of TERMS) if (byTerm[t.id]) console.log(`  ${t.id}: ${byTerm[t.id]} counted (say ${t.say})`);
  for (const rule of TREE_RULES) if (byTerm[rule.id]) console.log(`  ${rule.id}: ${byTerm[rule.id]} counted, a word the ${rule.term} entry retires (say ${rule.say}: ${rule.anchor.join(", ")})`);
  if (r.unscoped.length > 0) console.error(`UNSCOPED (no area): ${r.unscoped.join(", ")}`);
  if (r.stale.length > 0) console.error(`STALE EXCEPTIONS (remove them): ${r.stale.join(", ")}`);
  if (r.glossary.missing.length > 0) console.error(`GLOSSARY: no row for ${r.glossary.missing.join(", ")}`);
  if (r.glossary.repeated.length > 0) console.error(`GLOSSARY: more than one row for ${r.glossary.repeated.join(", ")}`);
  const lines = new Set(r.hits.map((h) => `${h.path}:${h.line}`));
  const inFiles = new Set(r.hits.map((h) => h.path));
  if (r.hits.length > 0) console.error(`FAIL · ${lines.size} lines in ${inFiles.size} files use a retired term`);
  if (r.ok) console.log("check-retired-terms: PASS · no retired term outside its exceptions, every exception strips something, every file has an area, one glossary row per term");
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
  if (process.argv.includes("--list")) {
    const which = process.argv[process.argv.indexOf("--list") + 1];
    for (const h of r.hits) if (which === undefined || which.startsWith("--") || h.term === which) console.log(`${h.path}:${h.line}  [${h.term}]  ${h.text}`);
  }
  print(r);
  process.exitCode = r.ok ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

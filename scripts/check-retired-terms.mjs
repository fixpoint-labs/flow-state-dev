#!/usr/bin/env node
/**
 * Guard: Workforce's retired words stay retired.
 *
 * One idea, one name. This guard reads every line of every tracked file and
 * fails on a retired word anywhere it isn't kept on purpose. Which words, what
 * each says instead, which are read on Workforce's ground only, the areas and
 * the exceptions all come from the glossary (`docs/contributing/glossary.mjs`).
 * This file owns how it finds them: the areas walk, the ground, the token
 * strip, the parser's name reads and the added-names ratchet.
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
 * matches by shape rather than by one word: in code, a row name it declares,
 * read with TypeScript's parser (`declaredNames`, one read per declaration
 * kind, so a declaration may span lines and a use never counts); in a page, its
 * prose; on any line of any in-scope file, its phrases. Every line of every
 * in-scope file counts, the existing tree as much as a change. Its exemptions
 * come from the glossary too: a path keeps a file's row names and phrases, and
 * the quote rule strips a released message's text on the pages it names, never
 * the line. Each must keep something, or it is stale. History, process, goals
 * and root config stay out of scope, same as the other terms.
 *
 * ## The names a change adds
 *
 * A row local, parameter or property is not read over the whole tree yet: 2,170
 * stay until FIX-2632 renames them. `--added-since <base>` reads what a change
 * adds instead, as a per-file ratchet (FIX-2631 D1): a changed file may not
 * declare more row names than its base version did. It reads the two commits
 * (`gitReader`), never the working tree or a diff's hunks, so an edit to a line
 * that already declares one is not new. Git's rename detection carries a moved
 * file's names; a copy reads as new. The pre-push hook passes each pushed sha
 * and its merge base with origin/main; CI passes `HEAD^1`.
 *
 * Run: node scripts/check-retired-terms.mjs [--root <dir>] [--list [term]] [--control]
 *      node scripts/check-retired-terms.mjs --added-since <base> [--head <sha>] [--root <dir>]
 *   --root         scan another checkout (default: this repository)
 *   --list         print every counted line, or only one term's
 *   --control      plant lines that must be refused into the tree, and added
 *                  names with a base text, all in memory; require each refused,
 *                  each must-pass change passed, and a plant for every parser
 *                  read; exits 1 otherwise
 *   --added-since  the added reach only, from <base> to --head (default HEAD);
 *                  a ref that does not resolve exits 1
 * Exits 1 on any counted line, unclassified file, stale exception or glossary
 * row out of place. Needs `pnpm install` (the parser).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  AREAS,
  GUARD_EXEMPTIONS as EXCEPTIONS,
  GUARD_TERMS as TERMS,
  PERSON_PINS,
  PUBLISHED_TERMS,
  TREE_EXEMPTIONS,
  TREE_RULES,
} from "../docs/contributing/glossary.mjs";
import { gitReader } from "./mechanism-exports.mjs";

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

const SCRIPT_KIND = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
const scriptKindOf = (path) => {
  const ext = /\.[cm]?([jt]sx?)$/.exec(path)?.[1] ?? "ts";
  return SCRIPT_KIND[ext];
};
const hasExport = (node) => (node !== undefined && ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
/** The variable statement a declaration or a binding inside it belongs to, if any. */
const statementOf = (node) => {
  let n = node;
  // A function or a class is a boundary: what an arrow, a method or a class inside an exported
  // initializer binds is its own, not the export's (`export const ids = xs.map(({ row }) => row)`).
  while (n !== undefined && !ts.isVariableStatement(n) && !ts.isSourceFile(n) && !ts.isBlock(n) && !ts.isFunctionLike(n) && !ts.isClassLike(n)) n = n.parent;
  return n !== undefined && ts.isVariableStatement(n) ? n : undefined;
};

/**
 * Each declaration the parser reads: which `read` it is (the `--control` plants name one each), the
 * node it applies to, its name node, and its kind. `kind` is what the glossary's `treeKinds` names;
 * an exported function or variable is `exported-value`, the same unexported one a `local`.
 */
export const NAME_READS = [
  { read: "type-parameter", is: ts.isTypeParameterDeclaration, kind: () => "type-parameter" },
  { read: "type-alias", is: ts.isTypeAliasDeclaration, kind: () => "type" },
  { read: "interface", is: ts.isInterfaceDeclaration, kind: () => "type" },
  { read: "enum", is: ts.isEnumDeclaration, kind: () => "type" },
  { read: "class", is: (n) => ts.isClassDeclaration(n) || ts.isClassExpression(n), kind: () => "class" },
  { read: "function", is: (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n), kind: (n) => (ts.isFunctionDeclaration(n) && hasExport(n) ? "exported-value" : "local") },
  { read: "variable", is: (n) => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name), kind: (n) => (hasExport(statementOf(n)) ? "exported-value" : "local") },
  { read: "binding", is: (n) => ts.isBindingElement(n) && ts.isIdentifier(n.name), kind: (n) => (statementOf(n) !== undefined && hasExport(statementOf(n)) ? "exported-value" : "local") },
  { read: "parameter", is: (n) => ts.isParameter(n) && ts.isIdentifier(n.name), kind: () => "parameter" },
  // An import binds a new name only under an alias, a default or a namespace; `import { VersionedRow }` is a use.
  { read: "import", is: (n) => (ts.isImportSpecifier(n) && n.propertyName !== undefined) || ts.isImportClause(n) || ts.isNamespaceImport(n), kind: () => "import" },
  // `export { a as fooRow }` binds fooRow, a re-export too; `export { fooRow }` names a local; a plain `export { FooRow } from` is a use.
  { read: "export-list", is: (n) => ts.isExportSpecifier(n) && (n.propertyName !== undefined || n.parent.parent.moduleSpecifier === undefined), kind: () => "export" },
  // `import row = require("./x")` binds row.
  { read: "import-equals", is: ts.isImportEqualsDeclaration, kind: () => "import" },
  // `namespace rowSpace {}` and `module rowSpace {}`; `declare module "row-lib"` names a path, which the name check below drops.
  { read: "namespace", is: (n) => ts.isModuleDeclaration(n) && ts.isIdentifier(n.name), kind: (n) => (hasExport(n) ? "exported-value" : "local") },
  // `export * as FooRow from "./x"` binds FooRow, as an export-list alias does.
  { read: "namespace-export", is: ts.isNamespaceExport, kind: () => "export" },
  {
    read: "property",
    // A method or an accessor is a declaration where a class owns it; in an object literal it is a key, a use,
    // the same as `{ row: () => {} }`. A property or method signature belongs to an interface or a type literal.
    is: (n) =>
      ts.isPropertySignature(n) ||
      ts.isPropertyDeclaration(n) ||
      ts.isMethodSignature(n) ||
      ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && ts.isClassLike(n.parent)),
    kind: () => "property",
  },
];

/**
 * Every name a file declares, as TypeScript's parser reads it (FIX-2631 D2): `{ name, kind, read, line }`,
 * `line` 1-based, at the name. A use is never read: a property access, an object key, a plain import or
 * re-export, a string.
 * @param {string} path
 * @param {string} text
 * @param {typeof NAME_READS} [reads]
 */
export function declaredNames(path, text, reads = NAME_READS) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  const out = [];
  const visit = (node) => {
    const r = reads.find((x) => x.is(node));
    const nameNode = r === undefined ? undefined : node.name;
    if (nameNode !== undefined && (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode) || ts.isStringLiteral(nameNode))) {
      out.push({ name: nameNode.text.replace(/^#/, ""), kind: r.kind(node), read: r.read, line: sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A rule's row names in a file: every kind, or only its whole-tree kinds. A file with no `row` in it is not parsed. */
function rowNames(rule, path, text, { tree, reads }) {
  if (!/row/i.test(text)) return [];
  return declaredNames(path, text, reads).filter((d) => rule.rowName.test(d.name) && (!tree || rule.treeKinds.includes(d.kind)));
}

/**
 * The glossary's whole-tree retirements over one file, every line of it. A
 * file outside this guard's in-scope areas is ignored. In code: a row name of
 * one of the rule's `treeKinds`, read by the parser (any type or class, an
 * exported value, a name an export list binds, a type parameter), any name
 * built on CollectionItem (`namesItem`), and a lifecycle named State
 * (`declaresState`); a kept `path` drops the row names only. In a page: the
 * rule's `prose`, once a quote rule has stripped the released texts it names
 * from a page it covers. In every file, code or page or any other text: the
 * rule's `phrases`, which a kept path keeps too.
 * @param {string} path
 * @param {string} text
 * @param {Record<string, number>} [kept] counts per exemption id, added to
 * @param {{ reads?: typeof NAME_READS }} [options]
 * @returns {{ term: string; line: number; text: string }[]}
 */
export function scanTreeRules(path, text, kept = {}, { reads = NAME_READS } = {}) {
  const area = areaOf(path);
  if (area === undefined || !area.scope) return [];
  const lines = text.split("\n");
  const hits = [];
  for (const rule of TREE_RULES) {
    const keeps = exemptionsOf(rule);
    const keptPath = keeps.find((e) => e.path?.test(path));
    const keep = (n) => { kept[keptPath.id] = (kept[keptPath.id] ?? 0) + n; };
    const quoting = keeps.filter((e) => e.pages?.test(path));
    const at = new Set();
    if (CODE_FILE.test(path)) {
      const found = rowNames(rule, path, text, { tree: true, reads });
      if (keptPath === undefined) for (const f of found) at.add(f.line);
      else if (found.length > 0) keep(found.length);
      for (const re of [rule.namesItem, rule.declaresState]) for (const f of matchLines(re, text)) at.add(f.line);
    }
    lines.forEach((raw, i) => {
      let line = raw;
      if (DOC_FILE.test(path)) {
        for (const e of quoting) {
          const next = e.quotes.reduce((l, re) => l.replace(re, " "), line);
          if (next !== line) kept[e.id] = (kept[e.id] ?? 0) + 1;
          line = next;
        }
        if (rule.prose.test(line)) at.add(i + 1);
      }
      if (rule.phrases.test(line)) {
        if (keptPath === undefined) at.add(i + 1);
        else keep(1);
      }
    });
    for (const n of [...at].sort((a, b) => a - b)) hits.push({ term: rule.id, line: n, text: (lines[n - 1] ?? "").trim().slice(0, 160) });
  }
  return hits;
}

/**
 * The names one file's change adds (FIX-2631 D1): a row name counts as new when the file declares more
 * row names, of any kind, than its base text did. So an edit to a line that already declares one passes,
 * and so does a swap of one for another in the same file. A file in a kept path, or outside the in-scope
 * code, adds none. Reported: each declaration of a name the head declares more often than the base.
 * @param {string} path the file at the head
 * @param {string | null} before its text at the base (`null`: the file is new)
 * @param {string} after its text at the head
 * @param {{ reads?: typeof NAME_READS; kept?: Record<string, number> }} [options]
 * @returns {{ term: string; line: number; text: string; name: string }[]}
 */
export function addedRowNames(path, before, after, { reads = NAME_READS, kept = {} } = {}) {
  const area = areaOf(path);
  if (area === undefined || !area.scope || !CODE_FILE.test(path)) return [];
  const hits = [];
  for (const rule of TREE_RULES) {
    if (rule.rowName === undefined) continue;
    const head = rowNames(rule, path, after, { tree: false, reads });
    const base = before === null ? [] : rowNames(rule, path, before, { tree: false, reads });
    const keptPath = exemptionsOf(rule).find((e) => e.path?.test(path));
    if (keptPath !== undefined) {
      if (head.length > 0) kept[keptPath.id] = (kept[keptPath.id] ?? 0) + head.length;
      continue;
    }
    if (head.length <= base.length) continue;
    const baseCount = new Map();
    for (const d of base) baseCount.set(d.name, (baseCount.get(d.name) ?? 0) + 1);
    const seen = new Map();
    const lines = after.split("\n");
    for (const d of head) {
      const n = (seen.get(d.name) ?? 0) + 1;
      seen.set(d.name, n);
      if (n > (baseCount.get(d.name) ?? 0)) hits.push({ term: rule.id, line: d.line, name: d.name, text: (lines[d.line - 1] ?? "").trim().slice(0, 160) });
    }
  }
  return hits;
}

const gitOut = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });

/**
 * The added reach over a commit range: every in-scope code file `head` changes against `base`, git's
 * rename detection on (a moved file keeps its names; a copy reads as new). Reads the two commits,
 * never the working tree or a diff's hunks. A ref that does not resolve throws: CI never skips.
 * @param {string} root
 * @param {string} base
 * @param {string} [head]
 */
export function addedSince(root, base, head = "HEAD") {
  const resolve = (ref) => {
    try {
      return gitOut(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
    } catch {
      throw new Error(`--added-since: ${ref} does not resolve to a commit here; fetch it (CI checks out depth 2 for HEAD^1)`);
    }
  };
  const [from, to] = [resolve(base), resolve(head)];
  const fields = gitOut(root, ["diff", "--name-status", "-M", "-z", "--no-ext-diff", from, to]).split("\0").filter(Boolean);
  const readFrom = gitReader(root, from);
  const readTo = gitReader(root, to);
  const hits = [];
  const kept = {};
  const unread = [];
  let changed = 0;
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++];
    const renamed = status.startsWith("R");
    const oldPath = renamed ? fields[i++] : fields[i];
    const path = fields[i++];
    if (status.startsWith("D") || !CODE_FILE.test(path)) continue;
    changed++;
    const after = readTo(path);
    const before = status.startsWith("A") ? null : readFrom(oldPath);
    // A file the diff names and the reader can't read is a hole, never a pass.
    if (after === null || (before === null && !status.startsWith("A"))) {
      unread.push(path);
      continue;
    }
    for (const h of addedRowNames(path, before, after, { kept })) hits.push({ path, area: areaOf(path)?.id, ...h });
  }
  return { base: from, head: to, changed, hits, kept, unread, ok: hits.length === 0 && unread.length === 0 };
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
 * @param {{ extraExceptions?: object[]; reads?: typeof NAME_READS }} [options] `reads`: the parser reads (a test drops one)
 */
export function census({ files, paths }, { extraExceptions = [], reads = NAME_READS } = {}) {
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
    for (const hit of scanTreeRules(path, text, stripped, { reads })) hits.push({ path, area: area.id, ...hit });
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
  // A row name of each whole-tree kind, one parser read each, so dropping any read lets its plant through (FIX-2631).
  { path: "packages/workforce/src/zz-planted-type-alias.ts", line: "type FooRow = { id: string };", term: "collection-row", read: "type-alias" },
  { path: "packages/workforce/src/zz-planted-interface.ts", line: "interface BarRow { id: string }", term: "collection-row", read: "interface" },
  { path: "packages/workforce/src/zz-planted-enum.ts", line: "enum BazRow { A }", term: "collection-row", read: "enum" },
  { path: "packages/workforce/src/zz-planted-class.ts", line: "const Q = class QuxRow {};", term: "collection-row", read: "class" },
  { path: "packages/workforce/src/zz-planted-function.ts", line: "export function readFooRow() {}", term: "collection-row", read: "function" },
  { path: "packages/workforce/src/zz-planted-variable.ts", line: "export const fooRowSchema = 1;", term: "collection-row", read: "variable" },
  { path: "packages/workforce/src/zz-planted-binding.ts", line: "export const { list: listFooRows } = helpers;", term: "collection-row", read: "binding" },
  { path: "packages/workforce/src/zz-planted-export-list.ts", line: "export { a as fooRow };", term: "collection-row", read: "export-list" },
  { path: "packages/engine/src/zz-planted-type-parameter.ts", line: "function g<TRow extends object>() {}", term: "collection-row", read: "type-parameter" },
  { path: "packages/workforce/src/zz-planted-namespace-export.ts", line: 'export * as FooRows from "./x";', term: "collection-row", read: "namespace-export" },
  // Must pass: what a function inside an exported initializer binds is its own, not the export's.
  { path: "packages/workforce/src/zz-planted-pass.ts", line: "export const ids = [].map(({ row }: { row: { id: string } }) => row.id);", term: "collection-row", pass: true },
  // One of the six phrases, on any line of any in-scope file: a comment, a test name, a figure, a contributor doc.
  { path: "packages/workforce/src/zz-planted-phrase.ts", line: "// the subscription row is deleted when it ends", term: "collection-row" },
  { path: "packages/orchestration/test/zz-planted-phrase.test.ts", line: 'it("reads each task\'s rows", () => {});', term: "collection-row" },
  { path: "apps/docs/docs/zz-planted-phrase.svg", line: '<text x="1" y="1">The worker rows</text>', term: "collection-row" },
  { path: "docs/contributing/zz-planted-phrase.md", line: "Write the project row back once.", term: "collection-row" },
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

/**
 * The added reach's plants: a file's base text and its head text, in memory, no git. Each named one is a
 * row name a change adds, through one parser read; each with `name: null` is a change the reach must
 * pass (an edit to a line that already declares a row name, a swap, a kept path, a use).
 */
export const ADDED_PLANTS = [
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "const taskRow = 1;\n", name: "taskRow", read: "variable" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "const { list: taskRows } = x;\n", name: "taskRows", read: "binding" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "for (const row of list) use(row);\n", name: "row", read: "variable" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "function f(/* lead */ row: unknown) {}\n", name: "row", read: "parameter" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "function readTaskRow() {}\n", name: "readTaskRow", read: "function" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: 'import * as rowLib from "./y";\n', name: "rowLib", read: "import" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "class C { private rowCount = 1; }\n", name: "rowCount", read: "property" },
  { path: "packages/workforce/src/zz-added.ts", base: "const a = 1;\n", head: "const a = 1;\nconst ROW_ID = 2;\n", name: "ROW_ID", read: "variable" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: 'import rowLib = require("./x");\n', name: "rowLib", read: "import-equals" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "namespace rowSpace {}\n", name: "rowSpace", read: "namespace" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "const obj = { row() {}, get rows() { return []; }, taskRow: () => 1 };\n", name: null, why: "an object literal's keys" },
  { path: "packages/workforce/src/zz-added.ts", base: "const row = 1;\n", head: "const row = 2;\n", name: null, why: "an edit to a line that already declares row" },
  { path: "packages/workforce/src/zz-added.ts", base: "const row = 1;\n", head: "const taskRow = 1;\n", name: null, why: "a swap inside one file (D1)" },
  { path: "packages/store-sqlite/src/zz-added.ts", base: "", head: "const row = 1;\n", name: null, why: "a store adapter keeps its rows" },
  { path: "packages/workforce/src/zz-added.ts", base: "", head: "use(entry.row); call({ row }); const s = 'row';\n", name: null, why: "uses and a string" },
];

/** An exception that matches nothing, which the run must report stale. */
export const STALE_PLANT = { id: "zz-planted-stale", terms: ["seat"], strip: /zz-never-matches/g, why: "planted" };

/**
 * Plant {@link PLANTS} and {@link STALE_PLANT} into a tree and report, for
 * each, whether the census refused it.
 * @param {{ files: Map<string, string>; paths: string[] }} tree
 */
export function control(tree, { reads = NAME_READS } = {}) {
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
  const r = census({ files, paths }, { extraExceptions: [STALE_PLANT], reads });
  const results = PLANTS.filter((p) => p.term !== null).map((p) => {
    const line = lineOf.get(p);
    const hit = r.hits.some((h) => h.path === p.path && h.line === line && h.term === p.term);
    // A `pass` plant must not be counted: `refused` reads as "held", as for the added reach's must-pass plants.
    if (p.pass) return { what: `${p.path}:${line} (${p.term}, must pass)`, refused: !hit, passes: true };
    return { what: `${p.path}:${line} (${p.term}${p.read ? `, read ${p.read}` : ""})`, refused: hit };
  });
  for (const p of ADDED_PLANTS) {
    const hits = addedRowNames(p.path, p.base, p.head, { reads });
    const refused = p.name === null ? hits.length === 0 : hits.some((h) => h.name === p.name);
    results.push({ what: `added ${p.path} ${p.name === null ? `(${p.why})` : `${p.name} (read ${p.read})`}`, refused, passes: p.name === null });
  }
  // A read with no plant could be dropped and nothing here would notice.
  const planted = new Set([...PLANTS, ...ADDED_PLANTS].map((p) => p.read).filter(Boolean));
  for (const r of NAME_READS) results.push({ what: `the ${r.read} read has a plant`, refused: planted.has(r.read), passes: true });
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

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** The added reach, `--added-since <base> [--head <sha>]`: exits 1 on a new row name, and on a base or head that does not resolve. */
function mainAdded(root, base) {
  const head = argOf("--head") ?? "HEAD";
  let r;
  try {
    r = addedSince(root, base, head);
  } catch (err) {
    console.error(`check-retired-terms: FAIL · ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const rule = TREE_RULES.find((x) => x.rowName !== undefined);
  for (const h of r.hits) console.log(`${h.path}:${h.line}  [${h.term}]  ${h.name} is a new row name (say ${rule.sayAdded})  ${h.text}`);
  console.log(`added since ${r.base.slice(0, 10)} to ${r.head.slice(0, 10)}: ${r.changed} code files changed`);
  for (const [id, n] of Object.entries(r.kept)) console.log(`exemption ${id}: ${n} kept`);
  if (r.unread.length > 0) console.error(`UNREAD (the diff names them, the reader found no text): ${r.unread.join(", ")}`);
  if (r.ok) console.log("check-retired-terms --added-since: PASS · no changed file declares more row names than its base did");
  else console.error(`FAIL · ${r.hits.length} new row names in ${new Set(r.hits.map((h) => h.path)).size} files: say ${rule.sayAdded} · ${r.unread.length} changed files unread`);
  process.exitCode = r.ok ? 0 : 1;
}

function main() {
  const root = argOf("--root") ?? ROOT;
  if (process.argv.includes("--added-since")) {
    const base = argOf("--added-since");
    if (base === undefined || base.startsWith("--")) {
      console.error("check-retired-terms: FAIL · --added-since needs a base ref");
      process.exitCode = 1;
      return;
    }
    mainAdded(root, base);
    return;
  }
  const tree = readTrackedTree(root);
  if (process.argv.includes("--control")) {
    const { results, ok } = control(tree);
    for (const x of results) console.log(`plant ${x.what}: ${x.refused ? (x.passes ? "passed" : "refused") : x.passes ? "WRONGLY REFUSED" : "SLIPPED THROUGH"}`);
    console.log(ok ? "CONTROL PASS · every plant was refused, every must-pass change passed, every read has a plant" : "CONTROL FAIL");
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

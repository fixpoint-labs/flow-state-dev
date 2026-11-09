#!/usr/bin/env node
/**
 * FIX-2631 spec POC: the counts SPEC.md rests on, re-derived from the tree, and the
 * parser's cost. Throwaway evidence, not the guard. Run from the repository root:
 *
 *   node specs/issues/FIX-2631/poc/census/census.mjs [--list generics|prose|kept-prose]
 *   node specs/issues/FIX-2631/poc/census/census.mjs --control
 *
 * Needs `typescript` resolvable (after pnpm install), or TS_PATH=<dir holding node_modules/typescript>.
 *
 * Totality: every tracked file is read through the guard's own areas (`areaOf`); a file in
 * no area fails the run, as the guard does. Every in-scope code file is parsed and each
 * parse is counted, so "parsed N" is checked against "N in-scope code files".
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { areaOf, readTrackedTree } from "../../../../../scripts/check-retired-terms.mjs";
import { TREE_EXEMPTIONS } from "../../../../../docs/contributing/glossary.mjs";

const require = createRequire(join(process.env.TS_PATH ?? process.cwd(), "noop.js"));
const ts = require("typescript");

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const DOC = /\.(?:md|mdx)$/;
/** The paths whose Row words the glossary keeps (store adapters, UI list modules). */
const KEPT = TREE_EXEMPTIONS.filter((e) => e.path).map((e) => e.path);
const kept = (p) => KEPT.some((re) => re.test(p));
/** Published pages: changed only by /release-docs or a docs-fix PR. */
const PUBLISHED = /^apps\/docs\/(?:docs|guides|blog)\/|^apps\/docs\/sidebars|^packages\/[^/]+\/README\.md$/;

/** A name with `row` or `rows` as a camelCase or snake word part: row, rows, taskRow, rowId, TRow, ROW_ID. Not arrow, narrow. */
const isRowName = (n) => /(?:^|_)rows?(?:$|[A-Z_0-9])/.test(n) || /Rows?(?:$|[A-Z_0-9])/.test(n) || /(?:^|_)ROWS?(?:$|_)/.test(n);

/** The candidate prose phrases: a resource's own noun followed by row(s). */
const PROSE = /\b(?:subscription|schedule|poll|task|worker|project)(?:'s)?\s+rows?\b/i;

/** Every name a file declares, by declaration kind, with its 1-based line. */
function declaredNames(path, text) {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const add = (nameNode, kind) => {
    if (nameNode === undefined) return;
    if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
      out.push({ name: nameNode.text.replace(/^#/, ""), kind, line: sf.getLineAndCharacterOfPosition(nameNode.getStart(sf)).line + 1 });
    }
  };
  // At least every name the four regex Row matchers read: declared types (declaresRow), exported
  // values (exportsRow), export-list names and aliases (exportsRowInList), exported bindings
  // (exportsRowInPattern), plus the locals, parameters and properties this issue adds.
  const visit = (node) => {
    if (ts.isTypeParameterDeclaration(node)) add(node.name, "type-parameter");
    else if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) add(node.name, "type");
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) add(node.name, "local");
    else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) add(node.name, "local");
    else if (ts.isParameter(node) && ts.isIdentifier(node.name)) add(node.name, "parameter");
    else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) add(node.name, "local");
    else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) add(node.name, "local");
    // An import binds a new name only under an alias, a default or a namespace; `import { VersionedRow }` is a use.
    else if ((ts.isImportSpecifier(node) && node.propertyName !== undefined) || ts.isImportClause(node) || ts.isNamespaceImport(node)) add(node.name, "import");
    // `export { a as fooRow }` binds fooRow; a plain `export { FooRow } from` re-export is left, as exportsRowInList leaves it.
    else if (ts.isExportSpecifier(node) && (node.propertyName !== undefined || node.parent.parent.moduleSpecifier === undefined)) add(node.name, "export");
    else if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) add(node.name, "property");
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function run() {
  const tree = readTrackedTree(process.cwd());
  const unscoped = tree.paths.filter((p) => areaOf(p) === undefined);
  const code = [];
  const docs = [];
  for (const p of tree.paths) {
    const a = areaOf(p);
    if (a === undefined || !a.scope || !tree.files.has(p)) continue;
    if (CODE.test(p)) code.push(p);
    else if (DOC.test(p)) docs.push(p);
  }
  const t0 = performance.now();
  let parsed = 0;
  const generics = [];
  const decl = { kept: 0, other: 0, files: new Set(), keptFiles: new Set() };
  const byPkg = {};
  const byKind = {};
  for (const p of code) {
    const names = declaredNames(p, tree.files.get(p));
    parsed++;
    for (const d of names) {
      if (!isRowName(d.name)) continue;
      if (!kept(p)) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
      if (d.kind === "type-parameter") {
        if (!kept(p)) generics.push(`${p}:${d.line} ${d.name}`);
        continue;
      }
      if (kept(p)) {
        decl.kept++;
        decl.keptFiles.add(p);
      } else {
        decl.other++;
        decl.files.add(p);
        const k = p.split("/").slice(0, 2).join("/");
        byPkg[k] = (byPkg[k] ?? 0) + 1;
      }
    }
  }
  const parseMs = performance.now() - t0;
  const prose = [];
  for (const p of [...code, ...docs]) {
    tree.files.get(p).split("\n").forEach((l, i) => {
      if (PROSE.test(l)) prose.push({ p, line: i + 1, text: l.trim().slice(0, 140), published: PUBLISHED.test(p), kept: kept(p) });
    });
  }
  if (process.argv.includes("--list")) {
    const which = process.argv[process.argv.indexOf("--list") + 1];
    if (which === "generics") for (const g of generics) console.log(g);
    if (which === "prose") for (const x of prose.filter((y) => !y.kept)) console.log(`${x.p}:${x.line}${x.published ? " [published]" : ""}  ${x.text}`);
    if (which === "kept-prose") for (const x of prose.filter((y) => y.kept)) console.log(`${x.p}:${x.line}  ${x.text}`);
  }
  const files = (xs) => new Set(xs.map((x) => x.p)).size;
  const live = prose.filter((x) => !x.kept);
  console.log(`tracked ${tree.paths.length} · unscoped ${unscoped.length} · in-scope code ${code.length} · parsed ${parsed} · docs ${docs.length}`);
  console.log(`parse: ${parsed} files in ${(parseMs / 1000).toFixed(1)}s (${(parseMs / parsed).toFixed(2)} ms/file)`);
  console.log(`Row-named type parameters outside kept paths: ${generics.length}`);
  console.log(`row-word declarations (local/parameter/property): outside kept paths ${decl.other} in ${decl.files.size} files · in kept paths ${decl.kept} in ${decl.keptFiles.size} files`);
  console.log(`  by kind, outside kept paths: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`  by package:${Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`prose phrase lines outside kept paths: ${live.length} in ${files(live)} files (published ${live.filter((x) => x.published).length}, code ${live.filter((x) => CODE.test(x.p)).length}, other docs ${live.filter((x) => !x.published && DOC.test(x.p)).length}) · in kept paths ${prose.length - live.length}`);
  if (unscoped.length > 0 || parsed !== code.length) {
    console.error("TOTALITY FAIL");
    process.exitCode = 1;
  }
}

/** The syntax the regex Row-name guard needed four review rounds for, plus uses that must NOT count. */
function control() {
  const src = [
    "export { a as fooRow };", // 1 an export-list alias binds fooRow (exportsRowInList)
    "const { list: taskRows, ...restRow } = x;", // 2 destructuring, rename and rest
    "function f(/* lead */ row: T, [r2, rows] = []) {}", // 3 leading comment, array pattern, plural
    "class C { private row = 1; #rowId = 2; }", // 4 class fields, a private name
    "interface I { workerRow: string }", // 5 a property signature
    "function g<TRow extends object>() {}", // 6 a type parameter
    "for (const row of list) use(row);", // 7 for-of
    "const arrow = 1, narrow = 2, throwRow = 3;", // 8 arrow and narrow are not row words; throwRow is
    "use(entry.row); call({ row }); const s = 'row';", // 9 uses and a string: none count
    // The kinds the four regex Row matchers read, one plant each:
    "type FooRow = { id: string };", // 10 type alias (declaresRow)
    "interface BarRow { id: string }", // 11 interface (declaresRow)
    "enum BazRow { A }", // 12 enum (declaresRow)
    "const Q = class QuxRow {};", // 13 class expression (and its binding Q, not a row word)
    "export { a as fooRow };", // 14 export-list alias (exportsRowInList)
    "import { b as barRows } from './x'; import * as rowLib from './y';", // 15 aliased and namespace imports
    "import { VersionedRow } from './v'; export { FooRow } from './w';", // 16 a plain import and a plain re-export: uses
  ].join("\n");
  const got = declaredNames("zz.ts", src).filter((d) => isRowName(d.name)).map((d) => `${d.line}:${d.name}`);
  const want = ["1:fooRow", "2:taskRows", "2:restRow", "3:row", "3:rows", "4:row", "4:rowId", "5:workerRow", "6:TRow", "7:row", "8:throwRow", "10:FooRow", "11:BarRow", "12:BazRow", "13:QuxRow", "14:fooRow", "15:barRows", "15:rowLib"];
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`got  ${got.join(" ")}\nwant ${want.join(" ")}`);
  const proseOk = PROSE.test("the subscription row is deleted") && PROSE.test("each task's rows") && !PROSE.test("a table row of tasks") && !PROSE.test("a row in the UI");
  console.log(ok && proseOk ? "CONTROL PASS" : "CONTROL FAIL");
  process.exitCode = ok && proseOk ? 0 : 1;
}

if (process.argv.includes("--control")) control();
else run();

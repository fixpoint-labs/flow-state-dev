#!/usr/bin/env node
/**
 * FIX-1239 type-assertion census — re-derives the spec's counted facts from the tree.
 *
 * A type-level assertion is a line whose only job is to fail compilation when a type is
 * wrong. Three idioms exist under `packages/`:
 *   - `expect`    — a vitest `expectTypeOf(...)…matcher()` chain, or `assertType<T>(v)`
 *   - `directive` — a `// @ts-expect-error` comment
 *   - `alias`     — a hand-rolled identity helper: a local `type X<T extends C> = T` where C is
 *                   `true` (`Assert`, `Expect`, `IsTrue`), `false` (`IsFalse`) or `never`
 *                   (`AssertNever`, `NoneOf`)
 *
 * For every site it answers three questions:
 *   1. compiled today?  Is the file in a program the package's `typecheck` script runs?
 *      (scripts/typecheck.mjs → tsconfig.json; every `tsc -p <cfg>` in the script)
 *   2. compiled after FIX-1343?  Is it in the program #3433 proposes — the package's
 *      tsconfig.json widened to `src/**` + its test dirs, no emit, rootDir at the repo root.
 *   3. can it fail?  The site is NEGATED in memory and the after-program is checked again.
 *      A site is `live` when the negation produces a new error inside the site's own lines,
 *      and `vacuous` when the negated claim compiles just as cleanly as the original, or when
 *      the subject is `any` (it then passes whatever type the assertion names).
 *        expect    → toggle `.not` before the final matcher; `assertType<T>` → `assertType<never>`
 *        directive → remove the directive; live means the next line then errors
 *        alias     → `X<E>` → `X<[E] extends [C] ? W : C>`, W a type that is not C:
 *                    `true`→`false`, `false`→`true`, `never`→`true`
 *      A directive that is reported unused (TS2578) in the baseline is `dead`; an expect or alias
 *      site that already errors in the baseline is `failing` — the claim is false today.
 *
 * Nothing is written to disk: mutations are served through a compiler host. Dependencies
 * resolve through project references to their built `dist`, as in CI, so run it after
 * `pnpm packages:build`. One package is checked at a time; only files that hold a site are
 * semantically checked.
 *
 * Totality: every tracked .ts/.tsx/.mts file in the package is scanned; a site in a file that
 * neither program opens is reported, never skipped.
 *
 * Negative control (`--plant`): adds a virtual test file to the first `--only` package holding
 * one assertion of each kind that must be live (an alias of each pinned constraint), one that must be vacuous, one dead directive,
 * and the same wrong assertion in a file outside every program. The run fails unless each is
 * classified as planted. A census that has never been seen to call something vacuous is not
 * evidence that nothing is.
 *
 * Usage (repo root, after `pnpm install && pnpm packages:build`):
 *   node specs/issues/FIX-1239/poc/type-assertion-census/census.mjs [--only a,b] [--json] [--plant]
 * Its result on main at 4f2e13ed is recorded beside it in SETTLED.md, which is the
 * authoritative record; implementers do not re-run this as a gate.
 * Retained spec evidence; not part of any package, test glob, or build.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));
const ts = require("typescript");

const args = process.argv.slice(2);
const only = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? args[i + 1].split(",") : null;
})();
const asJson = args.includes("--json");
const plant = args.includes("--plant");

const TEST_DIR = /^(test|tests|__tests__)\//;
const DEFERRED_BY_1343 = new Set(["workforce"]);
const SRC_EXT = /\.(ts|tsx|mts)$/;
/** "declared but never used" — an assertion alias is never read, so these say nothing about it. */
const UNUSED = new Set([6133, 6196, 6198, 6205]);

// ── site discovery ─────────────────────────────────────────────────────────

/** The constraint an identity helper pins, mapped to a type that violates it. */
function pinned(c) {
  if (c?.kind === ts.SyntaxKind.NeverKeyword) return { pin: "never", wrong: "true" };
  if (c?.kind === ts.SyntaxKind.LiteralType && c.literal.kind === ts.SyntaxKind.TrueKeyword) return { pin: "true", wrong: "false" };
  if (c?.kind === ts.SyntaxKind.LiteralType && c.literal.kind === ts.SyntaxKind.FalseKeyword) return { pin: "false", wrong: "true" };
  return null;
}

/** Local `type X<T extends true | false | never> = T` aliases — the hand-rolled assertion helpers. */
function assertAliases(sf) {
  const names = new Map();
  sf.forEachChild(function walk(n) {
    const p = ts.isTypeAliasDeclaration(n) && n.typeParameters?.length === 1 ? pinned(n.typeParameters[0].constraint) : null;
    if (p && ts.isTypeReferenceNode(n.type) && n.type.typeName.getText(sf) === n.typeParameters[0].name.text) names.set(n.name.text, p);
    n.forEachChild(walk);
  });
  return names;
}

const line = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line;

/** Every assertion site in one file, each with the text edit that negates it. */
function findSites(sf) {
  const sites = [];
  const text = sf.text;
  const aliases = assertAliases(sf);
  const stmtOf = (n) => {
    while (n.parent && !ts.isSourceFile(n.parent) && !ts.isBlock(n.parent) && !ts.isModuleBlock(n.parent)) n = n.parent;
    return n;
  };
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "expectTypeOf") {
      let top = n;
      while (
        top.parent &&
        ((ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) ||
          (ts.isCallExpression(top.parent) && top.parent.expression === top))
      )
        top = top.parent;
      if (ts.isCallExpression(top) && ts.isPropertyAccessExpression(top.expression) && top !== n) {
        const matcher = top.expression;
        const inner = matcher.expression;
        const stmt = stmtOf(top);
        const edit =
          ts.isPropertyAccessExpression(inner) && inner.name.text === "not"
            ? { start: inner.name.getStart(sf) - 1, end: inner.end, text: "" } // drop `.not`
            : { start: matcher.name.getStart(sf) - 1, end: matcher.name.getStart(sf) - 1, text: ".not" };
        sites.push({ kind: "expect", subject: n, from: line(sf, stmt.getStart(sf)), to: line(sf, stmt.end), edit, label: matcher.name.text });
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "assertType" && n.typeArguments?.length === 1) {
      const ta = n.typeArguments[0];
      const stmt = stmtOf(n);
      sites.push({ kind: "expect", subject: n.arguments[0], from: line(sf, stmt.getStart(sf)), to: line(sf, stmt.end), edit: { start: ta.getStart(sf), end: ta.end, text: "never" }, label: "assertType" });
    }
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && aliases.has(n.typeName.text) && n.typeArguments?.length === 1) {
      const e = n.typeArguments[0];
      const { pin, wrong } = aliases.get(n.typeName.text);
      const stmt = stmtOf(n);
      sites.push({
        kind: "alias",
        subject: e,
        from: line(sf, stmt.getStart(sf)),
        to: line(sf, stmt.end),
        edit: { start: e.getStart(sf), end: e.end, text: `[${e.getText(sf)}] extends [${pin}] ? ${wrong} : ${pin}` },
        label: n.typeName.text,
      });
    }
    n.forEachChild(visit);
  };
  sf.forEachChild(visit);
  // Real comments only: a `@ts-expect-error` inside a string (a lint test's fixture) is not a site.
  const comments = new Map();
  const collect = (n) => {
    for (const r of [...(ts.getLeadingCommentRanges(text, n.pos) ?? []), ...(ts.getTrailingCommentRanges(text, n.end) ?? [])]) comments.set(r.pos, r);
    n.forEachChild(collect);
  };
  collect(sf);
  for (const r of comments.values()) {
    const m = /^\/[/*]\s*@ts-expect-error\b(.*)$/m.exec(text.slice(r.pos, r.end));
    if (!m) continue;
    const pos = r.pos;
    const l = line(sf, pos);
    const at = pos + m[0].indexOf("@ts-expect-error");
    // The directive covers the first line after it that is not itself a comment line, so a
    // reason that wraps onto a second `//` line moves the covered line down.
    const lines = text.split("\n");
    let covered = l + 1;
    while (covered < lines.length && /^\s*\/\//.test(lines[covered])) covered++;
    sites.push({
      kind: "directive",
      from: l,
      to: covered,
      // Misspelling the directive turns it into a plain comment, which removes it without shifting lines.
      edit: { start: at, end: at + "@ts-expect-error".length, text: "@ts-expect-errxr" },
      label: m[1].replace(/\*\/\s*$/, "").replace(/^[\s:—–-]+/, "").trim() ? "described" : "bare",
    });
  }
  return sites;
}

// ── programs ───────────────────────────────────────────────────────────────

function parseConfig(dir, json, name) {
  const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} };
  const parsed = ts.parseJsonConfigFileContent(json, host, dir, undefined, join(dir, name));
  return parsed;
}

function readConfig(dir, name) {
  const r = ts.readConfigFile(join(dir, name), ts.sys.readFile);
  return r.error ? null : parseConfig(dir, r.config, name);
}

/** The configs the package's `typecheck` script compiles today. */
function todayConfigs(pkg) {
  const script = pkg.scripts?.typecheck ?? "";
  const cfgs = new Set();
  if (/typecheck\.mjs/.test(script) || /\btsc --noEmit\b/.test(script) || /\btsc -b\b/.test(script)) cfgs.add("tsconfig.json");
  for (const m of script.matchAll(/\btsc\b[^&]*?-p\s+(\S+)/g)) cfgs.add(m[1]);
  return [...cfgs];
}

/** The program FIX-1343 (#3433) proposes: tsconfig.json widened to src + tests, no emit. */
function afterConfig(dir, testDirs) {
  return parseConfig(
    dir,
    {
      extends: "./tsconfig.json",
      compilerOptions: { composite: false, incremental: false, rootDir: "../..", noEmit: true, declaration: false, declarationMap: false, sourceMap: false },
      include: ["src/**/*", ...testDirs.map((d) => `${d}/**/*`)],
      exclude: ["node_modules", "dist"],
    },
    "tsconfig.fix1239-census.json"
  );
}

function check(parsed, overrides, files, oldProgram) {
  const host = ts.createCompilerHost(parsed.options, true);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onErr, fresh) => {
    const o = overrides.get(resolve(f));
    return o !== undefined ? ts.createSourceFile(f, o, lang, true) : orig(f, lang, onErr, fresh);
  };
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => overrides.has(resolve(f)) || origExists(f);
  const origRead = host.readFile.bind(host);
  host.readFile = (f) => overrides.get(resolve(f)) ?? origRead(f);
  const roots = [...new Set([...parsed.fileNames, ...overrides.keys()])];
  const program = ts.createProgram({ rootNames: roots, options: parsed.options, host, projectReferences: parsed.projectReferences, oldProgram });
  const diags = new Map();
  for (const f of files) {
    const sf = program.getSourceFile(f);
    if (!sf) continue;
    const ds = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    diags.set(f, ds.filter((d) => d.start !== undefined).map((d) => ({ line: line(sf, d.start), code: d.code })));
  }
  return { program, diags };
}

// ── census ─────────────────────────────────────────────────────────────────

const PLANT = `import { expectTypeOf, assertType } from "vitest";
type Assert<T extends true> = T;
type AssertNever<T extends never> = T;
type IsFalse<T extends false> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
declare const anything: any;
// census:live
expectTypeOf<string>().toEqualTypeOf<string>();
// census:live
type _ok = Assert<Equal<1, 1>>;
// census:live
type _none = AssertNever<Extract<"a" | "b", "c">>;
// census:live
type _no = IsFalse<Equal<1, 2>>;
// census:vacuous — any satisfies a match in both directions
expectTypeOf(anything).toMatchTypeOf<{ a: 1 }>();
// census:dead
// @ts-expect-error nothing on the next line is an error
export const fine: number = 1;
// census:live
// @ts-expect-error a string is not a number
export const wrong: number = "x";
// census:failing — the claim is false, and only a compiled file says so
expectTypeOf<string>().toEqualTypeOf<number>();
`;

function census(name, planted) {
  const dir = join(ROOT, "packages", name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const tracked = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx", "*.mts"], { cwd: dir, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.endsWith(".d.ts") && SRC_EXT.test(f));
  const overrides = new Map();
  if (planted) {
    overrides.set(resolve(dir, "test/__fix1239_plant__.test.ts"), PLANT);
    overrides.set(resolve(dir, "scripts/__fix1239_plant_outside__.ts"), "import { expectTypeOf } from \"vitest\";\n// census:outside\nexpectTypeOf<string>().toEqualTypeOf<number>();\n");
  }
  const files = [...tracked.map((f) => resolve(dir, f)), ...overrides.keys()];
  const text = (f) => overrides.get(f) ?? readFileSync(f, "utf8");

  const perFile = new Map();
  for (const f of files) {
    const t = text(f);
    if (!/expectTypeOf|assertType|@ts-expect-error|extends (true|false|never)>/.test(t)) continue;
    const sf = ts.createSourceFile(f, t, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const sites = findSites(sf);
    if (sites.length) perFile.set(f, { sf, sites });
  }
  if (perFile.size === 0) return { name, sites: [] };

  const today = new Set(todayConfigs(pkg).flatMap((c) => readConfig(dir, c)?.fileNames ?? []).map((f) => resolve(f)));
  const testDirs = [...new Set(tracked.filter((f) => TEST_DIR.test(f)).map((f) => f.split("/")[0]))];
  if (planted && !testDirs.includes("test")) testDirs.push("test");
  const after = afterConfig(dir, testDirs);
  const afterFiles = new Set(after.fileNames.map((f) => resolve(f)));
  for (const f of overrides.keys()) if (f.includes("/test/")) afterFiles.add(f);

  const checked = [...perFile.keys()].filter((f) => afterFiles.has(f));
  const base = check(after, new Map([...overrides].filter(([f]) => afterFiles.has(f))), checked);
  const checker = base.program.getTypeChecker();

  const mutated = new Map([...overrides].filter(([f]) => afterFiles.has(f)));
  for (const f of checked) {
    const { sf, sites } = perFile.get(f);
    let t = sf.text;
    for (const s of [...sites].sort((a, b) => b.edit.start - a.edit.start)) t = t.slice(0, s.edit.start) + s.edit.text + t.slice(s.edit.end);
    mutated.set(f, t);
  }
  const mut = check(after, mutated, checked, base.program);

  const out = [];
  for (const [f, { sf, sites }] of perFile) {
    const rel = f.slice(dir.length + 1);
    const inAfter = afterFiles.has(f);
    const b = base.diags.get(f) ?? [];
    const m = mut.diags.get(f) ?? [];
    const progSf = base.program.getSourceFile(f);
    for (const s of sites) {
      const inSpan = (d) => d.line >= s.from && d.line <= s.to;
      let verdict = "not-compiled";
      let anySubject = false;
      let already = [];
      if (inAfter) {
        const bs = b.filter(inSpan);
        already = [...new Set(bs.filter((d) => d.code !== 2578).map((d) => `TS${d.code}`))];
        const ms = m.filter(inSpan);
        if (s.kind === "directive" && bs.some((d) => d.code === 2578)) verdict = "dead";
        else if (s.kind !== "directive" && bs.some((d) => !UNUSED.has(d.code))) verdict = "failing";
        else {
          const key = (d) => `${d.line}:${d.code}`;
          const before = new Set(bs.map(key));
          verdict = ms.some((d) => !before.has(key(d))) ? "live" : "vacuous";
        }
        if (s.kind === "directive" && verdict === "live") s.suppresses = [...new Set(ms.filter((d) => d.line === s.to).map((d) => `TS${d.code}`))];
        if (s.subject && progSf) {
          const node = findNodeAt(progSf, s.subject.getStart(sf), s.subject.end);
          const tnode = node && ts.isCallExpression(node) ? (node.typeArguments?.[0] ?? node.arguments[0]) : node;
          if (tnode) {
            const ty = ts.isTypeNode(tnode) ? checker.getTypeFromTypeNode(tnode) : checker.getTypeAtLocation(tnode);
            anySubject = !!(ty.flags & ts.TypeFlags.Any);
          }
        }
        // An assertion about `any` passes whatever type it names: the negation may still error,
        // but deleting the asserted member never will. It cannot fail when the type is wrong.
        if (anySubject && verdict === "live") verdict = "vacuous";
      }
      out.push({
        file: rel,
        line: s.from + 1,
        kind: s.kind,
        label: s.label,
        compiledToday: today.has(f),
        compiledAfter: inAfter,
        deferredBy1343: DEFERRED_BY_1343.has(name) && !today.has(f),
        verdict,
        anySubject,
        suppresses: s.suppresses,
        already,
        planted: planted ? (sf.text.split("\n")[s.from - 1]?.match(/census:(\w+)/)?.[1] ?? sf.text.split("\n")[s.from - 2]?.match(/census:(\w+)/)?.[1]) : undefined,
      });
    }
  }
  return { name, sites: out };
}

function findNodeAt(sf, start, end) {
  let found;
  (function walk(n) {
    if (n.getStart(sf) === start && n.end === end) found = n;
    if (!found && n.pos <= start && n.end >= end) n.forEachChild(walk);
  })(sf);
  return found;
}

// ── main ───────────────────────────────────────────────────────────────────

const names = execFileSync("git", ["ls-files", "packages/*/package.json"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .map((p) => p.split("/")[1])
  .filter((n) => !only || only.includes(n));

if (plant) {
  if (!only || only.length !== 1) {
    console.error("census: --plant needs exactly one package in --only");
    process.exit(2);
  }
  const r = census(only[0], true);
  const plantedSites = r.sites.filter((s) => s.file.includes("__fix1239_plant"));
  const want = { live: "live", failing: "failing", vacuous: "vacuous", dead: "dead", outside: "not-compiled" };
  let ok = plantedSites.length === 9;
  for (const s of plantedSites) {
    const good = want[s.planted] === s.verdict;
    ok &&= good;
    console.log(`  ${good ? "ok  " : "FAIL"} planted ${s.planted.padEnd(8)} ${s.kind.padEnd(9)} → ${s.verdict}${s.anySubject ? " (any subject)" : ""}  ${s.file}:${s.line}`);
  }
  console.log(`negative control on ${only[0]}: ${plantedSites.length}/9 planted sites found · ${ok ? "PASS (the census tells live from failing, vacuous, dead and uncompiled)" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

const all = [];
for (const n of names) {
  const t0 = Date.now();
  const r = census(n, false);
  all.push(...r.sites.map((s) => ({ pkg: n, ...s })));
  if (!asJson && r.sites.length) process.stderr.write(`  ${n}: ${r.sites.length} sites (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}

if (asJson) {
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}

const count = (p) => all.filter(p).length;
const pkgs = [...new Set(all.map((s) => s.pkg))];
console.log("| package | sites | expect · directive · alias | compiled today | compiled after FIX-1343 | live | failing | vacuous | dead | any-subject |");
console.log("|---|---:|---|---:|---:|---:|---:|---:|---:|---:|");
for (const p of pkgs) {
  const s = all.filter((x) => x.pkg === p);
  const k = (kind) => s.filter((x) => x.kind === kind).length;
  const v = (verdict) => s.filter((x) => x.verdict === verdict).length;
  console.log(
    `| ${p} | ${s.length} | ${k("expect")} · ${k("directive")} · ${k("alias")} | ${s.filter((x) => x.compiledToday).length} | ${s.filter((x) => x.compiledAfter).length} | ${v("live")} | ${v("failing")} | ${v("vacuous")} | ${v("dead")} | ${s.filter((x) => x.anySubject).length} |`
  );
}
console.log(
  `\n${all.length} sites in ${pkgs.length} packages · ${count((s) => !s.compiledToday)} not compiled by today's typecheck · ` +
    `${count((s) => !s.compiledAfter)} not compiled after FIX-1343 · ${count((s) => s.verdict === "live")} live · ${count((s) => s.verdict === "failing")} failing · ` +
    `${count((s) => s.verdict === "vacuous")} vacuous · ${count((s) => s.verdict === "dead")} dead · ${count((s) => s.anySubject)} with an any subject`
);
const notable = all.filter((s) => s.verdict !== "live" || s.anySubject || !s.compiledToday || s.already?.length);
console.log("\n| site | kind | today | after | verdict | note |");
console.log("|---|---|---|---|---|---|");
for (const s of notable)
  console.log(
    `| ${s.pkg}/${s.file}:${s.line} | ${s.kind} ${s.label} | ${s.compiledToday ? "yes" : "no"} | ${s.compiledAfter ? (s.deferredBy1343 ? "deferred" : "yes") : "no"} | ${s.verdict} | ${[s.anySubject ? "any subject" : "", s.suppresses?.length ? `suppresses ${s.suppresses.join(",")}` : "", s.already?.length ? `already errors ${s.already.join(",")}` : ""].filter(Boolean).join(" · ")} |`
  );

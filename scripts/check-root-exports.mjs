#!/usr/bin/env node
/**
 * The export check: a published package's root may not gain a name nobody outside the
 * framework uses, and adopter code may not gain an import of any `/internal` path.
 *
 * A package root (`@flow-state-dev/<pkg>`, the `"."` entry) is the surface an adopter
 * autocompletes. A root name is USED when (FIX-2448 D1, the epic's ER-1 reading):
 *   adopter   a file under `apps/` (not `apps/docs/` or `apps/devtool/`), `examples/` or
 *             `labs/` imports it from the root, in any import form;
 *   docs      a docs-site file (`apps/docs/`) imports it from the root;
 *   readme    the package's README names it in code form (backticked, as a call `name(`, or in
 *             an import's brace list; a bare word in prose doesn't count), or a pending
 *             changeset whose `Docs:` line lists that README does (README prose is written at
 *             release from the changeset, docs/contributing/release-docs.md, so the changeset
 *             is the PR's README line);
 *   reached   a used name's declaration names it in a type position (`Foo`, `typeof foo`),
 *             followed to a fixpoint: the adopter meets it through a signature.
 * Anything else FAILS: only our own packages, goals or scripts import it, or nothing does.
 * A name only our packages share belongs on the package's `/internal` subpath.
 *
 * It is a ratchet, not a cleanup. It compares the tree with a base commit, read in place
 * through `gitReader` (no baseline file a diff could edit), and fails only on what is new:
 *   - a failing root name the base did not have failing, for any cause (new on the root, a
 *     newly published package, or its last adopter import or README line removed);
 *   - an adopter or docs file importing an `/internal` path that the base did not.
 * Every published root is read, every PR. Names that already fail are their owners' to rule
 * on (FIX-2448 for core; FIX-2568 / FIX-2569 for the roots no epic child owns).
 *
 * It also lists, without failing, each name a README or changeset mention is the only thing
 * clearing where the base did not clear it that way (a new export the README already named
 * counts too), so the reviewer reads that mention as the ruling it is. Names reached from such a
 * name are not listed separately: a type a documented signature names is met through it, and
 * the reviewer rules on the signature.
 *
 * It also holds one name to one meaning (FIX-2449 D2). Across every published root, and every
 * public entry of the six foundation packages (contracts, core, engine, client, react, testing),
 * no two entries may export one name from different declarations: an adopter who imports both
 * would see two things under one name. One declaration re-exported from several entries is
 * fine; a type alias of it is a second declaration and collides. `/internal` entries and entries
 * the package does not publish are out of scope. The ratchet fails a collision the base lacks;
 * `check-collisions.mjs` runs it strict, for the adopter goal's `surface.collisions` cell.
 *
 * A name is keyed by package and name, so one renamed or moved to another package reads as new.
 * CI compares with `HEAD^1` of the PR's merge commit; the local default is the merge base with
 * `origin/main`, which can differ when `origin/main` is stale, so a local PASS is not CI's answer.
 *
 * Reach is read from source, not from emitted declarations, so it approximates the
 * compiler's; base and head are read by the same rule, so the ratchet compares like with like.
 *
 *   node scripts/check-root-exports.mjs [base-ref]   # default: merge base with origin/main, else HEAD^1
 *   node scripts/check-root-exports.mjs --list [pkg] # every failing root name today, by package
 *
 * Its plants are in `scripts/root-exports.test.mjs` (`node --test`).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { importCensus, isInternalSubpath } from "./import-census.mjs";
import { fsReader, gitReader, packageEntryExports } from "./mechanism-exports.mjs";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

const escape = (s) => s.replace(/[$]/g, "\\$");
/**
 * Whether README text names `name` in code form: inside backticks (`` `name` ``, `` `name(opts)` ``),
 * as a call (`name(`), or in an import's brace list. A bare word in prose does not count, or a
 * common name (`run`, `state`, `client`) would clear on a sentence that was never about it.
 */
const names = (text, name) => {
  const n = escape(name);
  const end = String.raw`(?![\w$])`;
  return new RegExp([
    "`" + n + end + "[^`\\n]*`",
    String.raw`(?<![\w$.])` + n + String.raw`\(`,
    String.raw`\bimport\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{[^}]*(?<![\w$])` + n + end + String.raw`[^}]*\}\s*from\b`,
  ].join("|")).test(text);
};

/** Published (not `private`) packages: name → directory under `packages/`. */
function publishedPackages(read) {
  const out = new Map();
  for (const dir of read.packageDirs()) {
    const text = read(`packages/${dir}/package.json`);
    if (!text) continue;
    const pkg = JSON.parse(text);
    if (!pkg.private) out.set(pkg.name, dir);
  }
  return out;
}

/** The foundation packages whose every public entry, not only the root, is in the collision scope. */
export const FOUNDATION = ["contracts", "core", "engine", "client", "react", "testing"].map((p) => `@flow-state-dev/${p}`);

/**
 * Every collision in scope: name → [{ entry, file, decl }], one per entry exporting it, for each
 * name two entries export from different declarations (`file#decl`). Scope: every published
 * root, and every public entry of a {@link FOUNDATION} package, which excludes `/internal`
 * entries and any entry missing from the package's `publishConfig.exports`.
 * Reads only package files, so it runs on any tree, git checkout or not.
 */
export function collisions(read, entries = packageEntryExports(read)) {
  const owners = new Map();
  for (const [pkg, dir] of publishedPackages(read)) {
    const { publishConfig } = JSON.parse(read(`packages/${dir}/package.json`));
    const published = publishConfig?.exports
      ? Object.keys(publishConfig.exports).map((k) => new RegExp(`^${k.replace(/[.]/g, "\\.").replace("*", ".+")}$`))
      : null;
    for (const [sub, names] of entries.get(pkg) ?? []) {
      if (sub !== "." && (!FOUNDATION.includes(pkg) || isInternalSubpath(sub))) continue;
      if (published && !published.some((re) => re.test(sub))) continue;
      const entry = sub === "." ? pkg : `${pkg}${sub.slice(1)}`;
      for (const [name, { file, decl }] of names) {
        if (!owners.has(name)) owners.set(name, []);
        owners.get(name).push({ entry, file, decl: decl ?? name });
      }
    }
  }
  const out = new Map();
  for (const [name, list] of [...owners].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(list.map((e) => `${e.file}#${e.decl}`)).size > 1) out.set(name, list);
  }
  return out;
}

/** Pending changesets' text, keyed by each README its `Docs:` line lists. */
function changesetDocs(read) {
  const byReadme = new Map();
  for (const f of read.tracked()) {
    if (!/^\.changeset\/[^/]+\.md$/.test(f) || f.endsWith("/README.md")) continue;
    const text = read(f);
    if (text == null) continue;
    for (const [, line] of text.matchAll(/^Docs:(.*)$/gm)) {
      for (const [readme] of line.matchAll(/packages\/[^/\s,()]+\/README\.md/g)) {
        byReadme.set(readme, (byReadme.get(readme) ?? "") + "\n" + text);
      }
    }
  }
  return byReadme;
}

/**
 * The declarations a declaration mentions in type positions, function bodies skipped, each as
 * `file#name` (the file and name it is declared under). A mention resolves to this file's own
 * declaration or through this file's import of it; one that resolves to neither (a global, a
 * third-party type) names no root export. Memoized per reader.
 */
function typeMentions(read, memo, resolve, file, name) {
  const key = `${file}#${name}`;
  if (memo.has(key)) return memo.get(key);
  const out = new Set();
  memo.set(key, out);
  const text = read(file);
  if (text == null) return out;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const declared = (st) =>
    ts.isVariableStatement(st) ? st.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name.text : "")) : [st.name?.text];
  const local = new Set(sf.statements.flatMap(declared));
  const imported = new Map(); // local name → [specifier, imported name]
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const spec = st.moduleSpecifier.text;
    const b = st.importClause?.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) imported.set(el.name.text, [spec, (el.propertyName ?? el.name).text]);
    if (st.importClause?.name) imported.set(st.importClause.name.text, [spec, "default"]);
  }
  const identity = (m) => {
    if (local.has(m)) return `${file}#${m}`;
    const via = imported.get(m);
    const found = via && resolve(file, via[0], via[1]);
    return found ? `${found.file}#${found.decl ?? via[1]}` : null;
  };
  const walk = (n) => {
    if ((ts.isFunctionLike(n) || ts.isClassStaticBlockDeclaration(n)) && n.body) {
      for (const c of [n.typeParameters, n.parameters, n.type].flat().filter(Boolean)) walk(c);
      return;
    }
    const ref = ts.isTypeReferenceNode(n) ? n.typeName : ts.isExpressionWithTypeArguments(n) ? n.expression : ts.isTypeQueryNode(n) ? n.exprName : null;
    const id = ref && identity(ref.getText(sf).split(".")[0]);
    if (id) out.add(id);
    ts.forEachChild(n, walk);
  };
  for (const st of sf.statements) if (declared(st).includes(name)) walk(st);
  return out;
}

/**
 * Every published root's names and why each passes or fails, read through `read`.
 *
 * Returns `{ roots, internalImports, collisions }`:
 *   collisions       name → [{ entry, file, decl }], from {@link collisions}
 *   roots            package → Map(name → { file, why }), `why` one of
 *                    "adopter" | "docs" | "readme" | "reached" | "failing"
 *   internalImports  [{ file, spec, form }] from the import census
 */
export function rootReport(read) {
  const published = publishedPackages(read);
  const entries = packageEntryExports(read);
  const { uses, internalImports } = importCensus(read);
  const pending = changesetDocs(read);
  const memo = new Map();
  const roots = new Map();
  for (const [pkg, dir] of [...published].sort(([a], [b]) => a.localeCompare(b))) {
    const exp = entries.get(pkg)?.get(".") ?? new Map();
    const readmePath = `packages/${dir}/README.md`;
    const readme = (read(readmePath) ?? "") + (pending.get(readmePath) ?? "");
    const out = new Map();
    const declOf = new Map();
    const rootNames = new Map(); // `file#declared name` → the root names it is published as
    for (const [name, { file, decl }] of exp) {
      const u = uses.get(pkg)?.get(name);
      const why = u?.has("adopter") ? "adopter" : u?.has("docs") ? "docs" : names(readme, name) ? "readme" : "failing";
      out.set(name, { file, why });
      declOf.set(name, decl ?? name);
      const id = `${file}#${decl ?? name}`;
      rootNames.set(id, [...(rootNames.get(id) ?? []), name]);
    }
    // A name a used name's declaration mentions is met through that signature. Both ends go by
    // declaration, not by root name: an aliased re-export renames either one, and an unrelated
    // root name that only shares the bare name is not reached.
    const queue = [...out].filter(([, v]) => v.why !== "failing").map(([n]) => n);
    while (queue.length) {
      const n = queue.pop();
      for (const id of typeMentions(read, memo, entries.resolve, out.get(n).file, declOf.get(n))) {
        for (const m of rootNames.get(id) ?? []) {
          if (out.get(m).why === "failing") { out.get(m).why = "reached"; queue.push(m); }
        }
      }
    }
    roots.set(pkg, out);
  }
  return { roots, internalImports, collisions: collisions(read, entries) };
}

const failing = (report) =>
  new Set([...report.roots].flatMap(([pkg, m]) => [...m].filter(([, v]) => v.why === "failing").map(([n]) => `${pkg}\t${n}`)));
const internalKey = (i) => `${i.file}\t${i.spec}`;

/**
 * Compare a head report with a base report. Returns
 * `{ newFailing: [{ pkg, name, file }], newInternal: [{ file, spec, form }], readmeCleared: [{ pkg, name }],
 *   newCollisions: [{ name, entries }] }`; a collision is new when the base has none under that name.
 * `readmeCleared` is advisory: a name a README or changeset mention is the only thing clearing,
 * where the base did not clear it that way (the mention itself may predate the change).
 */
export function compare(base, head) {
  const was = failing(base);
  const newFailing = [];
  const readmeCleared = [];
  for (const [pkg, m] of head.roots) {
    for (const [name, { file, why }] of m) {
      if (why === "failing" && !was.has(`${pkg}\t${name}`)) newFailing.push({ pkg, name, file });
      if (why === "readme" && base.roots.get(pkg)?.get(name)?.why !== "readme") readmeCleared.push({ pkg, name });
    }
  }
  const had = new Set(base.internalImports.map(internalKey));
  const newInternal = head.internalImports.filter((i) => !had.has(internalKey(i)));
  const newCollisions = [...head.collisions].filter(([name]) => !base.collisions.has(name)).map(([name, entries]) => ({ name, entries }));
  return { newFailing, newInternal, readmeCleared, newCollisions };
}

/** One collision as a line: the name, then each declaration and the entries that export it. */
export function describeCollision(name, entries) {
  const byDecl = new Map();
  for (const e of entries) {
    const at = e.decl === name ? e.file : `${e.file} as ${e.decl}`;
    byDecl.set(at, [...(byDecl.get(at) ?? []), e.entry]);
  }
  return `\`${name}\` means different things: ${[...byDecl].map(([at, on]) => `${at} (on ${on.join(", ")})`).join(" and ")}.`;
}

/** The ratchet's verdict as printable lines; `ok` is false when anything is new. */
export function render({ newFailing, newInternal, readmeCleared, newCollisions = [] }) {
  const out = [];
  for (const { pkg, name, file } of newFailing) {
    out.push(`${pkg}: \`${name}\` (${file}) is on the root, and no app, example, lab or docs page imports it and the README doesn't name it.`);
  }
  if (newFailing.length) {
    out.push("  A name only FSD packages use belongs on the package's /internal subpath. A name adopters need is imported by an app or");
    out.push("  documented: a `Docs:` line in the PR's changeset naming the package README, with the name in the fragment. Otherwise stop exporting it.");
  }
  for (const { name, entries } of newCollisions) out.push(describeCollision(name, entries));
  if (newCollisions.length) {
    out.push("  One meaning declared twice: declare it once and re-export it (in contracts for a wire shape). Two meanings: rename the side an app author doesn't import.");
  }
  for (const { file, spec, form } of newInternal) out.push(`${file}: ${form} of ${spec}. /internal paths are for FSD's own packages; use a public entry.`);
  if (readmeCleared.length) {
    out.push(`Cleared only by a README or changeset mention, with no import (for the reviewer, not a failure; check the mention documents the name):`);
    for (const { pkg, name } of readmeCleared) out.push(`  ${pkg}: ${name}`);
  }
  return { ok: newFailing.length === 0 && newInternal.length === 0 && newCollisions.length === 0, lines: out };
}

function defaultBase() {
  const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try { return git(["merge-base", "HEAD", "origin/main"]); } catch { return "HEAD^1"; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    const only = args.find((a) => !a.startsWith("--"));
    const { roots, internalImports } = rootReport(fsReader(ROOT));
    for (const [pkg, m] of roots) {
      if (only && pkg !== only && pkg !== `@flow-state-dev/${only}`) continue;
      const fails = [...m].filter(([, v]) => v.why === "failing").map(([n]) => n).sort();
      console.log(`${pkg.padEnd(34)} ${String(m.size).padStart(4)} names · ${String(fails.length).padStart(4)} failing${only ? `\n  ${fails.join(" ")}` : ""}`);
    }
    console.log(`/internal imports from adopter or docs code: ${internalImports.length}`);
    for (const i of internalImports) console.log(`  ${i.file}: ${i.form} of ${i.spec}`);
    process.exit(0);
  }
  const ref = args[0] ?? defaultBase();
  const result = render(compare(rootReport(gitReader(ROOT, ref)), rootReport(fsReader(ROOT))));
  for (const l of result.lines) console.log(l);
  console.log(result.ok ? `PASS: no published root gained a failing name or a collision, and no adopter code gained an /internal import since ${ref}` : `FAIL: against ${ref}`);
  process.exit(result.ok ? 0 : 1);
}

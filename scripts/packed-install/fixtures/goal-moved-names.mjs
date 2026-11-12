/**
 * Runs inside the consumer project for `closure.j5:moved-name-named`: the
 * upgrade journey's facts, read through the TypeScript compiler (most moved
 * names are types, which a runtime import cannot see). It does not grade; the
 * changelog rule is `gradeMovedNames` in goal.mjs.
 *
 * Inputs, from the environment:
 *   FSD_J5_OLD      — the folder holding the install upgraded from (the pinned
 *                     published tarballs); this folder holds the tarballs under test;
 *   FSD_J5_PACKAGES — JSON `{ old: string[], new: string[] }`, the package
 *                     names installed on each side, whose roots are read.
 *
 * What it does: lists every name on each package root on both sides; the
 * names the old root has and the new root lacks are the dropped names. It
 * writes an upgrade app importing every dropped name from its old root, which
 * must compile, and import, on the old install first (a broken app would
 * otherwise read as a refusal); then compiles the same app here and records,
 * per name, whether it fails.
 *
 * Prints `moved-names: data <json>` with `{ names: [{ pkg, name, failsOnNew }] }`,
 * or `moved-names: FAIL at <step>: …` when the app does not compile or import
 * on the old install. Anything else is the harness's `error`.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const OLD = process.env.FSD_J5_OLD;
const NEW = process.cwd();
const packages = JSON.parse(process.env.FSD_J5_PACKAGES);

const OPTIONS = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** specifier → Map<name, isValue>, or null when the specifier has no declarations. */
function exportsIn(dir, list) {
  const probe = join(dir, "moved-names.probe.ts");
  writeFileSync(probe, `${list.map((s, i) => `import * as m${i} from "${s}";`).join("\n")}\nexport {};\n`);
  const program = ts.createProgram([probe], OPTIONS);
  const checker = program.getTypeChecker();
  const out = new Map();
  for (const stmt of program.getSourceFile(probe).statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const mod = checker.getSymbolAtLocation(stmt.moduleSpecifier);
    out.set(
      stmt.moduleSpecifier.text,
      mod
        ? new Map(
            checker.getExportsOfModule(mod).map((s) => {
              const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;
              return [s.name, Boolean(target.flags & ts.SymbolFlags.Value)];
            }),
          )
        : null,
    );
  }
  return out;
}

/**
 * Compile the upgrade app in `dir`: one aliased import per dropped name, one
 * per line, so two roots that dropped the same name don't collide and each
 * diagnostic belongs to one name. Returns the diagnostics' texts and the set
 * of `pkg name` keys whose line has one.
 */
function compile(dir, byPkg) {
  const app = join(dir, "moved-names.upgrade.ts");
  const lines = Object.entries(byPkg).flatMap(([pkg, names]) => names.map((name) => ({ pkg, name })));
  writeFileSync(app, `${lines.map(({ pkg, name }, i) => `import type { ${name} as _${i} } from "${pkg}";`).join("\n")}\nexport {};\n`);
  const program = ts.createProgram([app], OPTIONS);
  const sf = program.getSourceFile(app);
  const diagnostics = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  const failing = new Set();
  for (const d of diagnostics) {
    const at = lines[sf.getLineAndCharacterOfPosition(d.start ?? 0).line];
    if (at) failing.add(`${at.pkg} ${at.name}`);
  }
  return { errors: diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")), failing };
}

const oldExports = exportsIn(OLD, packages.old);
const newExports = exportsIn(NEW, packages.new);

/** pkg → [{ name, isValue }] dropped from the root. */
const dropped = {};
for (const pkg of packages.old) {
  if (!packages.new.includes(pkg)) continue;
  const before = oldExports.get(pkg);
  const after = newExports.get(pkg) ?? new Map();
  if (!before) continue;
  const names = [...before].filter(([name]) => !after.has(name)).map(([name, isValue]) => ({ name, isValue }));
  if (names.length > 0) dropped[pkg] = names;
}
const byPkg = Object.fromEntries(Object.entries(dropped).map(([pkg, names]) => [pkg, names.map((n) => n.name)]));

const oldErrors = compile(OLD, byPkg).errors;
if (oldErrors.length > 0) {
  console.log(`moved-names: FAIL at old-compile: the upgrade app does not compile on the install it upgrades from`);
  for (const e of oldErrors.slice(0, 40)) console.log(`  ${e}`);
  process.exit(0);
}

// It runs there too: every dropped value is on the old root at runtime.
const values = Object.fromEntries(
  Object.entries(dropped)
    .map(([pkg, names]) => [pkg, names.filter((n) => n.isValue).map((n) => n.name)])
    .filter(([, names]) => names.length > 0),
);
const run = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `const want = ${JSON.stringify(values)}; const missing = [];
     for (const [pkg, names] of Object.entries(want)) {
       let m; try { m = await import(pkg); } catch (e) { missing.push(pkg + ": " + e.message.split("\\n")[0]); continue; }
       for (const n of names) if (m[n] === undefined) missing.push(pkg + " " + n);
     }
     console.log(JSON.stringify(missing));`,
  ],
  { cwd: OLD, encoding: "utf8", timeout: 120_000 },
);
const missing = JSON.parse((run.stdout ?? "").trim().split("\n").pop() || "null");
if (!Array.isArray(missing)) throw new Error(`the old-install import gave no answer: ${(run.stderr ?? "").slice(-500)}`);
if (missing.length > 0) {
  console.log(`moved-names: FAIL at old-run: ${missing.length} dropped value(s) do not import on the install upgraded from`);
  for (const m of missing.slice(0, 40)) console.log(`  ${m}`);
  process.exit(0);
}

const { failing } = compile(NEW, byPkg);
const names = [];
for (const [pkg, list] of Object.entries(dropped))
  for (const { name } of list) names.push({ pkg, name, failsOnNew: failing.has(`${pkg} ${name}`) });
console.log(`moved-names: data ${JSON.stringify({ names })}`);

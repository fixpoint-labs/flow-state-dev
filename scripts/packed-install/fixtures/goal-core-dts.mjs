/**
 * Runs inside the consumer project for `surface.core-installed-dts`: reads the
 * INSTALLED core tarball's declarations through the TypeScript compiler (most
 * moved names are types, which a runtime import cannot see) and checks them
 * against the export census's frozen moved list.
 *
 * Inputs, from the environment:
 *   FSD_MOVED_TSV  — path to `moved.tsv` (`<move>\t<name>` per line);
 *   FSD_MOVED_RENAMES — JSON map of moved names a later change renamed, old → new
 *                    (`MOVED_RENAMES` in goal.mjs): a renamed row is looked for under its
 *                    new name in its new home, and under both names on the entries it left;
 *   FSD_CORE_SPECS — JSON list of every core specifier the installed exports map
 *                    offers, as `run.mjs` expands it.
 *
 * Holds when: no `harness`, `internal` or `unexport` name is exported from the
 * root or `core/types`; every `harness` name is on `core/harness`; every
 * `internal` name on `core/internal`; every `unexport` name on no public entry
 * (any specifier without an `internal` segment); every `benchmark` name on no
 * public core entry (they moved to `@flow-state-dev/testing/benchmark`, which the
 * packed-install check's `benchmark-subpaths.mjs` reads); `BlockContext` has
 * neither a `requestHost` member nor a symbol-keyed one; and the installed package
 * holds no compiled test file (`*.test.*`, `*.spec.*`).
 *
 * Prints `core-dts: ok`, or `core-dts: FAIL at moved-names: <n> violation(s): …`
 * followed by one line per violation. Anything else (TypeScript missing, a crash)
 * is the harness's `error`.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const CORE = "@flow-state-dev/core";
const moved = readFileSync(process.env.FSD_MOVED_TSV, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"));
const specs = [...new Set([...JSON.parse(process.env.FSD_CORE_SPECS), CORE, `${CORE}/types`, `${CORE}/harness`, `${CORE}/internal`])];

const probe = "goal-core-dts.probe.ts";
writeFileSync(probe, `${specs.map((s, i) => `import * as m${i} from "${s}";`).join("\n")}\nexport {};\n`);
const program = ts.createProgram([probe], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  noEmit: true,
  skipLibCheck: true,
  types: [],
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(probe);

/** specifier → Map<name, symbol>, or null when the specifier does not resolve. */
const exportsOf = new Map();
for (const stmt of source.statements) {
  if (!ts.isImportDeclaration(stmt)) continue;
  const spec = stmt.moduleSpecifier.text;
  const mod = checker.getSymbolAtLocation(stmt.moduleSpecifier);
  exportsOf.set(spec, mod ? new Map(checker.getExportsOfModule(mod).map((s) => [s.name, s])) : null);
}
const has = (spec, name) => exportsOf.get(spec)?.has(name) ?? false;

const violations = [];
for (const spec of [`${CORE}/harness`, `${CORE}/internal`])
  if (exportsOf.get(spec) == null) violations.push(`${spec} does not resolve to declarations`);
const publicSpecs = specs.filter((s) => !/(^|\/)internal(\/|$)/.test(s.slice(CORE.length)));
const renames = JSON.parse(process.env.FSD_MOVED_RENAMES ?? "{}");
for (const [move, row] of moved) {
  const name = renames[row] ?? row;
  for (const spec of [CORE, `${CORE}/types`]) for (const n of new Set([row, name])) if (has(spec, n)) violations.push(`${n} (${move}) is still on ${spec}`);
  if (move === "harness" && !has(`${CORE}/harness`, name)) violations.push(`${name} is not on ${CORE}/harness`);
  if (move === "internal" && !has(`${CORE}/internal`, name)) violations.push(`${name} is not on ${CORE}/internal`);
  if (move === "unexport")
    for (const spec of publicSpecs) if (has(spec, name)) violations.push(`${name} (unexport) is on ${spec}`);
  // The root and core/types are read above; a benchmark name is on no other public entry either.
  if (move === "benchmark")
    for (const spec of publicSpecs.filter((s) => s !== CORE && s !== `${CORE}/types`))
      if (has(spec, name)) violations.push(`${name} (benchmark) is on ${spec}`);
}

const blockContext = exportsOf.get(CORE)?.get("BlockContext") ?? exportsOf.get(`${CORE}/types`)?.get("BlockContext");
if (!blockContext) violations.push("BlockContext is exported from neither the root nor core/types");
else {
  const target = blockContext.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(blockContext) : blockContext;
  const props = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(target)).map((p) => p.name);
  if (props.includes("requestHost")) violations.push("BlockContext has a requestHost member");
  // A unique-symbol key reads as `__@<name>@<id>`: the runtime seam slots.
  for (const p of props.filter((n) => n.startsWith("__@"))) violations.push(`BlockContext has a symbol-keyed member (${p.split("@")[1]})`);
}

const installed = join("node_modules", CORE);
for (const e of readdirSync(installed, { recursive: true, withFileTypes: true }))
  if (e.isFile() && /\.(test|spec)\.[mc]?[jt]sx?$|\.(test|spec)\.d\.[mc]?ts$/.test(e.name))
    violations.push(`the tarball ships a compiled test file: ${join(e.parentPath ?? e.path, e.name).slice(installed.length + 1)}`);

if (violations.length === 0) console.log("core-dts: ok");
else {
  console.log(`core-dts: FAIL at moved-names: ${violations.length} violation(s): ${violations.slice(0, 3).join("; ")}`);
  for (const v of violations) console.log(`  ${v}`);
}

/**
 * Runs inside the consumer project for `surface.core-installed-dts`: reads the
 * INSTALLED core tarball's declarations through the TypeScript compiler (most
 * moved names are types, which a runtime import cannot see) and checks them
 * against FIX-2448's frozen moved list.
 *
 * Inputs, from the environment:
 *   FSD_MOVED_TSV  — path to `moved.tsv` (`<move>\t<name>` per line);
 *   FSD_CORE_SPECS — JSON list of every core specifier the installed exports map
 *                    offers, as `run.mjs` expands it.
 *
 * Holds when: no `harness`, `internal` or `unexport` name is exported from the
 * root or `core/types`; every `harness` name is on `core/harness`; every
 * `internal` name on `core/internal`; every `unexport` name on no public entry
 * (any specifier without an `internal` segment); and `BlockContext` has no
 * `requestHost` member. `benchmark` rows move with another issue and are not read.
 *
 * Prints `core-dts: ok`, or `core-dts: FAIL at moved-names: <n> violation(s): …`
 * followed by one line per violation. Anything else (TypeScript missing, a crash)
 * is the harness's `error`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const CORE = "@flow-state-dev/core";
const moved = readFileSync(process.env.FSD_MOVED_TSV, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\t"))
  .filter(([move]) => move !== "benchmark");
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
for (const [move, name] of moved) {
  for (const spec of [CORE, `${CORE}/types`]) if (has(spec, name)) violations.push(`${name} (${move}) is still on ${spec}`);
  if (move === "harness" && !has(`${CORE}/harness`, name)) violations.push(`${name} is not on ${CORE}/harness`);
  if (move === "internal" && !has(`${CORE}/internal`, name)) violations.push(`${name} is not on ${CORE}/internal`);
  if (move === "unexport")
    for (const spec of publicSpecs) if (has(spec, name)) violations.push(`${name} (unexport) is on ${spec}`);
}

const blockContext = exportsOf.get(CORE)?.get("BlockContext") ?? exportsOf.get(`${CORE}/types`)?.get("BlockContext");
if (!blockContext) violations.push("BlockContext is exported from neither the root nor core/types");
else {
  const target = blockContext.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(blockContext) : blockContext;
  const props = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(target)).map((p) => p.name);
  if (props.includes("requestHost")) violations.push("BlockContext has a requestHost member");
}

if (violations.length === 0) console.log("core-dts: ok");
else {
  console.log(`core-dts: FAIL at moved-names: ${violations.length} violation(s): ${violations.slice(0, 3).join("; ")}`);
  for (const v of violations) console.log(`  ${v}`);
}

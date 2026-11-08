#!/usr/bin/env node
/**
 * Surface census for the testing-package spec — retained design evidence.
 *
 * Re-derives every count the spec rests on, from source, and asserts that
 * EVERY root export of @flow-state-dev/testing is classified as staying or
 * moving (totality). `--plant` adds an unclassified name to prove the
 * totality assertion can fail.
 *
 *   node specs/issues/FIX-2460/poc/surface-census/census.mjs [--plant]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const root = execSync("git rev-parse --show-toplevel").toString().trim();
const read = (p) => readFileSync(join(root, p), "utf8");

/** Every name a module's `export { … }` / `export type { … }` / `export const` lists. */
function exportedNames(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of m[1].split(",")) {
      const n = raw.replace(/\btype\b/, "").trim().split(/\s+as\s+/).pop().trim();
      if (n) names.push(n);
    }
  }
  for (const m of src.matchAll(/export\s+(?:const|function|class)\s+(\w+)/g)) names.push(m[1]);
  return names;
}

const testingRoot = exportedNames(read("packages/testing/src/index.ts"));
if (process.argv.includes("--plant")) testingRoot.push("plantedUnclassifiedName");

const BENCHMARK = new Set(exportedNames(read("packages/testing/src/benchmark/index.ts"))
  .concat(["comparePatterns", "BenchmarkCategory", "BenchmarkTask", "BenchmarkSubject", "BenchmarkAdapter", "BenchmarkAdapterOptions", "BenchmarkRegistry"]));
const BUNDLE = new Set(["findImportsFromEntry", "findNodeBuiltinsFromEntry", "FindNodeBuiltinsOptions"]);
const FOLDED = new Set(["testSequencer", "testRouter", "TestSequencerResult", "TestRouterResult"]);
const MARKER = new Set(["testingPackageMarker"]);
const STAYS = new Set([
  "createTestContext", "CreateTestContextOptions", "testBlock", "testFlow", "testItems", "runForTest",
  "createReplayingRef", "ReplayingRef", "StateChange", "StepTrace", "TestBlockOptions", "TestBlockResult",
  "TestFlowOptions", "TestFlowResult", "TestSequencerSeed", "TestStateSeed", "TestTargetSeed", "SideChainTrace",
  "snapshotTrace", "SnapshotTrace", "createMockModelResolver", "mockGenerator", "MockGeneratorInstance",
  "MockGeneratorScriptStep", "MockGeneratorPredicateEntry", "MockGeneratorScriptEntry", "MockToolResult",
  "UnmockedGeneratorPolicy", "UnmockedDefault", "mockEvaluationModel", "MockEvaluationAnswer",
  "MockEvaluationAnswers", "MockEvaluationCall", "MockEvaluationModel", "MockEvaluationModelOptions",
  "evalBlock", "evalFlow", "exactMatch", "schemaValid", "contains", "jsonPath", "threshold", "custom",
  "allOf", "anyOf", "analyzerScorer", "loadDataset", "fromCsv", "buildReport", "Scorer", "ScoreResult",
  "EvalCase", "EvalBlockConfig", "EvalFlowConfig", "EvalCaseResult", "ScorerSummary", "EvalReport",
  "LoadDatasetOptions", "CsvMapping", "AnalyzerScorerConfig", "ScoreMapping"
]);
// Benchmark names the root lists that the benchmark barrel does not re-export by that spelling.
for (const n of testingRoot) if (/^(Benchmark|RunBenchmark|ComparePatterns|SubjectCategory|BuildBenchmark)/.test(n)) BENCHMARK.add(n);

const classes = { stays: [], benchmark: [], bundle: [], folded: [], marker: [], unclassified: [] };
for (const n of new Set(testingRoot)) {
  if (STAYS.has(n)) classes.stays.push(n);
  else if (BENCHMARK.has(n)) classes.benchmark.push(n);
  else if (BUNDLE.has(n)) classes.bundle.push(n);
  else if (FOLDED.has(n)) classes.folded.push(n);
  else if (MARKER.has(n)) classes.marker.push(n);
  else classes.unclassified.push(n);
}

const coreBenchmark = exportedNames(read("packages/core/src/index.ts")).filter((n) => n.startsWith("Benchmark"));
const patternsSrc = read("packages/patterns/src/index.ts");
const patternsBenchBlock = patternsSrc.match(/export\s*\{([^}]*)\}\s*from\s*"\.\/benchmark"/);
const patternsBenchmark = patternsBenchBlock ? exportedNames(`export {${patternsBenchBlock[1]}}`) : [];

/** Files outside packages/testing that import a name from @flow-state-dev/testing's root. */
function importersOf(names) {
  const out = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir))) {
      if (["node_modules", "dist", ".git", ".next", "specs"].includes(e)) continue;
      const p = join(dir, e);
      const st = statSync(join(root, p));
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts|mjs)$/.test(e) && !p.startsWith("packages/testing/")) {
        const src = readFileSync(join(root, p), "utf8");
        for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"@flow-state-dev\/testing"/g)) {
          if (names.some((n) => new RegExp(`\\b${n}\\b`).test(m[1]))) out.add(p);
        }
      }
    }
  };
  for (const d of ["packages", "apps", "goals", "scripts", "examples"]) {
    try { walk(d); } catch { /* absent */ }
  }
  return [...out].sort();
}

const report = {
  base: execSync("git rev-parse --short HEAD").toString().trim(),
  testingRootTotal: new Set(testingRoot).size,
  counts: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length])),
  benchmarkOnTestingRoot: { functions: classes.benchmark.filter((n) => /^[a-z]/.test(n)), types: classes.benchmark.filter((n) => /^[A-Z]/.test(n)).length },
  coreRootBenchmarkTypes: coreBenchmark,
  patternsRootBenchmarkNames: patternsBenchmark,
  importers: {
    benchmark: importersOf([...BENCHMARK]),
    bundle: importersOf([...BUNDLE]),
    folded: importersOf(["testSequencer", "testRouter"])
  },
  unclassified: classes.unclassified
};
console.log(JSON.stringify(report, null, 2));

// Totality: every root export is classified.
if (classes.unclassified.length > 0) {
  console.error(`FAIL: ${classes.unclassified.length} root export(s) unclassified: ${classes.unclassified.join(", ")}`);
  process.exit(1);
}
// The bundle scanners have no importer outside the repo's own tests.
const nonTest = report.importers.bundle.filter((p) => !/\/test\//.test(p));
if (nonTest.length > 0) { console.error(`FAIL: bundle tools imported outside tests: ${nonTest}`); process.exit(1); }
console.log("PASS: every testing root export classified; bundle tools imported only by tests");

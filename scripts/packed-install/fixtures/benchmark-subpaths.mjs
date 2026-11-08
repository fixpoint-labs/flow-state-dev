/**
 * Runs inside the consumer project the packed-install check builds, and reads
 * what an adopter's autocomplete offers from the installed testing and
 * patterns tarballs: benchmarking lives on `@flow-state-dev/testing/benchmark`
 * and `@flow-state-dev/patterns/benchmark`, and on neither package's root.
 *
 * The names are the census the testing package's surface move was specified
 * against (`specs/issues/FIX-2460/poc/surface-census`). Values are read with
 * `Object.keys` of the installed entry; types from the installed `.d.ts`,
 * since a runtime import cannot see them. The repo-only scanner entry,
 * `@flow-state-dev/testing/bundle`, must not be published at all. Core's
 * benchmark types are judged by `goal-core-dts.mjs`, not here.
 *
 * Prints `benchmark-subpaths: ok`, or `benchmark-subpaths: FAIL at <step>: …`
 * and exits 1.
 */
import { readFileSync } from "node:fs";

const TESTING_VALUES = [
  "runBenchmark", "comparePatterns", "baselineSubject", "defineBenchmark",
  "buildBenchmarkReport", "renderScorecard", "estimateCostUsd",
];
const TESTING_TYPES = [
  "BenchmarkTask", "BenchmarkCategory", "BenchmarkSubject", "BenchmarkAdapter", "BenchmarkAdapterOptions",
  "BenchmarkRegistry", "RunBenchmarkConfig", "ComparePatternsConfig", "SubjectCategoryStat", "BenchmarkRanking",
  "BenchmarkReport", "BenchmarkRunResult", "BenchmarkDefinition", "BuildBenchmarkReportMeta",
];
const OFF_TESTING_ROOT = [...TESTING_VALUES, "findImportsFromEntry", "findNodeBuiltinsFromEntry", "testSequencer", "testRouter"];
const OFF_TESTING_ROOT_TYPES = [...TESTING_TYPES, "FindNodeBuiltinsOptions", "TestSequencerResult", "TestRouterResult"];
const PATTERNS_VALUES = [
  "defaultBenchmarkRegistry", "sharedDefaultWorker", "supervisorBenchmarkAdapter", "planAndExecuteBenchmarkAdapter",
  "parallelTasksBenchmarkAdapter", "roundRobinBenchmarkAdapter", "debateBenchmarkAdapter", "routedSpecialistsBenchmarkAdapter",
];

const failures = [];
const keysOf = async (spec) => {
  try {
    return Object.keys(await import(spec));
  } catch (err) {
    failures.push(`${spec} does not import: ${err.code ?? err.message}`);
    return null;
  }
};
const dtsOf = (path) => {
  try {
    return readFileSync(`node_modules/@flow-state-dev/${path}`, "utf8");
  } catch {
    failures.push(`no installed ${path}`);
    return "";
  }
};
const names = (text, name) => new RegExp(`\\b${name}\\b`).test(text);

const testingRoot = (await keysOf("@flow-state-dev/testing")) ?? [];
const patternsRoot = (await keysOf("@flow-state-dev/patterns")) ?? [];
const testingBench = await keysOf("@flow-state-dev/testing/benchmark");
const patternsBench = await keysOf("@flow-state-dev/patterns/benchmark");

for (const n of OFF_TESTING_ROOT) if (testingRoot.includes(n)) failures.push(`the testing root exports ${n}`);
for (const n of PATTERNS_VALUES) if (patternsRoot.includes(n)) failures.push(`the patterns root exports ${n}`);
if (testingBench) for (const n of TESTING_VALUES) if (!testingBench.includes(n)) failures.push(`testing/benchmark lacks ${n}`);
if (patternsBench) for (const n of PATTERNS_VALUES) if (!patternsBench.includes(n)) failures.push(`patterns/benchmark lacks ${n}`);

const testingRootDts = dtsOf("testing/dist/index.d.ts");
for (const t of OFF_TESTING_ROOT_TYPES) if (names(testingRootDts, t)) failures.push(`the testing root's .d.ts names ${t}`);
if (testingBench) {
  const benchDts = dtsOf("testing/dist/benchmark/index.d.ts");
  for (const t of TESTING_TYPES) if (!names(benchDts, t)) failures.push(`testing/benchmark's .d.ts lacks ${t}`);
}

try {
  await import("@flow-state-dev/testing/bundle");
  failures.push("@flow-state-dev/testing/bundle is published");
} catch (err) {
  if (err.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") failures.push(`@flow-state-dev/testing/bundle: ${err.code ?? err.message}`);
}

if (failures.length > 0) {
  console.log(`benchmark-subpaths: FAIL at census: ${failures.length} finding(s)`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(`benchmark-subpaths: ok (testing/benchmark ${testingBench.length}, patterns/benchmark ${patternsBench.length})`);

#!/usr/bin/env node
/**
 * FIX-1772 spec evidence: re-derives the two counted facts the spec rests on.
 *
 *   1. WRITERS — every source site that builds a `tool_output` item. The spec
 *      puts the record cap at the response emitter, so every writer must reach
 *      the log through `ctx.response.emit` (or the shared tool-output helper).
 *   2. READERS — every execution-side read of a persisted `tool_output` or
 *      `block_trace`. The spec claims exactly three of them feed a recorded
 *      value back into a run (durable resume, in-turn tool resume, model
 *      history). Each must be classified; an unclassified site fails.
 *
 * Totality, not spot checks: a site the tables below don't name is a failure.
 * Negative control: `--plant` writes one unclassified writer and one
 * unclassified reader into `packages/core/src`, runs the check (which must
 * fail), and removes them.
 *
 * Retained spec evidence only. Not part of any build, test root or CI job.
 * Run from the repo root:
 *   node specs/issues/FIX-1772/poc/record-sites/check.mjs
 *   node specs/issues/FIX-1772/poc/record-sites/check.mjs --plant   # must exit 1
 */
import { readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** Writers: file → how it reaches the log. */
const WRITERS = {
  "packages/core/src/blocks/internal/emit-tool-output.ts": "ctx.response.emit (shared helper for generator tools and .asTool)",
  "packages/claude-code/src/sdk/emit.ts": "ctx.response.emit (harness tool calls)",
  "packages/codex/src/emit.ts": "ctx.response.emit (harness tool calls)",
  "packages/cursor/src/emit.ts": "ctx.response.emit (harness tool calls)",
};

/** Execution-side readers: file → role. `feeds-run` is the claim under test. */
const READERS = {
  "packages/core/src/blocks/internal/replay-log.ts": "feeds-run: durable resume injects a completed trace's output",
  "packages/core/src/blocks/internal/generator-resume.ts": "feeds-run: in-turn resume replays a completed tool result",
  "packages/engine/src/context/history.ts": "feeds-run: the model's history replays tool results",
  "packages/contracts/src/items/resolve-value.ts": "resolver: follows a ref to its content; called by replay-log",
  "packages/contracts/src/items/canonical-log.ts": "dedupe: chooses which copy survives; reads ids and status, not output",
  "packages/core/src/blocks/internal/find-block-trace.ts": "ids only: builds ref descriptors",
  "packages/engine/src/context/createExecutionContext.ts": "usage only: reads modelUsage",
};

const WRITER_RE = /type:\s*"tool_output"(\s+as\s+const)?\s*,/;
const READER_RE = /type(\s+as\s+string\))?\s*===\s*"(tool_output|block_trace)"/;
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".next", "test", "tests", "__tests__", "stories", "coverage"]);
const READER_ROOTS = ["packages/core/src", "packages/engine/src", "packages/contracts/src"];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|mts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) yield p;
  }
}

function scan(roots, re) {
  const hits = new Map();
  for (const r of roots) {
    for (const file of walk(join(ROOT, r))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (re.test(line)) {
          const rel = relative(ROOT, file);
          hits.set(rel, [...(hits.get(rel) ?? []), i + 1]);
        }
      });
    }
  }
  return hits;
}

function check() {
  const failures = [];
  const pkgSrc = readdirSync(join(ROOT, "packages"))
    .map((p) => `packages/${p}/src`)
    .filter((p) => { try { return statSync(join(ROOT, p)).isDirectory(); } catch { return false; } });

  const writers = scan(pkgSrc, WRITER_RE);
  for (const [file, lines] of writers) {
    if (!(file in WRITERS)) failures.push(`unclassified tool_output writer: ${file}:${lines.join(",")}`);
    else if (!/response\.emit\(/.test(readFileSync(join(ROOT, file), "utf8")))
      failures.push(`writer does not emit through ctx.response.emit: ${file}`);
  }
  for (const file of Object.keys(WRITERS)) if (!writers.has(file)) failures.push(`listed writer no longer builds tool_output: ${file}`);

  const readers = scan(READER_ROOTS, READER_RE);
  for (const [file, lines] of readers) {
    if (!(file in READERS)) failures.push(`unclassified persisted-item reader: ${file}:${lines.join(",")}`);
  }
  for (const file of Object.keys(READERS)) if (!readers.has(file)) failures.push(`listed reader no longer reads persisted items: ${file}`);

  const feeds = Object.entries(READERS).filter(([, role]) => role.startsWith("feeds-run")).map(([f]) => f);
  for (const file of feeds) {
    if (!/\.output\b/.test(readFileSync(join(ROOT, file), "utf8"))) failures.push(`feeds-run reader does not read .output: ${file}`);
  }

  console.log(`writers: ${writers.size} files, ${[...writers.values()].flat().length} sites`);
  console.log(`readers: ${readers.size} files; feeds-run: ${feeds.length}`);
  return failures;
}

const plant = process.argv.includes("--plant");
const planted = join(ROOT, "packages/core/src/__fix1772_plant.ts");
if (plant) {
  writeFileSync(planted, 'export const w = { type: "tool_output" as const, output: 1 };\nexport const r = (item: { type: string }) => item.type === "block_trace";\n');
}
let failures;
try {
  failures = check();
} finally {
  if (plant) rmSync(planted, { force: true });
}
if (failures.length > 0) {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log("PASS every writer and reader is classified");

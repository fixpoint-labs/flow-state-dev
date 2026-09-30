#!/usr/bin/env node
/**
 * FIX-1507 factual-base checker. Retained spec evidence, not production code:
 * nothing imports it and no test runner discovers it.
 *
 * Re-derives the counts the spec rests on — how many hand-rolled fenced reads
 * and how many inline panel client set-ups exist in `packages/react/src` — and
 * asserts TOTALITY: every source line that opens a read fence or builds a
 * resource client is classified as in scope or deliberately out. An unclassified
 * site fails the run, so a copy nobody listed cannot hide.
 *
 *   node specs/issues/FIX-1507/poc/census/census.mjs            # expects today's `main`
 *   node specs/issues/FIX-1507/poc/census/census.mjs --after    # expects the refactored tree
 *   node specs/issues/FIX-1507/poc/census/census.mjs --plant    # negative control: must exit 1
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../../../../..");
const src = join(repo, "packages/react/src");
const after = process.argv.includes("--after");
const plant = process.argv.includes("--plant");

/** Call sites, not mentions: a doc-comment or line-comment line is skipped. */
const PATTERNS = { fence: /\buseReadFence\(/, client: /\bcreateResourceClient\(/ };

/** Deliberately out of scope, with the reason. Matched by path prefix. */
const OUT = {
  "hooks/useReadFence.ts": "the public fence itself (definition)",
  "hooks/useResource.ts": "public resource hook; builds its own client by design",
  "hooks/useResourceCollection.ts": "public resource hook",
  "hooks/useResourceManifest.ts": "public resource hook"
};

/** In scope, and how many call sites each file holds, before and after. */
const IN = after
  ? {
      fence: { "internal/useFencedRead.ts": 1 },
      client: { "components/panels/": 1 }
    }
  : {
      fence: { "components/panels/reads.ts": 1, "components/flow-navigator/reads.ts": 2 },
      client: {
        "components/panels/Roster.ts": 1,
        "components/panels/BoardColumns.ts": 1,
        "components/panels/BoardList.ts": 1,
        "components/panels/SeatDetail.ts": 1
      }
    };

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const sites = [];
for (const file of walk(src)) {
  const rel = relative(src, file);
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    const code = line.trim();
    if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
    for (const [kind, pattern] of Object.entries(PATTERNS)) {
      if (pattern.test(line)) sites.push({ kind, rel, line: index + 1 });
    }
  });
}
if (plant) sites.push({ kind: "fence", rel: "components/planted/Unlisted.ts", line: 1 });

const problems = [];
const counts = { fence: {}, client: {} };
for (const site of sites) {
  if (Object.keys(OUT).some((prefix) => site.rel.startsWith(prefix))) continue;
  const key = Object.keys(IN[site.kind]).find((prefix) => site.rel.startsWith(prefix));
  if (key === undefined) {
    problems.push(`unclassified ${site.kind} site: ${site.rel}:${site.line}`);
    continue;
  }
  counts[site.kind][key] = (counts[site.kind][key] ?? 0) + 1;
}
for (const kind of Object.keys(IN)) {
  for (const [key, want] of Object.entries(IN[kind])) {
    const got = counts[kind][key] ?? 0;
    if (got !== want) problems.push(`${kind} at ${key}: expected ${want}, found ${got}`);
  }
}

const total = (kind) => Object.values(counts[kind]).reduce((a, b) => a + b, 0);
console.log(`mode: ${after ? "after" : "main"}${plant ? " + planted control" : ""}`);
console.log(`in-scope fenced-read recipes: ${total("fence")}  ${JSON.stringify(counts.fence)}`);
console.log(`in-scope panel client set-ups: ${total("client")}  ${JSON.stringify(counts.client)}`);
console.log(`sites scanned: ${sites.length}, out of scope by rule: ${sites.length - total("fence") - total("client") - problems.filter((p) => p.startsWith("unclassified")).length}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  process.exit(1);
}
console.log("PASS");

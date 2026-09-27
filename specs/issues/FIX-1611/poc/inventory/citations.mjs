#!/usr/bin/env node
/**
 * FIX-1611 · citations check, for BR-27 ("a retained spec's citation of a check still resolves").
 *
 * Throwaway, retained as evidence beside check.mjs. Not production code, outside default test,
 * lint and knip discovery. Run it by hand; see README.md.
 *
 * It lists every citation under `specs/` that does not resolve on this tree:
 *
 *   link   a relative markdown link whose file is missing, or whose #anchor matches no heading
 *          and no <a name> or <a id> in that file
 *   path   a backticked `goals/<area>/<check>/…` or `apps/kitchen-sink/e2e/<file>.spec.ts` that
 *          is missing; retained specs mostly cite checks this way
 *
 * Some citations under `specs/` never resolved (a check a spec plans but hasn't built, a README
 * draft's relative links), so the check is against a baseline taken before the build:
 *
 *   --write <file>     save this tree's unresolved citations
 *   --against <file>   fail on any unresolved citation the saved list doesn't have
 *   --hide <path>      negative control: treat a repo-relative path, and everything under it, as missing
 *
 * With neither --write nor --against it prints the unresolved list and exits 0.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const hidden = flag("--hide")?.replace(/\/$/, "");

function exists(abs) {
  const rel = relative(ROOT, abs);
  if (hidden && (rel === hidden || rel.startsWith(`${hidden}/`))) return false;
  return existsSync(abs);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchorsOf(abs) {
  const text = readFileSync(abs, "utf8").replace(/^```[\s\S]*?^```/gm, "");
  const found = new Set([...text.matchAll(/<a (?:name|id)="([^"]+)"/g)].map((m) => m[1]));
  const seen = new Map();
  for (const m of text.matchAll(/^#{1,6} (.+)$/gm)) {
    const plain = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");
    const base = plain.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    found.add(n === 0 ? base : `${base}-${n}`);
  }
  return found;
}

const anchorCache = new Map();
const hasAnchor = (abs, anchor) => {
  if (!anchorCache.has(abs)) anchorCache.set(abs, anchorsOf(abs));
  return anchorCache.get(abs).has(decodeURIComponent(anchor));
};

const PATH = /`((?:goals\/[a-z0-9-]+\/[a-z0-9-]+(?:\/[\w./-]*)?)|(?:apps\/kitchen-sink\/e2e\/[\w.-]+\.spec\.ts))`/g;

const unresolved = new Set();
for (const file of walk(join(ROOT, "specs"))) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, "utf8").replace(/^```[\s\S]*?^```/gm, "");
  for (const m of text.matchAll(PATH)) {
    if (!exists(join(ROOT, m[1]))) unresolved.add(`${rel} -> path ${m[1]}`);
  }
  const prose = text.replace(/`[^`\n]*`/g, "");
  for (const m of prose.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target)) continue;
    const [path, anchor] = target.split("#");
    const abs = path ? normalize(join(dirname(file), decodeURIComponent(path))) : file;
    if (!exists(abs)) unresolved.add(`${rel} -> link ${target}`);
    else if (anchor && abs.endsWith(".md") && statSync(abs).isFile() && !hasAnchor(abs, anchor))
      unresolved.add(`${rel} -> anchor ${target}`);
  }
}

const list = [...unresolved].sort();
const write = flag("--write");
const against = flag("--against");
if (write) {
  writeFileSync(write, `${list.join("\n")}\n`);
  console.log(`wrote ${list.length} unresolved citation(s) to ${write}`);
} else if (against) {
  const before = new Set(readFileSync(against, "utf8").split("\n").filter(Boolean));
  const added = list.filter((c) => !before.has(c));
  console.log(`unresolved: ${list.length} now · ${before.size} at baseline · ${added.length} new`);
  if (added.length > 0) {
    console.log(`\nFAIL · a citation that resolved before no longer does`);
    for (const c of added) console.log(`  ${c}`);
    process.exit(1);
  }
  console.log("\nPASS · every citation that resolved at baseline still resolves");
} else {
  for (const c of list) console.log(c);
  console.log(`\n${list.length} unresolved citation(s)`);
}

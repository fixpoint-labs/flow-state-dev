#!/usr/bin/env node
/**
 * Guard: nothing in the docs corpus may teach that `flowIsolation` keys on the
 * flow KIND. Since FIX-1323 the isolation coordinate is the resolved flow
 * INSTANCE id, and `hireWorkforce` mints one instance per seat.
 *
 * Why this is a co-occurrence check and not a phrase list. FIX-1420 first
 * shipped with a scan whose patterns were generalized from the stale lines it
 * had already found ("PER KIND, NOT PER SEAT", "(scopeId, flowKind, ref)").
 * That scan reported itself green while two sites survived — `namespaces by
 * flowKind` in the same file, and an `aria-label` paraphrasing the old rule as
 * "keyed by member identity". A phrase list derived from known hits can only
 * confirm the list; it cannot extend it. So this matches on the CONCEPTS
 * co-occurring on a line — an isolation/keying word near a kind word — which
 * catches wordings nobody has written yet.
 *
 * Run: node scripts/check-isolation-coordinate.mjs
 * Exits non-zero and prints every offending line when the rule reappears.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;

/** Files whose job is to describe the CURRENT rule. */
const ROOTS = ["docs/atlas", "docs/architecture", "docs/contributing"];
const EXTS = [".html", ".md", ".mdx"];

/**
 * Point-in-time records: they describe the world as it was when written and
 * are not current teaching, so a per-kind sentence in them is history, not a
 * defect. Narrow on purpose — everything else is in scope.
 */
const EXCLUDE = [/docs\/internal\//, /CHANGELOG\.md$/];

/**
 * A line is a candidate when a STORAGE-KEYING word and a kind word co-occur.
 *
 * The keying list is deliberately about where a row lands, not about isolation
 * as a topic. A looser first version matched bare `isolated` / `isolation` and
 * pulled in nine unrelated lines — session ownership, error-message wording,
 * memory tiers — which would have needed an allowlist entry each. Narrowing the
 * CONCEPT removes those structurally; an allowlist that long is the brittleness
 * this check exists to avoid.
 */
const KEYING = /flowisolation|isolateuserstate|isolateorgstate|namespac|keyed (?:by|at)|keys (?:at|per)|stored at|scopeid|resolveresourcescopeid|storage key/i;
const KIND = /flowkind|flow kind|per[- ]kind|per flow kind/i;

/**
 * The line must also be talking about a stored user/org ROW. Without this the
 * check fires on `registry.get(flowKind)` route lookups and on child sessions
 * "keyed under" a parent — three standing false positives that would have
 * needed an allowlist entry each, and a guard nobody can get to green is a
 * guard people learn to skip.
 */
const STORAGE_SUBJECT = /resource|user[- ]?scoped|org[- ]?scoped|flowisolation|isolate(?:user|org)state|scopeid|storage|cell|row/i;

/**
 * Lines that pair the two words while saying something TRUE. Each needs a
 * reason, because every entry here is a hole in the guard.
 */
const ALLOW = [
  // States the correction itself — names the kind only to deny it.
  /not the kind/i,
  /does not isolate/i,
  /instead of .{0,40}kind/i,
  // A singleton's instance id genuinely IS its kind.
  /singleton/i,
  // Names per-kind as a thing NOT to do (an atlas "what would fake it" cell).
  /teaching .{0,40}as per kind/i,
  // FIX-1396's separate axis: isolation is per kind rather than per memory
  // TIER. A true statement about a different question.
  /not per tier/i,
  // The cross-flow DISPATCH address tuple. `flowKind` there is a routing
  // parameter carrying an instance id, and the line only trips the storage
  // test because the same long paragraph also mentions a lineage cell.
  /\(type, target, flowKind\)/
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * The two scanners, exported as pure functions over text so the guard's own
 * boundaries are testable. A guard that cannot be shown to fail is not a
 * guard; the negative controls live in
 * `packages/core/test/isolation-coordinate-check.test.ts`.
 */
export function scanLines(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (!KEYING.test(line) || !KIND.test(line) || !STORAGE_SUBJECT.test(line)) return;
    if (ALLOW.some((rx) => rx.test(line))) return;
    out.push({ line: i + 1, text: line.trim().slice(0, 240) });
  });
  return out;
}

const COORDINATE = /\bseats?\b|\binstances?\b/i;
const VISIBLE_COMMITS = /per seat|per-seat|flow instance id|instance id,/i;

/**
 * A figure's `aria-label` must not drift from its own visible text. The token
 * scan above cannot see this class at all, and that is measured rather than
 * assumed: with the stale label in place it still printed OK. The label read
 * "keyed by member identity" — naming neither the kind nor the instance, so no
 * co-occurrence rule matches it — while the diagram beside it said "PER SEAT".
 * An `aria-label` is what a screen-reader user and a scraping agent actually
 * receive, so a figure that argues with itself ships the wrong claim to exactly
 * the readers least able to check it.
 *
 * Narrow on purpose: only for figures whose VISIBLE text commits to a storage
 * coordinate does the label have to commit to the same one.
 */
export function scanFigureDrift(src) {
  const out = [];
  for (const svg of src.matchAll(/<svg\b[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/svg>/g)) {
    const label = svg[1];
    const visible = [...svg[2].matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
      .map((m) => m[1])
      .join(" ");
    // Only figures actually about stored rows. "ONE CHILD PER SEAT" on a
    // dispatch diagram commits to no storage coordinate.
    if (!/flowisolation|isolat|resource|stored at|keyed/i.test(visible + label)) continue;
    if (!VISIBLE_COMMITS.test(visible)) continue;
    if (COORDINATE.test(label)) continue;
    out.push({ line: src.slice(0, svg.index).split("\n").length, label: label.slice(0, 160) });
  }
  return out;
}

/** Every in-scope file in the docs corpus, as {rel, src}. */
export function corpusFiles() {
  const files = [];
  for (const base of ROOTS) {
    for (const file of walk(join(ROOT, base))) {
      const rel = relative(ROOT, file);
      if (EXCLUDE.some((rx) => rx.test(rel))) continue;
      files.push({ rel, src: readFileSync(file, "utf8") });
    }
  }
  return files;
}

function main() {
  const hits = [];
  const drift = [];
  for (const { rel, src } of corpusFiles()) {
    for (const h of scanLines(src)) hits.push({ file: rel, ...h });
    for (const d of scanFigureDrift(src)) drift.push({ file: rel, ...d });
  }

  if (hits.length > 0 || drift.length > 0) {
    if (hits.length > 0) {
      console.error(
        `\n[isolation-coordinate] ${hits.length} line(s) may still teach per-KIND isolation.\n` +
          `Since FIX-1323 the coordinate is the flow INSTANCE id; hireWorkforce mints one per seat.\n`
      );
      for (const h of hits) console.error(`  ${h.file}:${h.line}\n    ${h.text}\n`);
    }
    if (drift.length > 0) {
      console.error(
        `\n[isolation-coordinate] ${drift.length} figure(s) whose aria-label does not name the\n` +
          `coordinate their visible text commits to. The label is the copy agents and screen\n` +
          `readers get — fix it with the diagram, not after it.\n`
      );
      for (const d of drift) console.error(`  ${d.file}:${d.line}\n    aria-label: ${d.label}…\n`);
    }
    process.exit(1);
  }

  console.log("[isolation-coordinate] OK — no doc teaches per-kind flowIsolation, no aria-label drift.");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

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
 * co-occurring in one sentence — an isolation/keying word near a kind word —
 * which catches wordings nobody has written yet.
 *
 * ## The match window is a SENTENCE, not a physical line
 *
 * The first version tested each physical line for all three concepts, which
 * meant ordinary prose wrapping walked straight through it: a claim broken
 * across two lines matched nothing, and every control used a one-line fixture,
 * so the suite stayed green over the hole. That is the same defect as a phrase
 * list — a check that cannot fail for the reason it claims.
 *
 * The corpus wraps, and that is measured, not assumed: 2,986 mid-sentence line
 * breaks across 40 of the 53 scanned files. So wrapped lines are rejoined and
 * the scan runs per sentence.
 *
 * A sentence, specifically, and not a paragraph. Widening to the paragraph is
 * what makes a guard cry wolf — three concepts can sit in one paragraph without
 * forming one claim. Measured on the current (correct) corpus: a paragraph
 * window reports 3 false positives and a two-line sliding window reports 3,
 * each of which would need an allowlist entry. The sentence window reports 0
 * and still catches the wrapped claim, because a sentence is the unit a claim
 * is actually made in and a line break inside one is a rendering artifact.
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
 * A sentence is a candidate when a STORAGE-KEYING word and a kind word co-occur.
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
 * The sentence must also be talking about a stored user/org ROW. Without this the
 * check fires on `registry.get(flowKind)` route lookups and on child sessions
 * "keyed under" a parent — three standing false positives that would have
 * needed an allowlist entry each, and a guard nobody can get to green is a
 * guard people learn to skip.
 */
const STORAGE_SUBJECT = /resource|user[- ]?scoped|org[- ]?scoped|flowisolation|isolate(?:user|org)state|scopeid|storage|cell|row/i;

/**
 * Sentences that pair the two words while saying something TRUE. Each needs a
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

/**
 * No `catch` here, deliberately. An unreadable subtree used to scan as zero
 * files and the guard printed OK — a green meaning "found nothing to check",
 * which is the instrument failure this guard exists to close, one level down.
 * Every directory reached here was already seen as a directory, so a throw is
 * genuinely exceptional and `main` turns it into a loud non-zero exit.
 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * The configured roots that are not there. A renamed or moved docs root would
 * otherwise walk to zero files and pass; exported so the control can put a root
 * out of reach and watch this go red, rather than trusting the argument.
 */
export function missingRoots(root = ROOT) {
  return ROOTS.filter((base) => {
    try {
      return !statSync(join(root, base)).isDirectory();
    } catch {
      return true;
    }
  });
}

/**
 * The corpus as sentences, with wrapped lines rejoined.
 *
 * A block is a run of non-blank lines — the unit prose wrapping happens inside.
 * Each sentence carries the physical line its offending word sits on, so a
 * failure still names one place to look rather than the top of a paragraph.
 */
function claims(text) {
  const out = [];
  let block = [];
  let blockStart = 1;

  const flush = () => {
    if (block.length === 0) return;
    const starts = [];
    let joined = "";
    block.forEach((l, i) => {
      starts.push(joined.length + (i === 0 ? 0 : 1));
      joined += i === 0 ? l : ` ${l}`;
    });
    const lineAt = (offset) => {
      let i = starts.length - 1;
      while (i > 0 && starts[i] > offset) i--;
      return blockStart + i;
    };

    let start = 0;
    const sentenceEnd = /[.!?](?=\s|$)/g;
    let m;
    while ((m = sentenceEnd.exec(joined)) !== null) {
      out.push({ offset: start, text: joined.slice(start, m.index + 1), lineAt });
      start = m.index + 1;
    }
    if (start < joined.length) out.push({ offset: start, text: joined.slice(start), lineAt });
    block = [];
  };

  text.split("\n").forEach((l, i) => {
    if (l.trim() === "") {
      flush();
    } else {
      if (block.length === 0) blockStart = i + 1;
      block.push(l);
    }
  });
  flush();
  return out;
}

/**
 * The two scanners, exported as pure functions over text so the guard's own
 * boundaries are testable. A guard that cannot be shown to fail is not a
 * guard; the negative controls live in
 * `packages/core/test/isolation-coordinate-check.test.ts`.
 */
export function scanClaims(text) {
  const out = [];
  for (const claim of claims(text)) {
    const t = claim.text;
    if (!KEYING.test(t) || !KIND.test(t) || !STORAGE_SUBJECT.test(t)) continue;
    if (ALLOW.some((rx) => rx.test(t))) continue;
    const kind = KIND.exec(t);
    out.push({
      line: claim.lineAt(claim.offset + (kind === null ? 0 : kind.index)),
      text: t.trim().slice(0, 240)
    });
  }
  return out;
}

const COORDINATE = /\bseats?\b|\binstances?\b/i;
const VISIBLE_COMMITS = /per seat|per-seat|flow instance id|instance id,/i;

/**
 * Whether a figure is about stored rows at all — derived from `KEYING` rather
 * than restated, because a second hand-written list is how the line scan and
 * the aria-label drifted apart in the first place.
 *
 * `STORAGE_SUBJECT` is deliberately NOT unioned in, and that is measured, not
 * assumed: its `row` and `cell` are prose subjects that mean something else in
 * a diagram label. Unioning it fires on `docs/atlas/workforce.html:2039`, a
 * dispatch figure reading "ONE CHILD PER ROW" beside "ONE CHILD PER SEAT",
 * which commits to no storage coordinate at all. `resource` is taken across as
 * the one storage noun a figure uses the same way prose does.
 *
 * Two bare words are added, and only here: a figure's text is labels, not
 * prose, so it says `isolation` and `keyed` where a sentence says
 * `flowIsolation` or `keyed by`. Both were in the gate before it was derived.
 */
const FIGURE_SUBJECT = new RegExp(`${KEYING.source}|resource|isolat|keyed`, "i");

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
    if (!FIGURE_SUBJECT.test(visible + label)) continue;
    if (!VISIBLE_COMMITS.test(visible)) continue;
    if (COORDINATE.test(label)) continue;
    out.push({ line: src.slice(0, svg.index).split("\n").length, label: label.slice(0, 160) });
  }
  return out;
}

/** Every in-scope file in the docs corpus, as {rel, src}. */
function corpusFiles() {
  const missing = missingRoots();
  if (missing.length > 0) {
    throw new Error(
      `configured docs root(s) not found: ${missing.join(", ")}. ` +
        `The scan would otherwise read nothing and report OK — restore the ` +
        `directories, or update ROOTS in this script.`
    );
  }

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
  let files;
  try {
    files = corpusFiles();
  } catch (err) {
    console.error(`\n[isolation-coordinate] cannot scan the corpus — ${err.message}\n`);
    process.exit(1);
  }

  const hits = [];
  const drift = [];
  for (const { rel, src } of files) {
    for (const h of scanClaims(src)) hits.push({ file: rel, ...h });
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

#!/usr/bin/env node
/**
 * FIX-1154 — §11 target-list check. Throwaway; never merges.
 *
 * WHY THIS EXISTS
 * §11's target list is supposed to be the OUTPUT of a selection rule, not an
 * inventory. Round 20 stated the rule. Round 22 widened its corpus to
 * `apps/docs/`, `packages/*.README.md` and `docs/architecture/`. Round 23 then
 * found `docs/architecture/overview.md:120` — a page the widened rule selects,
 * that nobody had marked, because widening the corpus is not the same act as
 * re-running the rule over it. Seven rounds of this document have now recorded
 * some version of "a fix reached its target and not its neighbour" in prose,
 * and the prose has not prevented the next one.
 *
 * WHAT IT MECHANISES, AND WHAT IT DOES NOT
 * It cannot decide the rule's predicates — "states a blanket version-check
 * guarantee" and "presents a dispatch taxonomy as exhaustive" are judgements.
 * What it can do is force the judgement to be MADE. It computes the CANDIDATE
 * set mechanically (a corpus file that carries concurrency-guarantee language
 * anywhere near a state mutator) and asserts that §11 dispositions every
 * candidate — either as an EXTEND/QUALIFY target or in the "Deliberately left
 * alone" list.
 *
 * So the failure it catches is precisely round 23's: a page enters the corpus,
 * or the corpus widens to include it, and nobody says anything about it. It
 * does NOT catch a page that is dispositioned wrongly. That is the honest
 * boundary — see §11's "What is mechanised here".
 *
 * THE CORPUS IS ASSERTED, NOT JUST PRINTED — round 24
 * The first version of this file walked every directory under its roots with no
 * exclusion, and `statSync` follows symlinks, so under pnpm it descended through
 * `apps/docs/node_modules` into the dependency tree: 14 dependency READMEs here,
 * `@docusaurus/core/README.md` among them, and far more in a hoisted install. A
 * dependency README that happened to carry the SUBJECT vocabulary would have
 * failed this check and demanded a §11 disposition for THIRD-PARTY prose — a
 * failure the document cannot fix, which is worse than no check, because the
 * first person to hit it deletes it.
 *
 * It survived a round because the number was measured where the defect could not
 * appear (a worktree with no dependencies installed) and confirmed with `find`,
 * which does NOT follow symlinks and reported zero. THE CHECK WAS AIMED AT A
 * NEIGHBOUR OF THE CLAIM — the same failure §10 exists to prevent, this time in
 * the verification of the mechanism built to prevent it. A checker that walks
 * symlinks needs its corpus asserted by something that walks them too, so the
 * corpus now asserts itself (`assertCorpus`) rather than trusting the walk, and
 * the printed count names what it excluded. That is §10's evidence-marker row
 * applied to this file's own output.
 *
 * EVERY ROOT IS CLASSIFIED, NOT JUST THE INCLUDED ONES — round 26
 * Round 24 fixed a corpus that reached too FAR. Round 26 found the opposite
 * error, and it is the more dangerous of the two because it is silent: the
 * corpus reached too NARROW, and nothing recorded that it had.
 * `.agents/skills/debug-flow/SKILL.md:236-237` tells every contributor debugging
 * a flow failure that all seven state ops are "atomic, CAS-guarded" — the exact
 * false enumeration this document exists to correct, in the file contributors are
 * DIRECTED to when they are already confused about state. It was never a
 * candidate, never dispositioned, and never would have been, because `.agents`
 * was not a root and no line anywhere said why not.
 *
 * A directory that is absent from `CORPUS_ROOTS` is indistinguishable from a
 * directory nobody thought about. That is round 24's lesson pointed at the roots
 * instead of at the traversal: an exclusion nobody declared is not a decision.
 *
 * So the classification is now TOTAL and asserted (`assertTotalClassification`).
 * Every tracked `.md`/`.mdx` file in the repo must fall under either a corpus
 * root or a DECLARED out-of-scope prefix carrying a reason. A new documentation
 * directory — or an old one nobody classified — fails the check until someone
 * says which it is. The oracle is `git ls-files` again, for the same reason: it
 * knows what is ours, rather than what we remembered to list.
 *
 * RUN IT
 *   node spec-poc/FIX-1154-doc-targets/check-targets.mjs
 *
 * Exit 0 = every candidate is dispositioned. Exit 1 = at least one is not, the
 * corpus itself is wrong, or some tracked prose is classified neither way.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

/**
 * The corpus, stated here so the rule cannot be applied to a narrower one.
 *
 * `docs/contributing` and `.agents` were added in round 26. Both are
 * contributor-facing prose that PRESCRIBES the routing model rather than merely
 * mentioning it, which is the property that matters — `architecture-reference.md`
 * was already a §11 target while sitting outside the corpus that is supposed to
 * select targets, and `debug-flow/SKILL.md` carried the false enumeration
 * undetected. Each contributes exactly one candidate; this is a narrow widening,
 * not a new frontier.
 */
const CORPUS_ROOTS = [
  "apps/docs",
  "docs/architecture",
  "docs/contributing",
  ".agents",
];
const CORPUS_GLOB_PACKAGE_READMES = "packages";

/**
 * Declared out of scope, with the reason. Three pattern forms, and the distinction
 * is load-bearing:
 *   `"dir/"`   — the whole subtree.
 *   `"dir/*"`  — files DIRECTLY in that directory, and no subdirectory of it.
 *   `"*"`      — repo-root files.
 *   otherwise  — an exact path.
 *
 * `docs/` is `docs/*` and not `docs/` for a reason the negative control caught:
 * a subtree catch-all on `docs/` silently absorbs every FUTURE documentation
 * directory added under it, which is the exact failure this assertion exists to
 * prevent — restated one level in. The first version of this list wrote `docs/`,
 * and a planted `docs/newarea/guide.md` carrying the subject vocabulary passed
 * the check. A catch-all is an undeclared exclusion wearing a declaration's
 * clothes.
 *
 * This list is not documentation — `assertTotalClassification` reads it, and any
 * tracked `.md`/`.mdx` matching neither it nor a corpus root fails the run. Adding
 * a directory of prose to the repo therefore forces a decision about it, which is
 * the whole point: the round-26 defect was a directory nobody had ruled either way.
 *
 * Every entry below was probed with this file's own candidate rule before being
 * excluded. Where the probe found hits, the reason says why they do not count.
 */
const OUT_OF_SCOPE = [
  [".changeset/", "release-note fragments — a record of what a past release said at the time, not a live contract (3 candidate hits, all historical)"],
  ["packages/", "package sources and CHANGELOGs. Only each package's README.md is a caller-facing contract, and that is in the corpus above (CHANGELOG hits are release history)"],
  ["apps/kitchen-sink/", "the reference app demonstrates the framework, it does not document it (probed: 0 candidates)"],
  ["apps/pattern-benchmark/", "benchmark harness notes (probed: 0 candidates)"],
  ["apps/README.md", "one-line index of the apps directory"],
  ["docs/internal/", "process artifacts — wave plans, journals, design records. They record what was believed at a moment; correcting them would falsify the record rather than fix a contract (5 candidate hits, all trading-desk design history)"],
  ["docs/atlas/", "generated from source, not authored prose (probed: 0 candidates)"],
  ["docs/superpowers/", "harness tooling notes, unrelated to the state surface (probed: 0 candidates)"],
  ["docs/*", "loose top-level docs — philosophy.md, objectives.md, PROMPT_CACHING.md (probed: 0 candidates). Direct children only: a NEW docs/<dir>/ must be classified, not absorbed"],
  ["labs/", "in-repo experiments, not shipped documentation (1 hit, about account-import atomicity — a different subject that trips the word 'atomic')"],
  ["goals/", "goal definitions (probed: 0 candidates)"],
  ["examples/", "example apps (probed: 0 candidates)"],
  ["scripts/", "build scripts (probed: 0 candidates)"],
  ["spec/", "this document and its README — the thing doing the dispositioning, not a page to disposition"],
  ["spec-poc/", "throwaway POC scaffolding on this never-merged branch"],
  ["*", "repo-root files (README, CLAUDE.md, AGENTS.md, CONTRIBUTING…) — probed: 0 candidates"],
];

/** Guarantee language — predicate (a) and (b)'s vocabulary. */
const GUARANTEE =
  /\bCAS\b|compare-and-swap|atomic|lose updates|lost update|lost writes|concurrency safety|dispatch path/i;

/** The state mutators the rule is about. */
const MUTATOR =
  /patchState|setState|incState|pushState|setStateRecord|deleteStateRecord|atomicState/;

/**
 * ...or the SUBJECT named without any verb. Round 23 built this check with
 * `MUTATOR` alone and it missed two real targets on its first run
 * (`advanced/concurrency-policies.md`, `persistence/overview.md`), because a
 * page can promise "the state layer's compare-and-swap prevents lost writes"
 * without naming a single mutator. A candidate filter drawn at the width of
 * the instance that motivated it is the same failure this whole document keeps
 * recording — so it is widened here, on the run that exposed it.
 */
const SUBJECT = /scope state|state layer|state mutator|scope write|state write/i;

/**
 * Never traversed. `statSync` follows symlinks and pnpm's `node_modules` is a
 * forest of them, so without this the corpus is the dependency tree's prose plus
 * ours. `build` / `.docusaurus` / `dist` are the same page twice — generated
 * copies of files already counted from source.
 */
const EXCLUDED = new Set(["node_modules", "build", ".docusaurus", "dist", ".git"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.mdx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The control for the defect above, and it deliberately does NOT re-check
 * `EXCLUDED`. Asserting the walk against the same list the walk consults is a
 * tautology: it catches a broken traversal but not a missing entry, which is the
 * half that actually happened. So the oracle is independent — `git ls-files`,
 * which knows what is OURS rather than what we remembered to exclude. It walks
 * symlinks no more than the index does, and dependency trees, generated output
 * and anything else foreign are all untracked by construction.
 *
 * A file in the corpus that this repo does not track means the traversal reached
 * prose the document has no standing to disposition, and every count below it is
 * meaningless — so this is a hard exit, not a warning.
 */
function assertCorpus(files) {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
  );
  const foreign = files
    .map((f) => path.relative(repoRoot, f))
    .filter((rel) => !tracked.has(rel));
  if (foreign.length > 0) {
    console.error(
      `corpus contains ${foreign.length} file(s) this repo does not track — ` +
        `the traversal escaped the documentation source:`
    );
    for (const rel of foreign.slice(0, 10)) console.error(`  ${rel}`);
    if (foreign.length > 10) console.error(`  ...and ${foreign.length - 10} more`);
    process.exit(1);
  }
}

/** Every tracked `.md` / `.mdx` path in the repo. The oracle for both assertions. */
function trackedProse() {
  return execFileSync("git", ["ls-files", "-z", "*.md", "*.mdx"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

/** True when `rel` is inside a corpus root, or is a `packages/<pkg>/README.md`. */
function inCorpus(rel) {
  if (CORPUS_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`))) return true;
  return /^packages\/[^/]+\/README\.md$/.test(rel);
}

/**
 * The round-26 control: a directory of prose that is neither walked nor declared
 * is a decision nobody made. Fails the run naming the unclassified paths, so the
 * next person must rule on them rather than inherit a silent omission.
 */
function matchesOutOfScope(rel) {
  return OUT_OF_SCOPE.some(([pattern]) => {
    if (pattern === "*") return !rel.includes("/");
    if (pattern.endsWith("/*")) {
      const dir = pattern.slice(0, -1);
      return rel.startsWith(dir) && !rel.slice(dir.length).includes("/");
    }
    if (pattern.endsWith("/")) return rel.startsWith(pattern);
    return rel === pattern;
  });
}

function assertTotalClassification(tracked) {
  const unclassified = tracked.filter(
    (rel) => !inCorpus(rel) && !matchesOutOfScope(rel)
  );
  if (unclassified.length > 0) {
    console.error(
      `${unclassified.length} tracked file(s) are in neither the corpus nor the ` +
        `declared out-of-scope list. Classify each — an exclusion nobody declared ` +
        `is not a decision:`
    );
    for (const rel of unclassified.slice(0, 20)) console.error(`  ${rel}`);
    if (unclassified.length > 20) console.error(`  ...and ${unclassified.length - 20} more`);
    process.exit(1);
  }
}

function corpusFiles() {
  const files = [];
  for (const root of CORPUS_ROOTS) {
    const abs = path.join(repoRoot, root);
    try {
      walk(abs, files);
    } catch {
      /* root absent — reported below as an empty contribution */
    }
  }
  // Every `packages/*/README.md`, the root round 22 added.
  const pkgDir = path.join(repoRoot, CORPUS_GLOB_PACKAGE_READMES);
  for (const pkg of readdirSync(pkgDir)) {
    const readme = path.join(pkgDir, pkg, "README.md");
    try {
      if (statSync(readme).isFile()) files.push(readme);
    } catch {
      /* no README — fine */
    }
  }
  return files;
}

const TRACKED_PROSE = trackedProse();
assertTotalClassification(TRACKED_PROSE);

const CORPUS = corpusFiles();
assertCorpus(CORPUS);

/**
 * A candidate: carries guarantee language AND is about scope state — either by
 * naming a mutator or by naming the subject.
 */
function candidates() {
  const found = [];
  for (const file of CORPUS) {
    const text = readFileSync(file, "utf8");
    if (!MUTATOR.test(text) && !SUBJECT.test(text)) continue;
    const hits = text
      .split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => GUARANTEE.test(line));
    if (hits.length === 0) continue;
    found.push({ file: path.relative(repoRoot, file), hits });
  }
  return found;
}

const spec = readFileSync(path.join(repoRoot, "spec/FIX-1154.md"), "utf8");
const section11 = spec.slice(spec.indexOf("### 11."), spec.indexOf("### 12."));
if (!section11) {
  console.error("could not locate §11 in spec/FIX-1154.md");
  process.exit(1);
}

/**
 * A path counts as dispositioned if §11 names it at all — as an EXTEND/QUALIFY
 * target or in the deliberately-left-alone list. Match on the repo path, and
 * also on the bare docs-site route, since published pages are referenced there
 * by route rather than by file path.
 */
function isDispositioned(file) {
  if (section11.includes(file)) return true;
  const route = file.replace(/^apps\/docs\/(docs\/)?/, "").replace(/\.mdx?$/, "");
  return section11.includes(route);
}

/**
 * The TARGET set — every distinct path §11 marks EXTEND or QUALIFY.
 *
 * §11 refuses to state this as a figure ("the target set is this list, not a
 * number") because a hand-written count goes stale the moment the section
 * widens, and it has: round 24 shipped a §10 count that no longer matched its
 * own list. But §6's Size line still owes the reader a magnitude, and "Small —
 * documentation only" understates a change that rewrites this many published
 * pages. So the count is DERIVED here rather than written down there: the Size
 * line cites this output, and widening §11 moves the number automatically.
 *
 * One path is deliberately named twice (`state/mutation-model.md` is both the
 * first EXTEND and one of the two reference pages the sweep turned up), so the
 * set is deduped — §11 says it is one target and takes one brief.
 */
function targets() {
  const lines = section11.split("\n");
  const stopAt = lines.findIndex((l) => /Deliberately left alone/.test(l));
  const end = stopAt === -1 ? lines.length : stopAt;
  const found = new Set();
  for (let i = 0; i < end; i++) {
    const line = lines[i];
    // Top-level EXTEND bullets: `- **EXTEND** \`path\``
    const extend = line.match(/^- \*\*EXTEND\*\* `([^`]+)`/);
    if (extend) {
      found.add(extend[1]);
      continue;
    }
    // QUALIFY sub-bullets: `  - \`path:line\` — ...`
    const qualify = line.match(/^\s{2,}- `([^`]+)`/);
    if (qualify) found.add(qualify[1].replace(/:[\d,\s:-]+$/, ""));
  }
  return [...found].sort();
}

const all = candidates();
const undispositioned = all.filter(({ file }) => !isDispositioned(file));
const TARGETS = targets();

// The marker names what it executed over AND what it could not reach — §10's
// evidence-marker row, applied to this file's own output. The count is
// dependency-invariant by construction: it is the same with or without
// `pnpm install`, which is the property the round-24 defect destroyed.
console.log(
  `corpus roots         : ${CORPUS_ROOTS.join(", ")}, packages/*/README.md`
);
console.log(
  `tracked prose        : ${TRACKED_PROSE.length}  (all classified: corpus or declared out of scope)`
);
console.log(
  `corpus files scanned : ${CORPUS.length}  (excluding ${[...EXCLUDED].join(", ")})`
);
console.log(`candidates           : ${all.length}`);
for (const { file, hits } of all) {
  const mark = isDispositioned(file) ? "ok" : "UNDISPOSITIONED";
  console.log(`  [${mark}] ${file}  (${hits.length} line${hits.length === 1 ? "" : "s"})`);
}

console.log(`\ndocumentation targets: ${TARGETS.length}  (distinct EXTEND/QUALIFY paths — §6's Size line cites this)`);
for (const t of TARGETS) console.log(`  ${t}`);

if (undispositioned.length > 0) {
  console.error(
    `\n${undispositioned.length} candidate(s) not named anywhere in §11.\n` +
      `Each must be marked EXTEND/QUALIFY or added to "Deliberately left alone":`
  );
  for (const { file, hits } of undispositioned) {
    for (const [lineNo, line] of hits) {
      console.error(`  ${file}:${lineNo}: ${line.trim().slice(0, 140)}`);
    }
  }
  process.exit(1);
}

console.log("\nEvery candidate is dispositioned in §11.");

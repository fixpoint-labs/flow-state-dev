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
 * THE PREDICATE WAS NARROW, AND THE DISPOSITION WAS FILE-WIDE — round 29
 * Rounds 24 and 26 both fixed the CORPUS: once for reaching too far, once for
 * reaching too narrow. Round 29's three misses were on a corpus that already
 * reached them, which retires the conclusion the evolution log had drawn from
 * that streak ("the predicates have been right since round 20").
 *
 * `docs/architecture/resource-collections.md:97` and its verbatim twin
 * `apps/docs/docs/resources/collections.md:81` say a collection instance
 * "supports the same operations as a static resource" and then list them. Once
 * FIX-1269 adds `incState` / `pushState` to `ResourceRef` — which is what a
 * collection instance IS (`types/resource-collection.ts:195-222`) — both lists
 * are wrong. Neither page carries one word of guarantee vocabulary, so neither
 * was ever a candidate: the rule selects on VOCABULARY, and an enumeration has
 * only a SHAPE. That is predicate (c) below.
 *
 * The third, `apps/docs/docs/resources/client-access.md:514`, is worse, because
 * the check reported it settled. Its one guarantee line is `:444`; §11 ruled on
 * `resources/client-access.md:444` in the deliberately-left-alone list; and
 * `isDispositioned` matches the FILE — so a ruling about one line settled all
 * 579 of them, and the enumeration 70 lines further down was never read by
 * anyone. A FILE DISPOSITIONED AT A LINE IS NOT A FILE DISPOSITIONED, hence the
 * coverage check at the bottom.
 *
 * THE TARGET EXEMPTION WAS DRAWN AGAINST (a)/(b) AND APPLIED TO (c) — round 30
 * Round 29 added predicate (c) and, in the same edit, exempted targets from line
 * coverage — justifying the exemption entirely in terms of GUARANTEE lines ("the
 * engine README alone carries nine the brief legitimately does not enumerate").
 * That justification is sound for (a)/(b) and does not transfer to (c), which the
 * exemption was never re-tested against. It is this document's own recurring
 * defect — a rule stated at the width of the instance that motivated it — aimed
 * at the exemption instead of at the rule.
 *
 * The difference is whether the brief's own instruction REACHES the line. A brief
 * saying "correct the false concurrency guarantee on this page" reaches every
 * guarantee line on it: each is an instance of that instruction, and enumerating
 * them adds nothing. It does not reach a line that makes no concurrency claim at
 * all and is stale for an unrelated reason — FIX-1269 adding two verbs to a list
 * — because that is a DIFFERENT EDIT, and a writer executing the brief perfectly
 * still leaves it wrong. `docs/architecture/state-and-scopes.md:108` is that: an
 * exhaustive "every registry write op" naming three verbs, on an EXTEND target
 * whose brief asks for a comparison table and concurrency guidance, selected by
 * (c) with no guarantee vocabulary anywhere on the line.
 *
 * So the exemption is scoped rather than removed: a target is still settled at
 * file level for (a)/(b), and must CITE its (c)-only lines — those selected by
 * shape while carrying no guarantee vocabulary. Measured before it was adopted:
 * 13 such lines across 19 targets, against 104 candidate lines in total. It does
 * not drag in the 91 guarantee lines that would turn §11 back into an inventory,
 * and the engine README's nine stay exempt exactly as round 29 intended.
 *
 * A TARGET WAS NEVER CHECKED TO EXIST — round 32
 * Every assertion above runs candidate → §11: does the document say something
 * about this page? Nothing ran §11 → filesystem: is the page this document is
 * briefing still there? Round 30's own negative control proved the gap — renaming
 * a target to a path that does not exist left the run green at 19 targets — and it
 * was deferred then because a guard might have shifted the count §6's Size line
 * cites. It does not: all 19 resolve on `origin/main` and in this checkout, so the
 * guard changes nothing today and only catches drift from here. See
 * `deadTargets` below for why it asserts rather than filters, and for the
 * oracle's boundary.
 *
 * THE CITATIONS WERE RESOLVED AGAINST A MOVING TREE — round 35
 * Round 34 made this file runnable, and runnable exposed what unrunnable had
 * hidden: every assertion here resolves §11's citations by LINE NUMBER against the
 * working tree, and §8's first deliverable is an edit to the very files those
 * numbers point into. Insert one sentence above
 * `apps/docs/docs/state/mutation-model.md:103` — which the first EXTEND brief asks
 * for in those words — and the candidate moves to `:104`, the (c)-coverage
 * assertion reports `§11 cites 103`, and the run exits 1 on work that did exactly
 * what it was told.
 *
 * A gate that fails correct work is worse than a gate that cannot run. The second
 * teaches you to fix it; the first teaches you to ignore it, and everything this
 * file asserts rests on nobody having learned to ignore it yet.
 *
 * The defect is NOT the line-scoping. That property is round 29's and it stays: a
 * ruling about one line must keep settling exactly one line, or a sentence about
 * `:444` goes on settling 579 of them. The defect is that a line number is an
 * identity only WITH RESPECT TO A TREE, and this file never named which tree.
 * §11's citations were written about the documentation as it stood when the brief
 * was written; the checker read them against the documentation as it stands now.
 * Those are the same tree right up until the implementer starts work — which is
 * the moment the check is supposed to earn its keep.
 *
 * So corpus TEXT is now read at the BASELINE (`git merge-base HEAD origin/main`,
 * the commit this branch departs from), while corpus MEMBERSHIP stays a
 * working-tree question, walked and asserted exactly as rounds 24 and 26 left it.
 * A citation resolves against the tree it was written about, so the implementer's
 * edits cannot move it, and the ruling still reaches one line and no further.
 *
 * WHY A MERGE-BASE AND NOT A PINNED SHA: when `main` moves under this branch and
 * the branch takes it, the baseline advances too and a corpus page that changed on
 * `main` is re-swept — round 33's incident (#1469 edited four corpus pages, two of
 * them §11 targets) still turns this run red. Pinning would have bought line
 * stability by going blind to that, trading one silent failure for another. A path
 * with no blob at the baseline — a page this work ADDS — falls back to the working
 * tree, so it is still scanned and still has to be dispositioned.
 *
 * WHAT IT NO LONGER SEES, declared rather than discovered, because a corpus that
 * silently reaches less far is round 26 all over again. A NEW enumeration added to
 * an EXISTING corpus page during implementation is invisible: that page's text is
 * read at the baseline, where the new line does not exist. Measured, not assumed —
 * planting one on `state/mutation-model.md` exits 1 before this change and 0 after.
 *
 * That capability was worth less than it looks. It only ever fired on a run that
 * was ALREADY red from every line the same edit had shifted, so nothing could be
 * told apart from anything else; on an implementation branch the old file is red
 * unconditionally. What is kept is the half that survives an edit intact: a page
 * with no baseline blob falls back to the working tree, so a page the work ADDS is
 * still scanned and still has to be dispositioned. Line-level assertions must be
 * baseline-scoped or they fail correct work; file-level ones need not be, and
 * closing this by sweeping the working tree at FILE level only is the obvious next
 * move if a round ever wants it back.
 *
 * MEASURED BEFORE IT WAS ADOPTED, per round 32's precondition: this branch touches
 * only `spec/` and `spec-poc/`, so the baseline corpus and the checked-out corpus
 * are byte-identical today and every count below is unchanged — 33 candidates, 20
 * targets. It changes nothing now, and only stops a false failure later.
 *
 * RUN IT
 *   node spec-poc/FIX-1154-doc-targets/check-targets.mjs
 *
 * Exit 0 = every candidate is dispositioned, at every line it was selected on.
 * Exit 1 = at least one is not, a line-scoped ruling leaves a candidate line
 * unreached, a target path does not exist, the corpus itself is wrong, or some
 * tracked prose is classified neither way.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

/**
 * THE TREE §11's LINE NUMBERS MEAN — round 35; see the header.
 *
 * The commit this branch departs from, which is the documentation §11 was written
 * about. Corpus TEXT is read here so the implementer's own edits cannot invalidate
 * a citation; corpus MEMBERSHIP is still the working-tree walk of rounds 24 and 26.
 *
 * Falls back to `main`, then to no baseline at all. That last fallback is the LOUD
 * direction, deliberately: with no baseline this file behaves exactly as round 34
 * left it, so a checkout that cannot reach `main` gets the old false FAILURE rather
 * than a quietly green run. The marker at the bottom always names which tree was
 * used, per §10's evidence-marker rule.
 */
function resolveBaseline() {
  for (const ref of ["origin/main", "main"]) {
    try {
      return execFileSync("git", ["merge-base", "HEAD", ref], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      /* ref not reachable in this checkout — try the next */
    }
  }
  return null;
}

const BASELINE = resolveBaseline();

/**
 * Every corpus path's text at the baseline, in one `cat-file --batch` pass rather
 * than a process per file. A path with no blob there is absent from the map and
 * falls back to the working tree — see the header on pages this work adds.
 */
function baselineTexts(relPaths) {
  if (!BASELINE || relPaths.length === 0) return new Map();
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: `${relPaths.map((rel) => `${BASELINE}:${rel}`).join("\n")}\n`,
    maxBuffer: 1 << 28,
  });
  const texts = new Map();
  let off = 0;
  for (const rel of relPaths) {
    const nl = out.indexOf(0x0a, off);
    if (nl === -1) break;
    const header = out.toString("utf8", off, nl);
    off = nl + 1;
    // "<sha> blob <size>" — anything else is "<rev>:<path> missing", no content.
    const m = header.match(/^[0-9a-f]+ blob (\d+)$/);
    if (!m) continue;
    const size = Number(m[1]);
    texts.set(rel, out.toString("utf8", off, off + size));
    off += size + 1; // the blob, then the LF `cat-file` appends after it
  }
  // A desynced parse would hand every LATER file another file's text, and the run
  // would stay green on line numbers computed from the wrong page — the silent
  // failure this whole file is built against. The framing is positional, so the
  // only honest check is that it consumed exactly the buffer git produced.
  if (off !== out.length) {
    console.error(
      `baseline read desynced: consumed ${off} of ${out.length} bytes from ` +
        `\`git cat-file --batch\`. Line numbers would be resolved against the wrong ` +
        `files, so this exits rather than reporting on them.`
    );
    process.exit(1);
  }
  return texts;
}

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
  ["plugins/", "harness plugin tooling — install/detection scripts and their READMEs, not documentation of the framework surface (probed: 0 candidates)"],
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
 * PREDICATE (c) — an exhaustive enumeration of a handle's write surface. Round 29.
 *
 * (a) and (b) both select on GUARANTEE vocabulary. A page that merely LISTS
 * what a handle can do, making no concurrency claim at all, carries none of it
 * and can never be a candidate — however many times the rule is re-run over
 * however wide a corpus. Three such pages were found by review:
 * `docs/architecture/resource-collections.md:97`,
 * `apps/docs/docs/resources/collections.md:81` (the same sentence verbatim) and
 * `apps/docs/docs/resources/client-access.md:514`. Two of them assert *"the same
 * operations as a static resource"* and then enumerate them — an identity claim,
 * which is an enumeration that inherits its target's defects. FIX-1269 adds two
 * methods to `ResourceRef`, and collection instances are handed that same ref
 * (`types/resource-collection.ts:195-222`), so all three go wrong the day it lands.
 *
 * The mechanical signature is a line naming two or more DISTINCT write-surface
 * verbs: one verb is a mention, several in a row is a list. Like (a) and (b) this
 * decides candidacy, not correctness — a human still rules on whether the list is
 * closed (`block-state.md:148` ends in an explicit `...`) and whether it is even
 * the right handle (the scope-handle lists are not FIX-1269's surface).
 *
 * `updateState` is in this set and NOT in `MUTATOR` above: the resource surface's
 * own callback verb was invisible to the rule that selects pages about the
 * resource surface.
 */
const WRITE_SURFACE = [
  "patchState",
  "setState",
  "updateState",
  "incState",
  "pushState",
  "setStateRecord",
  "deleteStateRecord",
  "atomicState",
];

function enumeratesWriteSurface(line) {
  let named = 0;
  for (const verb of WRITE_SURFACE) {
    if (new RegExp(`\\b${verb}\\b`).test(line) && ++named >= 2) return true;
  }
  return false;
}

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

const CORPUS_RELS = CORPUS.map((f) => path.relative(repoRoot, f));
const BASELINE_TEXTS = baselineTexts(CORPUS_RELS);

/**
 * A candidate, under either half of the rule:
 *   (a)/(b) — carries guarantee language AND is about scope state, either by
 *             naming a mutator or by naming the subject;
 *   (c)     — enumerates a handle's write surface, guarantee language or not.
 *
 * The two halves are unioned per LINE, so a file can be a candidate for one and
 * carry hits from both — which is exactly `client-access.md`, whose only (a) hit
 * is `:444` and whose (c) hit is `:514`.
 */
function candidates() {
  const found = [];
  for (const file of CORPUS) {
    const rel = path.relative(repoRoot, file);
    // Round 35: the tree the citations were written about, not the one being edited.
    const text = BASELINE_TEXTS.get(rel) ?? readFileSync(file, "utf8");
    const aboutScopeState = MUTATOR.test(text) || SUBJECT.test(text);
    const hits = text
      .split("\n")
      .map((line, i) => [i + 1, line])
      .filter(
        ([, line]) =>
          (aboutScopeState && GUARANTEE.test(line)) || enumeratesWriteSurface(line)
      );
    if (hits.length === 0) continue;
    found.push({ file: rel, hits, aboutScopeState });
  }
  return found;
}

/**
 * A line selected by (c) ALONE — an enumeration carrying no guarantee vocabulary.
 * The round-30 distinction: (a)/(b) lines are reached by a brief that says
 * "correct the guarantee on this page"; a (c)-only line is not reached by it,
 * because correcting a guarantee and adding a verb to a stale list are different
 * edits. See the header.
 */
function cSelectedOnly(line, aboutScopeState) {
  return enumeratesWriteSurface(line) && !(aboutScopeState && GUARANTEE.test(line));
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

/** The two ways §11 refers to a page: the repo path, and the bare docs-site route. */
function keysFor(file) {
  return [file, file.replace(/^apps\/docs\/(docs\/)?/, "").replace(/\.mdx?$/, "")];
}

/**
 * A FILE DISPOSITIONED AT A LINE IS NOT A FILE DISPOSITIONED — round 29.
 *
 * `isDispositioned` matches on the file, so `resources/client-access.md:444` in
 * the deliberately-left-alone list — a ruling written about one line, and true of
 * it — reported the whole 560-line page as settled. The enumeration at `:514` was
 * never looked at by anyone, and the check said so every round.
 *
 * So: every mention of a page in §11 either cites line numbers or does not.
 *   - No line cited anywhere  → a whole-file ruling, deliberate, honoured as is.
 *   - Lines cited             → the ruling reaches those lines and no further,
 *                               and every candidate hit must fall inside them.
 *
 * TARGETS ARE EXEMPT, and that is not a loophole: a target's brief owns the page
 * it is briefing, and §11 cites lines inside a target to point the writer at
 * them, not to bound what the brief covers. Applying line coverage there would
 * turn §11 back into the inventory it refuses to be — the engine README alone
 * carries nine guarantee lines the brief legitimately does not enumerate.
 *
 * Returns `null` for a whole-file ruling, otherwise the set of cited lines.
 */
function citedLines(file) {
  const cited = new Set();
  let wholeFile = false;
  for (const key of keysFor(file)) {
    let i = 0;
    while ((i = section11.indexOf(key, i)) !== -1) {
      // Accept `path.md:12`, `path:12,19`, `path:12-14` — and the bare path.
      const m = section11
        .slice(i + key.length, i + key.length + 48)
        .match(/^(?:\.mdx?)?:(\d+(?:\s*[-,]\s*\d+)*)/);
      if (m) {
        for (const part of m[1].split(",")) {
          const [from, to] = part.trim().split("-").map(Number);
          for (let n = from; n <= (to ?? from); n++) cited.add(n);
        }
      } else {
        wholeFile = true;
      }
      i += key.length;
    }
  }
  return wholeFile ? null : cited;
}

/**
 * Every line number §11 cites against a page, IGNORING whether it also names the
 * path bare. `citedLines` returns `null` the moment it sees a bare mention, which
 * is right for a whole-file ruling and useless for a target: a target is ALWAYS
 * named bare, in its own `- **EXTEND** \`path\`` bullet. So targets need the
 * union of citations rather than the whole-file verdict.
 */
function citedLinesAnywhere(file) {
  const cited = new Set();
  for (const key of keysFor(file)) {
    let i = 0;
    while ((i = section11.indexOf(key, i)) !== -1) {
      const m = section11
        .slice(i + key.length, i + key.length + 48)
        .match(/^(?:\.mdx?)?:(\d+(?:\s*[-,]\s*\d+)*)/);
      if (m) {
        for (const part of m[1].split(",")) {
          const [from, to] = part.trim().split("-").map(Number);
          for (let n = from; n <= (to ?? from); n++) cited.add(n);
        }
      }
      i += key.length;
    }
  }
  return cited;
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
 *
 * A TARGET IS A PATH — round 30, and this is not a hypothetical guard. Adding a
 * sub-bullet to a QUALIFY brief that opened with a code span (`- \`incState\` /
 * \`pushState\` → …`) matched the sub-bullet pattern below and entered the set:
 * the run reported 21 targets, two of them named `incState` and `setStateRecord`.
 * §6's Size line cites this number, so ordinary prose inside a brief could inflate
 * the one figure the document deliberately does not write by hand. Requiring a
 * path shape costs one predicate and closes it.
 */
const looksLikePath = (s) => s.includes("/") && /\.mdx?$/.test(s);

/**
 * THE SCAN IS NOT BOUNDED BY THE LEFT-ALONE HEADING — round 34.
 *
 * Round 33 anchored this scan on the phrase "Deliberately left alone" and used it
 * as a STOP: everything above it was scanned, everything below discarded. §11 then
 * gained a prose mention of that list ~167 lines above the list itself, the scan
 * stopped at the mention, and every QUALIFY sub-bullet in the back half silently
 * stopped counting. Round 33's fix tightened the pattern to the BOLD form, which
 * worked only because the prose mention happens to be italic and the heading
 * happens to be bold. That is typography, not structure: the identical failure
 * returns the day someone bolds a sentence that names the list — a natural thing
 * to write, and the very edit that caused it the first time.
 *
 * So the stop is gone. Measured before removing it: the left-alone entries are
 * prose runs of backticked paths, never bullets, so bounding the scan excluded
 * NOTHING — 20 targets with the stop, 20 without, while the round-33 loose anchor
 * reproduces the 19. The bound was pure downside: its only reachable effect was to
 * drop targets.
 *
 * The heading is still read, but now it VALIDATES instead of bounding:
 *   1. exactly one line-leading bold heading must exist — zero or several means
 *      the region is ambiguous and the count below is not trustworthy;
 *   2. no target-shaped bullet may appear after it — if a left-alone entry is ever
 *      rewritten as `- \`path\``, that is caught and named rather than silently
 *      inflating the one figure §6 does not write by hand.
 *
 * Net: this deriver can no longer under-count silently in either direction. Both
 * checks are fatal and fire BEFORE any number is printed, because a count derived
 * over an ambiguous region should not be shown at all — §10's rule about a green
 * result from a check aimed at a neighbour of the claim.
 */
const LEFT_ALONE_HEADING = /^\s*\*\*Deliberately left alone\*\*/;

function scanTargets(lines, from, to) {
  const found = new Set();
  for (let i = from; i < to; i++) {
    const line = lines[i];
    // Top-level EXTEND bullets: `- **EXTEND** \`path\``
    const extend = line.match(/^- \*\*EXTEND\*\* `([^`]+)`/);
    if (extend && looksLikePath(extend[1])) {
      found.add(extend[1]);
      continue;
    }
    // QUALIFY sub-bullets: `  - \`path:line\` — ...`
    const qualify = line.match(/^\s{2,}- `([^`]+)`/);
    if (qualify) {
      const p = qualify[1].replace(/:[\d,\s:-]+$/, "");
      if (looksLikePath(p)) found.add(p);
    }
  }
  return found;
}

function targets() {
  const lines = section11.split("\n");
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (LEFT_ALONE_HEADING.test(lines[i])) headings.push(i);
  }

  if (headings.length !== 1) {
    console.error(
      `\n§11 must carry exactly one line-leading "**Deliberately left alone**" heading; ` +
        `found ${headings.length}.\nThe target count is derived against that boundary, so an ` +
        `absent or duplicated heading makes the\ncount unverifiable. Restore the single bold ` +
        `heading (a mid-sentence mention must not lead a line).`
    );
    process.exit(1);
  }

  const found = scanTargets(lines, 0, lines.length);
  const pastHeading = scanTargets(lines, headings[0], lines.length);

  if (pastHeading.size > 0) {
    console.error(
      `\n${pastHeading.size} target-shaped bullet(s) appear AFTER "Deliberately left alone".\n` +
        `A path left alone is not a target, but written as a bullet it counts as one and inflates\n` +
        `§6's Size line. Write it as prose like its neighbours, or move it into a QUALIFY brief:`
    );
    for (const p of [...pastHeading].sort()) console.error(`  ${p}`);
    process.exit(1);
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
// Which tree §11's line numbers were resolved against — round 35. Without this the
// output cannot be told apart from the version that read the edited working tree.
const fromBaseline = CORPUS_RELS.filter((rel) => BASELINE_TEXTS.has(rel)).length;
console.log(
  BASELINE
    ? `line numbers vs     : ${BASELINE.slice(0, 9)} (merge-base with main)  ` +
        `— ${fromBaseline}/${CORPUS.length} read there, the rest from the working tree`
    : `line numbers vs     : WORKING TREE — no 'main' reachable, so citations are ` +
        `resolved against the tree being edited (round 35's false failure is live)`
);
console.log(`candidates           : ${all.length}`);
for (const { file, hits } of all) {
  const mark = isDispositioned(file) ? "ok" : "UNDISPOSITIONED";
  console.log(`  [${mark}] ${file}  (${hits.length} line${hits.length === 1 ? "" : "s"})`);
}

console.log(`\ndocumentation targets: ${TARGETS.length}  (distinct EXTEND/QUALIFY paths — §6's Size line cites this)`);
for (const t of TARGETS) console.log(`  ${t}`);

/**
 * A TARGET MUST RESOLVE TO A FILE THAT EXISTS — round 32.
 *
 * Everything above checks one direction: every CANDIDATE is named in §11. Nothing
 * checked the other: that every path §11 names is a file that is still there. So a
 * target could be a dead path and the run stayed green — confirmed by negative
 * control in round 30, where renaming a target to a path that does not exist left
 * the run green at 19 targets.
 *
 * That is not hypothetical on this branch. Round 31 alone moved 110 commits under
 * it, and the round before found the engine's own sources had moved
 * (`resources/resource-registry.ts` → `context/`, `context/resource-state-predicate.ts`
 * → `stores/`). Documentation moves the same way, and a checker that cannot tell a
 * MOVED target from a SATISFIED one reports a corpus pass over a file nobody can
 * open.
 *
 * IT ASSERTS RATHER THAN FILTERS, deliberately. Dropping a dead path from the set
 * would make the target count — the one figure §6's Size line does not write by
 * hand — quietly shrink when a page is renamed, converting a loud failure into a
 * silent one. This can only turn a green run red; it can never move a number. That
 * property was the precondition for adding it at all: all 20 targets resolve today,
 * on `origin/main` (`git ls-tree`) and in this checkout, so it changes nothing now
 * and only catches drift from here.
 *
 * THE ORACLE'S BOUNDARY, per §10's evidence-marker rule. It is `TRACKED_PROSE` —
 * this CHECKOUT's `git ls-files`, the same oracle `assertCorpus` and
 * `assertTotalClassification` already trust. It therefore answers "does this path
 * exist in the tree the checker is running against", NOT "does it exist on `main`".
 * On this spec branch, whose tree is the 2e046e96 base, a target that moved on
 * `main` afterwards still resolves here. That is the right oracle at the moment
 * that matters — §8 step 1 runs this from a branch cut off current `main`, where
 * the checkout IS main's documentation — and the wrong one for reasoning about
 * `main` from this branch, which is what the Part II anchor note is for.
 */
const trackedSet = new Set(TRACKED_PROSE);
const deadTargets = TARGETS.filter((t) => !trackedSet.has(t));

if (deadTargets.length > 0) {
  console.error(
    `\n${deadTargets.length} target path(s) do not exist in this checkout. §11 is briefing a\n` +
      `file nobody can open — it moved, was renamed, or the path is a typo. A moved target is\n` +
      `indistinguishable from a satisfied one without this check:`
  );
  for (const t of deadTargets) console.error(`  ${t}`);
  process.exit(1);
}

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

// Line-level coverage for everything §11 rules on WITHOUT briefing it as a target.
const targetSet = new Set(TARGETS);
const uncovered = [];
for (const { file, hits } of all) {
  if (targetSet.has(file)) continue;
  const cited = citedLines(file);
  if (cited === null) continue; // deliberate whole-file ruling
  const missed = hits.filter(([lineNo]) => !cited.has(lineNo));
  if (missed.length > 0) uncovered.push({ file, cited, missed });
}

if (uncovered.length > 0) {
  console.error(
    `\n${uncovered.length} page(s) are ruled on at specific lines, but carry candidate ` +
      `lines those rulings do not reach. A file dispositioned at a line is not a file\n` +
      `dispositioned — extend the citation, or make it a target:`
  );
  for (const { file, cited, missed } of uncovered) {
    console.error(`  ${file}  (§11 cites ${[...cited].sort((a, b) => a - b).join(", ")})`);
    for (const [lineNo, line] of missed) {
      console.error(`    :${lineNo}: ${line.trim().slice(0, 132)}`);
    }
  }
  process.exit(1);
}

// A target's brief owns the page for (a)/(b), and must CITE its (c)-only lines —
// the ones its own instruction does not reach. Round 30; see the header.
const targetCGaps = [];
for (const { file, hits, aboutScopeState } of all) {
  if (!targetSet.has(file)) continue;
  const cOnly = hits.filter(([, line]) => cSelectedOnly(line, aboutScopeState));
  if (cOnly.length === 0) continue;
  const cited = citedLinesAnywhere(file);
  const missed = cOnly.filter(([lineNo]) => !cited.has(lineNo));
  if (missed.length > 0) targetCGaps.push({ file, cited, missed });
}

if (targetCGaps.length > 0) {
  console.error(
    `\n${targetCGaps.length} target(s) carry enumeration-only lines their brief does not name.\n` +
      `A brief that corrects a guarantee does not reach a list that is merely going stale —\n` +
      `different defect, different edit. Cite the line in the brief, or rule it open:`
  );
  for (const { file, cited, missed } of targetCGaps) {
    const shown = [...cited].sort((a, b) => a - b).join(", ") || "no lines";
    console.error(`  ${file}  (§11 cites ${shown})`);
    for (const [lineNo, line] of missed) {
      console.error(`    :${lineNo}: ${line.trim().slice(0, 132)}`);
    }
  }
  process.exit(1);
}

console.log(
  "\nEvery candidate is dispositioned in §11, at every line it was selected on,\n" +
    "and every target names the enumeration-only lines its brief does not reach."
);

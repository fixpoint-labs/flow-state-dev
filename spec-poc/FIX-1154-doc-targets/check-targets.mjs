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
 * RUN IT
 *   node spec-poc/FIX-1154-doc-targets/check-targets.mjs
 *
 * Exit 0 = every candidate is dispositioned. Exit 1 = at least one is not.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

/** The corpus, stated here so the rule cannot be applied to a narrower one. */
const CORPUS_ROOTS = ["apps/docs", "docs/architecture"];
const CORPUS_GLOB_PACKAGE_READMES = "packages";

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

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.mdx?$/.test(entry)) out.push(full);
  }
  return out;
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

/**
 * A candidate: carries guarantee language AND is about scope state — either by
 * naming a mutator or by naming the subject.
 */
function candidates() {
  const found = [];
  for (const file of corpusFiles()) {
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

const all = candidates();
const undispositioned = all.filter(({ file }) => !isDispositioned(file));

console.log(`corpus files scanned : ${corpusFiles().length}`);
console.log(`candidates           : ${all.length}`);
for (const { file, hits } of all) {
  const mark = isDispositioned(file) ? "ok" : "UNDISPOSITIONED";
  console.log(`  [${mark}] ${file}  (${hits.length} line${hits.length === 1 ? "" : "s"})`);
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

console.log("\nEvery candidate is dispositioned in §11.");

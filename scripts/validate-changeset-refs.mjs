#!/usr/bin/env node
/**
 * Every changeset names the Linear issue it came from.
 *
 * Specs are not kept in the repo — Linear holds them — so the changeset is the
 * link between a shipped, released change and the reasoning behind it. Without
 * the issue id in the fragment, a CHANGELOG entry has no route back.
 *
 * Scoped to fragments this branch adds or edits (BP-022), so the rule applies
 * going forward without a backfill of every fragment written before it existed.
 * Empty fragments (`pnpm changeset --empty`, internal-only work) release
 * nothing and are skipped.
 *
 * WHAT THIS MEASURES: "did the author of this release note name their issue" —
 * NOT "did this PR's diff touch the file". The two came apart during the
 * `@flow-state-dev/cli` -> `fsdev` rename (FIX-1191), which had to rewrite the
 * package key in thirteen old fragments (otherwise `changeset version` fails on
 * a name that no longer resolves) and so was held answerable for a dozen
 * strangers' release notes, demanding ids it had no way to know.
 *
 * Three cases, and each branch below exists for one of them:
 *
 *   1. A NEW fragment with no issue id                     -> fails.
 *   2. An EXISTING fragment whose BODY is edited, no id     -> fails.
 *   3. An EXISTING fragment whose ONLY change is a
 *      package-name rekey                                   -> passes.
 *
 * `isMechanicalRekey` is case 3 and nothing wider. Do NOT "simplify" this to
 * `--diff-filter=A`: that was tried, and it silently permits case 2 — someone
 * can replace a release note's entire body, or bolt on a package bump, and the
 * guard says nothing. Trading "fires when it shouldn't" for "silent when it
 * should" is the same defect pointed the other way. If you change this, keep
 * all three cases and prove them.
 *
 * No dependencies, so CI runs it without an install.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** A Linear issue id: team prefix, dash, number. Matches FIX-123 and future teams. */
const ISSUE_REF = /\b[A-Z]{2,6}-\d+\b/;

/** A frontmatter line naming a package and a bump — `"@scope/pkg": patch`. */
const PACKAGE_BUMP = /^\s*['"][^'"]+['"]\s*:\s*(patch|minor|major)\s*$/m;

const BASE = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : "origin/main";

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Added and modified fragments, as `{ status, path }`. */
function changedChangesets() {
  let out;
  try {
    out = git(["diff", "--name-status", "--diff-filter=AM", `${BASE}...HEAD`, "--", ".changeset"]);
  } catch (error) {
    console.error(
      `\n✗ Could not diff against ${BASE} to find new changesets.` +
        `\n  In CI this means the checkout is shallow — set 'fetch-depth: 0'.` +
        `\n  Locally, fetch the base branch first.\n\n  ${error.message}\n`,
    );
    process.exit(1);
  }
  return out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([status, path]) => status && path?.endsWith(".md") && !path.endsWith("README.md"))
    .map(([status, path]) => ({ status, path }));
}

/** Splits a fragment into its frontmatter block and its body. */
function parse(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

/**
 * The bump levels a frontmatter declares, sorted, with the package names
 * dropped. Two fragments share a shape when they bump the same number of
 * packages at the same levels — so a pure rename matches, while adding a
 * package, removing one, or changing a bump does not.
 */
function bumpShape(frontmatter) {
  return [...frontmatter.matchAll(/^\s*['"][^'"]+['"]\s*:\s*(patch|minor|major)\s*$/gm)]
    .map((match) => match[1])
    .sort()
    .join(",");
}

/**
 * Case 3: a modified fragment whose only change is a package-name rekey.
 *
 * Exempt, because renaming a package is a mechanical edit forced on every old
 * fragment that bumps it — it does not make the sweep's author the author of
 * someone else's release note. The line is drawn narrowly: the body must be
 * byte-identical, and the same packages must still be bumped at the same
 * levels. A body edit (case 2) or an added/removed/re-levelled package is
 * authorship and still needs the reference.
 */
function isMechanicalRekey(path, current) {
  let previous;
  try {
    previous = parse(git(["show", `${MERGE_BASE}:${path}`]));
  } catch {
    return false; // Not on the base after all — treat as new.
  }
  if (!previous) return false;
  return (
    previous.body === current.body &&
    bumpShape(previous.frontmatter) === bumpShape(current.frontmatter)
  );
}

const MERGE_BASE = (() => {
  try {
    return git(["merge-base", BASE, "HEAD"]).trim();
  } catch {
    return BASE;
  }
})();

const offenders = [];

for (const { status, path } of changedChangesets()) {
  const full = join(ROOT, path);
  if (!existsSync(full)) continue; // Renamed or removed after the diff was taken.

  const parsed = parse(readFileSync(full, "utf8"));
  if (!parsed) {
    offenders.push({ path, reason: "no changeset frontmatter" });
    continue;
  }
  if (!PACKAGE_BUMP.test(parsed.frontmatter)) continue; // Empty fragment — releases nothing.
  if (status === "M" && isMechanicalRekey(path, parsed)) continue; // Case 3 — a rekey.
  if (!ISSUE_REF.test(parsed.body)) {
    offenders.push({ path, reason: "no Linear issue id in the body" });
  }
}

if (offenders.length === 0) {
  console.log("✓ every new changeset names its Linear issue");
  process.exit(0);
}

console.error(`\n✗ ${offenders.length} changeset(s) missing a Linear issue reference:\n`);
for (const { path, reason } of offenders) console.error(`    ${path}  (${reason})`);
if (offenders.length > 3) {
  console.error(
    `\n  That is a lot for one branch — if these are fragments you did not write,` +
      `\n  the base ref is stale and they only look new. Run 'git fetch origin main'` +
      `\n  and try again.`,
  );
}
console.error(
  `\n  Name the issue in the fragment body so a released change traces back to` +
    `\n  its spec and discussion in Linear — the repo keeps no spec copy.` +
    `\n\n  ---` +
    `\n  "@flow-state-dev/engine": patch` +
    `\n  ---` +
    `\n` +
    `\n  One-sentence user-facing description (FIX-123).\n`,
);
process.exit(1);

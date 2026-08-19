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
 * `@flow-state-dev/cli` -> `@flow-state-dev/fsdev` rename (FIX-1191), which had to rewrite the
 * package key in fourteen old fragments (otherwise `changeset version` fails on
 * a name that no longer resolves) and so was held answerable for a dozen
 * strangers' release notes, demanding ids it had no way to know.
 *
 * Five cases. Each is exercised; keep it that way if you touch this.
 *
 *   1.  NEW fragment, no issue id                            -> fails.
 *   2.  EXISTING fragment, BODY edited, no id                -> fails.
 *   2b. EXISTING fragment, package bump ADDED, no id         -> fails.
 *   2c. EXISTING fragment, package SWAPPED for an unrelated
 *       one at the same bump level, no id                    -> fails.
 *   3.  EXISTING fragment, only `RENAMED_PACKAGES` applied   -> passes.
 *
 * THIS GUARD HAS ALREADY REGRESSED THREE TIMES, each fix opening a smaller
 * hole than the one it closed:
 *
 *   `--diff-filter=AM`  fired at whoever's diff touched a file  (wrong people)
 *   `--diff-filter=A`   went silent on case 2                   (too weak)
 *   bump-shape compare  went silent on case 2c                  (too general)
 *
 * The pattern is generalising the exemption. It terminates by naming the exact
 * thing: `RENAMED_PACKAGES` is one specific migration, not a class of edit.
 * If you are tempted to widen it — "any same-level swap", "any body-preserving
 * change" — that is the regress restarting, and case 2c is the probe that
 * catches it. Add a mapping entry for a real rename instead.
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
 * The package renames this exemption exists for — old name -> new name.
 *
 * Deliberately an exact mapping, NOT a general "a package was swapped" rule.
 * A shape rule (compare bump levels, discard the names) was tried here and was
 * broken in review within the hour: because it ignored package identity,
 * replacing `"@flow-state-dev/fsdev": patch` with `"@flow-state-dev/core": patch` read as
 * mechanical, so a release note and its version bump could be retargeted onto
 * a different package with no issue reference and no complaint. Silently
 * moving a version bump is worse than the over-firing this exemption was
 * added to stop.
 *
 * Naming the specific migration makes the exemption impossible to reuse for
 * anything else, and trivially deletable once the last pre-rename fragment has
 * been released — a property no general rule has.
 */
const RENAMED_PACKAGES = new Map([["@flow-state-dev/cli", "@flow-state-dev/fsdev"]]);

/** `[name, bump]` per package a frontmatter bumps, in declaration order. */
function packageBumps(frontmatter) {
  return [...frontmatter.matchAll(/^\s*['"]([^'"]+)['"]\s*:\s*(patch|minor|major)\s*$/gm)].map(
    (match) => [match[1], match[2]],
  );
}

/**
 * Case 3: a modified fragment whose only change is applying `RENAMED_PACKAGES`.
 *
 * Exempt, because a rename is an edit forced on every old fragment that bumps
 * the renamed package — it does not make the sweep's author the author of
 * someone else's release note. Everything else is authorship: the body must be
 * byte-identical, and every package must be either untouched or exactly the
 * mapped rename, at the same bump level and in the same position.
 */
function isMechanicalRekey(path, current) {
  let previous;
  try {
    previous = parse(git(["show", `${MERGE_BASE}:${path}`]));
  } catch {
    return false; // Not on the base after all — treat as new.
  }
  if (!previous) return false;
  if (previous.body !== current.body) return false;

  const before = packageBumps(previous.frontmatter);
  const after = packageBumps(current.frontmatter);
  if (before.length !== after.length) return false;

  return before.every(([name, bump], index) => {
    const [currentName, currentBump] = after[index];
    return currentBump === bump && currentName === (RENAMED_PACKAGES.get(name) ?? name);
  });
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

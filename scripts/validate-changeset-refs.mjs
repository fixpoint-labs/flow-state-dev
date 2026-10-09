#!/usr/bin/env node
/**
 * Every changeset names the Linear issue it came from.
 *
 * Specs are not kept in the repo — Linear holds them — so the changeset is the
 * link between a shipped, released change and the reasoning behind it. Without
 * the issue id in the fragment, a CHANGELOG entry has no route back.
 *
 * THIS DOES NOT REQUIRE A CHANGESET. Under BP-022 most PRs have none, and a PR
 * with no fragment passes here trivially. The rule is conditional: *if* you
 * wrote one, name the issue. Do not read a green result as "the changeset
 * question was answered" — a missing fragment and a correct absence look
 * identical to this script, deliberately, because deciding between them needs a
 * human's read of who the change is visible to.
 *
 * Scoped to fragments this branch adds or edits (BP-022), so the rule applies
 * going forward without a backfill of every fragment written before it existed.
 * The 422 fragments written before the first release were archived to
 * `docs/internal/archive/changesets/` rather than released; nothing there is in
 * scope, because this only ever looks inside `.changeset`. Empty fragments
 * (`pnpm changeset --empty`) release nothing and are skipped.
 *
 * Two cases. Each is exercised; keep it that way if you touch this.
 *
 *   1.  NEW fragment, no issue id                            -> fails.
 *   2.  EXISTING fragment, edited, no id                     -> fails.
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

/** Added and modified fragments, as `{ path }`. */
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
    .map(([, path]) => ({ path }));
}

/** Splits a fragment into its frontmatter block and its body. */
function parse(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

const offenders = [];

for (const { path } of changedChangesets()) {
  const full = join(ROOT, path);
  if (!existsSync(full)) continue; // Renamed or removed after the diff was taken.

  const parsed = parse(readFileSync(full, "utf8"));
  if (!parsed) {
    offenders.push({ path, reason: "no changeset frontmatter" });
    continue;
  }
  if (!PACKAGE_BUMP.test(parsed.frontmatter)) continue; // Empty fragment — releases nothing.
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
    `\n  its retained repository spec and Linear discussion when they exist.` +
    `\n\n  ---` +
    `\n  "@flow-state-dev/engine": patch` +
    `\n  ---` +
    `\n` +
    `\n  One-sentence user-facing description (FIX-123).\n`,
);
process.exit(1);

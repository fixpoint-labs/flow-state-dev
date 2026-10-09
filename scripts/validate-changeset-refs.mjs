#!/usr/bin/env node
/**
 * Every changeset names the Linear issue it came from.
 *
 * The changeset is the link between a shipped, released change and the issue
 * behind it, which links its retained spec under `specs/` when one exists.
 * Without the issue id in the fragment, a CHANGELOG entry has no route back.
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
 * A well-formed id can still be the wrong one, so a fragment this PR ADDS must
 * cite at least one of this PR's own issue ids, read from its branch name and
 * title — never its description, which is where a PR names its neighbours (a
 * wrong id once passed green that way). An EDITED fragment is usually someone
 * else's release note, so it keeps the presence check only. When the branch and
 * title name no id there is nothing to match against, and the match is skipped.
 *
 * Because the title is an input, CI runs this in its own workflow that also
 * triggers on PR edits (`.github/workflows/changeset-refs.yml`).
 *
 * Cases, each exercised in `packages/core/test/changeset-refs-check.test.ts`:
 *
 *   1.  NEW fragment, no issue id                            -> fails.
 *   2.  EXISTING fragment, edited, no id                     -> fails.
 *   3.  NEW fragment, no id that is this PR's issue          -> fails.
 *   4.  Only a sub-PR id such as `LAB-138a`                  -> fails, naming
 *       the bare parent id to cite instead.
 *
 * No dependencies, so CI runs it without an install.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** Every Linear issue id in a fragment body: team prefix, dash, number. FIX-123 and future teams. */
const ISSUE_REFS = /\b[A-Z]{2,6}-\d+\b/g;

/**
 * An id with a sub-PR letter, `LAB-138a`. Not an issue id — sub-PRs of one
 * issue cite that issue — but named in the failure so the author knows why.
 */
const SUFFIXED_REF = /\b([A-Z]{2,6}-\d+)[a-z]\b/;

/**
 * An id in a branch name: any case, and the number must end at a separator, so
 * a random suffix such as `project-thread-8ra0ke` is not read as `THREAD-8`.
 * One trailing letter is a sub-PR (`lab-138a`) and is dropped.
 */
const BRANCH_ID = /(?<![A-Za-z])([A-Za-z]{2,6})-(\d+)[a-z]?(?![0-9A-Za-z])/g;

/** An id in a PR title, with a sub-PR letter dropped: `(LAB-138a)` is LAB-138. */
const TITLE_ID = /\b([A-Z]{2,6})-(\d+)[a-z]?\b/g;

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

/** The PR's head branch in CI, else the checked-out branch. */
function currentBranch() {
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  try {
    return git(["branch", "--show-current"]).trim();
  } catch {
    return "";
  }
}

/**
 * The PR title from the event payload Actions writes for the run. Absent on a
 * local run and on a push; an unreadable payload falls back to the branch alone
 * rather than failing the guard on its own plumbing.
 */
function prTitle() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return "";
  try {
    return JSON.parse(readFileSync(path, "utf8")).pull_request?.title ?? "";
  } catch {
    return "";
  }
}

/** Splits a fragment into its frontmatter block and its body. */
function parse(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n?---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

/**
 * This PR's own issue ids, as `{ id, from }`, read from its branch name and
 * title. Never from its description: that is where a PR names its neighbours.
 */
export function issueIdsFromPr({ branch = "", title = "" }) {
  const found = new Map();
  for (const [, team, number] of branch.matchAll(BRANCH_ID)) {
    const id = `${team.toUpperCase()}-${number}`;
    if (!found.has(id)) found.set(id, "branch");
  }
  for (const [, team, number] of title.matchAll(TITLE_ID)) {
    const id = `${team}-${number}`;
    if (!found.has(id)) found.set(id, "title");
  }
  return [...found].map(([id, from]) => ({ id, from }));
}

/**
 * The fragments that fail, as `{ path, reason }`.
 *
 * @param fragments `{ status: "A" | "M", path, source }` per changed fragment.
 * @param prIds     This PR's issue ids, from `issueIdsFromPr`.
 */
export function findOffenders(fragments, prIds) {
  const own = new Set(prIds.map(({ id }) => id));
  const offenders = [];
  for (const { status, path, source } of fragments) {
    const parsed = parse(source);
    if (!parsed) {
      offenders.push({ path, reason: "no changeset frontmatter" });
      continue;
    }
    if (!PACKAGE_BUMP.test(parsed.frontmatter)) continue; // Empty fragment — releases nothing.

    const cited = [...new Set(parsed.body.match(ISSUE_REFS) ?? [])];
    if (cited.length === 0) {
      const suffixed = parsed.body.match(SUFFIXED_REF);
      offenders.push({
        path,
        reason: suffixed
          ? `found "${suffixed[0]}"; cite the bare parent id "${suffixed[1]}"`
          : "no Linear issue id in the body",
      });
      continue;
    }

    // Only a fragment this PR adds is its author's to answer for. An edited one
    // is usually someone else's release note, citing their issue, not this PR's.
    if (status !== "A" || own.size === 0) continue;
    if (cited.some((id) => own.has(id))) continue;
    const named = prIds.map(({ id, from }) => `${id} (from its ${from})`).join(", ");
    offenders.push({
      path,
      reason: `cites ${cited.join(", ")}; this PR is ${named}`,
      mismatch: { cited, own: prIds.map(({ id }) => id) },
    });
  }
  return offenders;
}

function main() {
  const fragments = [];
  for (const { status, path } of changedChangesets()) {
    const full = join(ROOT, path);
    if (!existsSync(full)) continue; // Renamed or removed after the diff was taken.
    fragments.push({ status, path, source: readFileSync(full, "utf8") });
  }
  const prIds = issueIdsFromPr({ branch: currentBranch(), title: prTitle() });
  if (prIds.length === 0 && fragments.length > 0) {
    console.log(
      "  note: this PR's branch and title name no issue id, so fragments were checked for" +
        "\n  an id but not matched against this PR's issue.",
    );
  }
  const offenders = findOffenders(fragments, prIds);

  if (offenders.length === 0) {
    console.log("✓ every new changeset names its Linear issue");
    process.exit(0);
  }

  console.error(`\n✗ ${offenders.length} changeset(s) do not name their issue correctly:\n`);
  for (const { path, reason, mismatch } of offenders) {
    console.error(`    ${path}  (${reason})`);
    if (mismatch) {
      const [cited] = mismatch.cited;
      const [own] = mismatch.own;
      console.error(
        `      If the fragment is right to cite ${cited}, name ${own} in it too,` +
          ` e.g. "(${cited}, part of ${own})",` +
          `\n      or add ${cited} to the PR title (editing the title re-runs this check).`,
      );
    }
  }
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
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

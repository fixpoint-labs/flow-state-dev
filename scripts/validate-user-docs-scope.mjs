#!/usr/bin/env node
/**
 * User docs change only in the release docs PR.
 *
 * User docs (the Docusaurus site and package READMEs) describe what a person can
 * install today. They are written once per release by `/release-docs`, from the
 * pending changesets, on a `release-docs/*` branch, and reviewed as one PR. A
 * normal PR records what users need to know in its changeset and leaves the
 * pages alone. See `docs/contributing/release-docs.md`.
 *
 * A PR passes when it touches none of the user-doc paths, or when:
 *   - its head branch starts with `release-docs/` (the release pass), or
 *   - it carries the `docs-fix` label (correcting docs for something already
 *     released: a typo, a wrong example, a broken link).
 *
 * Site code (`apps/docs/src`, config, scripts) is not prose and is not guarded.
 *
 * Labels are an input, so CI runs this in its own workflow that also triggers on
 * `labeled`/`unlabeled` (`.github/workflows/user-docs-scope.yml`).
 *
 * Cases are exercised in `packages/core/test/user-docs-scope-check.test.ts`.
 * No dependencies, so CI runs it without an install.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

/** Paths whose prose a user reads. Package READMEs ship to npm with the package. */
const USER_DOC_PATHS = [
  /^apps\/docs\/docs\//,
  /^apps\/docs\/guides\//,
  /^apps\/docs\/blog\//,
  /^apps\/docs\/sidebars[^/]*\.ts$/,
  // The release gate's manifest: only the release docs PR may say docs are done.
  /^apps\/docs\/release-docs\.json$/,
  /^packages\/[^/]+\/README\.md$/,
];

export const RELEASE_BRANCH_PREFIX = "release-docs/";
export const FIX_LABEL = "docs-fix";

export function isUserDoc(path) {
  return USER_DOC_PATHS.some((pattern) => pattern.test(path));
}

/** The user-doc files this PR may not touch; empty means it passes. */
export function findBlocked(files, { branch = "", labels = [] } = {}) {
  if (branch.startsWith(RELEASE_BRANCH_PREFIX)) return [];
  if (labels.includes(FIX_LABEL)) return [];
  return files.filter(isUserDoc);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function changedFiles() {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
  const out = git(["diff", "--name-only", "--diff-filter=ACMRD", `${base}...HEAD`]);
  return out === "" ? [] : out.split("\n");
}

function prContext() {
  const branch = process.env.GITHUB_HEAD_REF || git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let labels = [];
  if (eventPath && existsSync(eventPath)) {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    labels = (event.pull_request?.labels ?? []).map((label) => label.name);
  }
  return { branch, labels };
}

function main() {
  const blocked = findBlocked(changedFiles(), prContext());
  if (blocked.length === 0) {
    console.log("User docs untouched, or this is the release docs PR / a docs-fix.");
    process.exit(0);
  }
  console.error("This PR edits user docs. User docs are written at release, not per PR:\n");
  for (const path of blocked) console.error(`  ${path}`);
  console.error(
    [
      "",
      "Revert these files and put what a user needs to know in your changeset instead",
      "(add a `Docs:` line naming the page, if you know it). `/release-docs` writes the pages",
      "for the whole release in one PR.",
      "",
      `Correcting docs for something already released? Add the \`${FIX_LABEL}\` label.`,
      "See docs/contributing/release-docs.md.",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

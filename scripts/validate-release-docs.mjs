#!/usr/bin/env node
/**
 * The Version Packages PR can't merge until docs cover every changeset it releases.
 *
 * `/release-docs` writes the user docs for a release in one PR and records every
 * changeset it reviewed in `apps/docs/release-docs.json` — including the ones it
 * decided needed no page change. This check runs on the Version Packages PR
 * (head `changeset-release/main`) and fails while any changeset that PR consumes
 * is missing from that manifest. A changeset that lands after the docs PR turns
 * it red again, so the skill runs again for the new ones.
 *
 * The manifest is a user-doc path (`validate-user-docs-scope.mjs`), so only the
 * release docs PR can change it.
 *
 * Empty changesets (`pnpm changeset --empty`) release nothing and are skipped.
 *
 * Cases are exercised in `packages/core/test/release-docs-check.test.ts`.
 * No dependencies, so CI runs it without an install.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
export const MANIFEST = "apps/docs/release-docs.json";

/** A frontmatter line naming a package and a bump — `"@scope/pkg": patch`. */
const PACKAGE_BUMP = /^\s*['"][^'"]+['"]\s*:\s*(patch|minor|major)\s*$/m;

/** `.changeset/postgres-bus.md` → `postgres-bus`; null for README and non-fragments. */
export function changesetId(path) {
  const match = /^\.changeset\/([^/]+)\.md$/.exec(path);
  if (!match || match[1] === "README") return null;
  return match[1];
}

export function isEmptyChangeset(source) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] ?? "";
  return !PACKAGE_BUMP.test(frontmatter);
}

/** Changeset ids this release consumes that the docs pass has not reviewed. */
export function findUndocumented(consumedIds, manifest) {
  const reviewed = new Set(manifest?.changesets ?? []);
  return consumedIds.filter((id) => !reviewed.has(id));
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function consumedChangesets(base) {
  const out = git(["diff", "--name-only", "--diff-filter=D", `${base}...HEAD`, "--", ".changeset"]);
  if (out === "") return [];
  return out
    .split("\n")
    .map((path) => ({ path, id: changesetId(path) }))
    .filter(({ id }) => id !== null)
    .filter(({ path }) => !isEmptyChangeset(git(["show", `${base}:${path}`])))
    .map(({ id }) => id);
}

function readManifest() {
  const path = join(ROOT, MANIFEST);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function main() {
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
  const consumed = consumedChangesets(base);
  const missing = findUndocumented(consumed, readManifest());
  if (missing.length === 0) {
    console.log(`Release docs cover all ${consumed.length} changeset(s) in this release.`);
    process.exit(0);
  }
  console.error(`Release docs have not covered ${missing.length} changeset(s) in this release:\n`);
  for (const id of missing) console.error(`  .changeset/${id}.md`);
  console.error(
    [
      "",
      "Run `/release-docs` (locally in a new Claude session, or Actions > Release docs > Run",
      "workflow) and merge its PR. This PR rebuilds from main and the check re-runs.",
      "See docs/contributing/release-docs.md.",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

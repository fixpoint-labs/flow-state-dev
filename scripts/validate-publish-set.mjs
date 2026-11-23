#!/usr/bin/env node
/**
 * Guards the packages we have decided not to ship to npm.
 *
 * `changeset publish` builds its candidate list from one field — `private` in a
 * package's own `package.json`. Nothing else gates it: `.changeset/config.json`'s
 * `ignore` list is read by `changeset version` and not by publish, so a package
 * listed there is frozen at its current version and then published at it. That
 * makes the exclusion a single boolean in a single file, with no test between it
 * and an irreversible first publication — npm gives the name away permanently,
 * and unpublishing is a 72-hour window with conditions.
 *
 * So this asserts the one thing that matters: every package we have decided not
 * to ship still carries `private: true`. Deleting the field is then a red check
 * rather than a surprise on the release run.
 *
 * It also reads every pending changeset against the workspace, because the
 * same field decides what `changeset version` will take. `privatePackages:
 * { version: false }` skips every private package, and `changeset version`
 * rejects a fragment that names a skipped package beside a published one, or a
 * name no workspace package has. It fails the whole run, not that fragment, so
 * one bad note stops the Version Packages PR for every release behind it
 * (FIX-870, FIX-2885). A fragment may name published packages only (BP-022);
 * this is checked on every PR, not first met by the release job.
 *
 * `--changesets` runs that second check alone. It reads each fragment with
 * Changesets' own parser (`@changesets/parse`, resolved through the installed
 * `@changesets/cli` so it is the copy `changeset version` runs), so a fragment
 * it can't parse fails here exactly as it would there. That needs the install,
 * so CI runs it in the Export check job; the default run needs no dependencies
 * and stays in Process guards.
 *
 * Exits non-zero naming the package or fragment and the fix.
 */

import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { workspaceManifests } from "./workspace-members.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

/**
 * Packages that must never reach npm, by workspace directory under `packages/`.
 *
 * `@thought-fabric/core` is a library we build and consume in-repo but have
 * chosen not to publish — the only consumer is the private kitchen-sink app,
 * over a workspace link. It keeps its publish metadata so the decision is one
 * line to reverse; that metadata is exactly why the flag needs a guard.
 *
 * `packages/ui` and `packages/integration-tests` are private for their own
 * reasons (a Vercel-deployed app and a test suite) and are covered by the same
 * check, so removing `private` from either is caught too.
 */
const NEVER_PUBLISH = ["thought-fabric-core", "ui", "integration-tests"];

/**
 * Read the named workspace packages and return the ones that would publish.
 *
 * Exported so a test can drive it against fixtures, and so the list itself can
 * be asserted, without depending on the repo's real manifests staying still.
 *
 * @param {string[]} dirs — directory names under `packages/`.
 * @param {(dir: string) => { name?: string, private?: boolean }} read — manifest reader.
 */
export function findPublishable(dirs, read) {
  const offenders = [];
  for (const dir of dirs) {
    let manifest;
    try {
      manifest = read(dir);
    } catch {
      offenders.push({
        dir,
        name: null,
        reason: "manifest is missing or unreadable",
      });
      continue;
    }
    if (manifest.private !== true) {
      offenders.push({
        dir,
        name: manifest.name ?? null,
        reason: 'no "private": true',
      });
    }
  }
  return offenders;
}

/**
 * The parser `changeset version` reads fragments with, from the installed `@changesets/cli`.
 * @returns {(source: string) => { releases: { name: string, type: string }[], summary: string }}
 */
export function loadChangesetParser() {
  const fromCli = createRequire(createRequire(import.meta.url).resolve("@changesets/cli/package.json"));
  const parse = fromCli("@changesets/parse");
  return parse.default ?? parse;
}

/**
 * The pending fragments that `changeset version` would refuse, as `{ path, name, reason }`:
 * one its parser throws on, and each release that names a private package or a name no
 * workspace package has.
 *
 * Exported so a test can drive it against fixtures.
 *
 * @param {{ path: string, source: string }[]} fragments — `.changeset/*.md` other than the README.
 * @param {Map<string, boolean>} packages — each workspace package's name and whether it is private.
 * @param {ReturnType<typeof loadChangesetParser>} parse — Changesets' fragment parser.
 */
export function findUnversionable(fragments, packages, parse) {
  const offenders = [];
  for (const { path, source } of fragments) {
    let releases;
    try {
      ({ releases } = parse(source));
    } catch (error) {
      offenders.push({ path, name: null, reason: `cannot be parsed: ${String(error.message).split("\n")[0]}` });
      continue;
    }
    for (const { name } of releases) {
      if (!packages.has(name)) offenders.push({ path, name, reason: "is not a workspace package" });
      else if (packages.get(name)) offenders.push({ path, name, reason: "is private, so changeset version skips it" });
    }
  }
  return offenders;
}

/** Each workspace package's name and whether it is private, from the shared workspace parser. */
function readWorkspace() {
  const packages = new Map();
  for (const file of workspaceManifests(ROOT)) {
    const manifest = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
    if (manifest.name) packages.set(manifest.name, manifest.private === true);
  }
  return packages;
}

const readPendingChangesets = () =>
  readdirSync(join(ROOT, ".changeset"))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => ({ path: `.changeset/${f}`, source: readFileSync(join(ROOT, ".changeset", f), "utf8") }));

const readManifest = (dir) =>
  JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));

/** `--changesets`: every pending fragment, read with Changesets' parser. */
function mainChangesets() {
  const fragments = readPendingChangesets();
  const unversionable = findUnversionable(fragments, readWorkspace(), loadChangesetParser());
  if (unversionable.length === 0) {
    console.log(`✓ ${fragments.length} pending changeset(s) parse and name published packages only`);
    process.exit(0);
  }
  console.error(`\n✗ ${unversionable.length} problem(s) in pending changesets that changeset version would refuse:\n`);
  for (const { path, name, reason } of unversionable) console.error(`    ${path}  →  ${name ?? "the fragment"} ${reason}`);
  console.error(
    `\n  A changeset names published packages only (BP-022). Drop the private package's` +
      `\n  line, and its part of the note; a note with no published package left needs no` +
      `\n  changeset. changeset version fails the whole release on one such fragment.` +
      `\n  See docs/contributing/release-notes-workflow.md.\n`,
  );
  process.exit(1);
}

function main() {
  const offenders = findPublishable(NEVER_PUBLISH, readManifest);

  if (offenders.length === 0) {
    console.log(
      `✓ ${NEVER_PUBLISH.length} package(s) held out of the publish set`,
    );
    process.exit(0);
  }

  console.error(
    `\n✗ ${offenders.length} package(s) would publish that must not:\n`,
  );
  for (const { dir, name, reason } of offenders) {
    console.error(
      `    packages/${dir}${name ? ` (${name})` : ""}  →  ${reason}`,
    );
  }
  console.error(
    `\n  Restore "private": true in the package's package.json.` +
      `\n  It is the only field changeset publish filters on — the ignore list in` +
      `\n  .changeset/config.json skips versioning, not publishing.` +
      `\n  If a package here is now meant to ship, remove it from NEVER_PUBLISH in` +
      `\n  scripts/validate-publish-set.mjs and say so in docs/contributing/RELEASING.md.\n`,
  );
  process.exit(1);
}

/** The held-out packages, exported so a test can assert the list still covers them. */
export const neverPublish = NEVER_PUBLISH;

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes("--changesets")) mainChangesets();
  else main();
}

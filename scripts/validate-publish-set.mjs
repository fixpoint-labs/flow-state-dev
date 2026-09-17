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
 * Exits non-zero naming the package and the fix. No dependencies, so CI runs it
 * without an install.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

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

const readManifest = (dir) =>
  JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));

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
  main();
}

#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" for the docs site (apps/docs/vercel.json → ignoreCommand).
 * Exit 0 skips the build; exit 1 builds.
 *
 * The live site describes what a person can install, so production deploys only
 * when every public package's version on main is on npm and no release docs are
 * staged:
 *
 *   - Staged: a merged release docs pass waits for its Version Packages PR. Its
 *     changesets (apps/docs/release-docs.json) are still pending in .changeset/.
 *   - Unpublished: Version Packages merged and bumped versions, but
 *     `release.yml` hasn't published them yet, or the publish failed or was
 *     skipped. Merging versions proves nothing is installable.
 *
 * `release.yml` calls the docs deploy hook after a successful publish, so the
 * build skipped on the Version Packages push runs once packages are out. The rest
 * of the time, site code and `docs-fix` merges deploy as usual. Previews always
 * build. If npm can't be reached, production skips: shipping docs early is the
 * failure this exists to prevent.
 *
 * Cases are exercised in packages/core/test/docs-deploy-gate.test.ts.
 * See docs/contributing/release-docs.md.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");

/** Changesets the release docs pass covered that haven't been released yet. */
export function stagedChangesets(root) {
  const manifest = join(root, "apps/docs/release-docs.json");
  if (!existsSync(manifest)) return [];
  const ids = JSON.parse(readFileSync(manifest, "utf8")).changesets ?? [];
  return ids.filter((id) => existsSync(join(root, ".changeset", `${id}.md`)));
}

/** `{ name, version }` for every package under packages/ that publishes to npm. */
export function publicPackages(root) {
  const dir = join(root, "packages");
  return readdirSync(dir)
    .map((name) => join(dir, name, "package.json"))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, "utf8")))
    .filter((pkg) => !pkg.private && pkg.name && pkg.version)
    .map(({ name, version }) => ({ name, version }));
}

/** The packages whose version on main isn't on npm. A failed lookup counts as missing. */
export async function unpublished(packages, fetchImpl = fetch) {
  const results = await Promise.all(
    packages.map(async (pkg) => {
      const url = `https://registry.npmjs.org/${pkg.name.replace("/", "%2F")}/${pkg.version}`;
      try {
        const response = await fetchImpl(url, { method: "GET" });
        return response.ok ? null : pkg;
      } catch {
        return pkg;
      }
    }),
  );
  return results.filter((pkg) => pkg !== null);
}

/** `{ build, reason }` for this deploy. */
export async function decide({ env = process.env, root = ROOT, fetchImpl = fetch } = {}) {
  if (env.VERCEL_ENV !== "production") return { build: true, reason: "Preview build: building." };

  const staged = stagedChangesets(root);
  if (staged.length > 0) {
    return {
      build: false,
      reason: `Release docs are staged for unreleased changesets (${staged.join(", ")}): skipping until they publish.`,
    };
  }

  const missing = await unpublished(publicPackages(root), fetchImpl);
  if (missing.length > 0) {
    const list = missing.map(({ name, version }) => `${name}@${version}`).join(", ");
    return {
      build: false,
      reason: `Not on npm yet (${list}): skipping. release.yml triggers this deploy after it publishes.`,
    };
  }

  return { build: true, reason: "Every package on main is published and no release docs are staged: deploying." };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { build, reason } = await decide();
  console.log(reason);
  process.exit(build ? 1 : 0);
}

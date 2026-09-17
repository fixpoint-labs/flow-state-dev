#!/usr/bin/env node
/**
 * Refuses to publish this package without the DevTool app inside it.
 *
 * `files` declares `dist-client/`, the compiled DevTool SPA that `fsdev dev`
 * serves. It does not come from this package's `build` script (that is `tsc`
 * plus a stylesheet copy) — it comes from `build:assets`, which builds
 * `apps/devtool` and copies its output here. The two steps are separate because
 * CI and the Vercel builds run `packages:build` and have no reason to build the
 * SPA; only the release path needs both.
 *
 * That split is what makes the omission silent. Drop `build:assets` from a
 * release script and every check still passes, the tarball simply ships without
 * its assets, and `getAssetPath()` throws for whoever installed from npm. The
 * publish is the last moment anything can notice, so the check lives here:
 * `prepublishOnly` runs inside `pnpm publish` (which `changeset publish` calls)
 * before the tarball is packed, so a missing directory fails the publish instead
 * of producing a broken one.
 *
 * Deliberately not `prepack`: packing without publishing is a legitimate thing
 * to do mid-build, and this is a release requirement, not a packing one.
 *
 * No dependencies, so it runs wherever the publish does.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The entry point `getAssetPath()` consumers load first. Checking the directory
 * alone would pass on a half-copied build; `index.html` is the file that has to
 * be there for the served app to resolve at all.
 */
const entry = resolve(packageRoot, "dist-client", "index.html");

if (!existsSync(entry)) {
  console.error(
    `@flow-state-dev/devtool: refusing to publish without the DevTool app.\n` +
      `  expected: ${entry}\n` +
      `  build it: pnpm build:assets (from the repo root)\n` +
      `Publishing without it ships a package whose \`fsdev dev\` throws.`
  );
  process.exit(1);
}

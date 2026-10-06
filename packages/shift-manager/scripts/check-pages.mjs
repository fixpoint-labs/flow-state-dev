#!/usr/bin/env node
/**
 * Refuses to publish Shift Manager without its built pages.
 *
 * `files` declares `dist-client/`, the pages the `shift-manager` command serves
 * (`getAssetPath()`), and `dist/`, the command itself. A tarball without the
 * pages still packs and still installs; its command then stops on the first
 * run. `prepublishOnly` runs inside `pnpm publish` (which `changeset publish`
 * calls) before the tarball is packed, so a missing build fails the publish
 * instead of shipping. Not `prepack`: packing mid-build is legitimate.
 *
 * `--root <dir>` checks another copy of the package, for a test. No
 * dependencies, so it runs wherever the publish does.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const flag = process.argv.indexOf("--root");
const packageRoot =
  flag === -1 ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(process.argv[flag + 1]);

/** The files a working install needs first: the page, and the command and module that serve it. */
const required = ["dist-client/index.html", "dist/bin.js", "dist/index.js"];
const missing = required.filter((file) => !existsSync(resolve(packageRoot, file)));

if (missing.length > 0) {
  console.error(
    `@flow-state-dev/shift-manager: refusing to publish without its build.\n` +
      `  missing: ${missing.join(", ")}\n` +
      `  build it: pnpm --filter @flow-state-dev/shift-manager build\n` +
      `Publishing without it ships a command that can't serve Shift Manager.`,
  );
  process.exit(1);
}

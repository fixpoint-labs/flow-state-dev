/**
 * @flow-state-dev/shift-manager — the app a Workforce Lab is worked through.
 *
 * The package's module is the app contract `fsdev dev --app` reads, the same
 * one `@flow-state-dev/devtool` exports: where the built pages are, and, in a
 * checkout, where their source is. The `shift-manager` command (`bin.ts`)
 * hands this module to `fsdev dev` as its app.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The package's root: one up from `cli/` in a checkout and from `dist/` in an install. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The directory of Shift Manager's built pages (`index.html` and its assets).
 *
 * @throws When the pages are not built: a checkout that hasn't run
 *   `pnpm --filter @flow-state-dev/shift-manager build`.
 */
export function getAssetPath(): string {
  const dir = resolve(PACKAGE_ROOT, "dist-client");
  if (!existsSync(resolve(dir, "index.html"))) {
    throw new Error(
      `@flow-state-dev/shift-manager: the pages are not built at ${dir}. Run: pnpm --filter @flow-state-dev/shift-manager build`,
    );
  }
  return dir;
}

/**
 * The folder holding the pages' source `index.html`, which `fsdev dev --watch`
 * serves through Vite. `undefined` in an install, which ships built pages only.
 */
export function getSourceRoot(): string | undefined {
  return existsSync(resolve(PACKAGE_ROOT, "src", "main.tsx")) && existsSync(resolve(PACKAGE_ROOT, "index.html"))
    ? PACKAGE_ROOT
    : undefined;
}

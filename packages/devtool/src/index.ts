/**
 * @flow-state-dev/devtool — pre-built DevTool static assets for serving via `fsdev dev`.
 *
 * This package ships the compiled DevTool SPA as static files. The CLI uses
 * `getAssetPath()` to locate the directory and serve it over HTTP alongside
 * the flow API routes.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Returns the absolute path to the directory containing the pre-built
 * DevTool static assets (index.html, JS bundles, CSS, etc.).
 *
 * Throws if the assets directory does not exist — this means the package
 * was installed without a prior `build:assets` step.
 */
export function getAssetPath(): string {
  const assetDir = resolve(__dirname, "..", "dist-client");
  if (!existsSync(assetDir)) {
    throw new Error(
      "@flow-state-dev/devtool: pre-built assets not found at " +
        assetDir +
        ". Run the devtool build first (pnpm --filter @flow-state-dev/devtool build:assets)."
    );
  }
  return assetDir;
}

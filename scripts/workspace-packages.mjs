/**
 * Names of all `@flow-state-dev/*` and `@thought-fabric/*` workspace packages,
 * derived from the `packages/` directory.
 *
 * Apps consume these packages as TypeScript source in dev, so each app's
 * `next.config.mjs` must list them in `transpilePackages`. Importing this
 * single source of truth keeps that list from drifting and avoids duplicating
 * the discovery logic across every app config.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../packages");

export const workspacePackages = readdirSync(packagesDir)
  .map((d) => {
    try {
      return JSON.parse(
        readFileSync(resolve(packagesDir, d, "package.json"), "utf8"),
      ).name;
    } catch {
      return null;
    }
  })
  .filter(
    (n) =>
      n &&
      (n.startsWith("@flow-state-dev/") || n.startsWith("@thought-fabric/")),
  );

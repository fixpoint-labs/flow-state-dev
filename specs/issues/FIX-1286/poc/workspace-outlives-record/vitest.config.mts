/**
 * FIX-1286 POC config. Retained design evidence, not production code.
 *
 * The POC lives under the spec, outside every package's `include`, so no
 * default test run discovers it. This config points vitest at it alone and
 * resolves the workspace packages it needs to their source, because a file
 * under `specs/` has no `node_modules` of its own to resolve bare imports from.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../../..");
const fromIntegration = createRequire(resolve(repo, "packages/integration-tests/package.json"));

export default defineConfig({
  root: here,
  resolve: {
    // Exact-match aliases: a prefix alias would also rewrite the packages'
    // own subpath imports (`@flow-state-dev/core/types`).
    alias: [
      { find: /^@flow-state-dev\/core$/, replacement: resolve(repo, "packages/core/src/index.ts") },
      { find: /^@flow-state-dev\/tools\/bash$/, replacement: resolve(repo, "packages/tools/src/bash/index.ts") },
      { find: /^zod$/, replacement: fromIntegration.resolve("zod") },
    ],
  },
  test: {
    include: ["workspace-outlives-record.poc.ts"],
    // `process.chdir` into a scratch directory, so the local provider's
    // `.fsdev/workspaces/` lands there and not in the repository.
    pool: "forks",
    testTimeout: 30_000,
  },
});

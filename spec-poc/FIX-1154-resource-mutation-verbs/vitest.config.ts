/**
 * Throwaway config so the POC can run without living inside a workspace package.
 *
 * `spec-poc/` is deliberately not a pnpm workspace package, so the POC file's own
 * bare imports do not resolve from here under pnpm's strict layout. These two
 * exact-match aliases borrow the engine package's dependency tree — the same
 * physical modules the code under test already loads. Subpath specifiers are
 * left alone on purpose: aliasing those would bypass the packages' export maps
 * and break the engine's own internal imports.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const engineModules = fileURLToPath(
  new URL("../../packages/engine/node_modules/", import.meta.url)
);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^zod$/, replacement: `${engineModules}zod` },
      { find: /^@flow-state-dev\/core$/, replacement: `${engineModules}@flow-state-dev/core` }
    ]
  },
  test: {
    setupFiles: [
      fileURLToPath(new URL("../../packages/engine/test/setup-env.ts", import.meta.url))
    ]
  }
});

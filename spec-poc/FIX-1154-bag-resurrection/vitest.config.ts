/**
 * Throwaway config so the POC can run without living inside a workspace package.
 *
 * Same arrangement as the sibling `FIX-1154-resource-mutation-verbs` POC:
 * `spec-poc/` is deliberately not a pnpm workspace package, so these two
 * exact-match aliases borrow the engine package's dependency tree — the same
 * physical modules the code under test already loads. Subpath specifiers are
 * left alone on purpose.
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

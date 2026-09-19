/**
 * FIX-1381 spec POC — its own vitest root, so the characterization test runs
 * from `spec-poc/` without being swept into any package's suite. Throwaway;
 * the spec branch never merges and CI ignores this folder.
 *
 * `spec-poc/` is not a workspace package, so the two bare specifiers the test
 * imports have nothing to resolve against. They are aliased to the package
 * sources by ANCHORED regex — `/^…\/core$/`, not a prefix — so that the
 * subpath imports those sources make internally (`@flow-state-dev/core/types`,
 * `/items`, `/helpers`, …) keep resolving through each package's own
 * `node_modules` and its real `exports` map. A prefix alias would hijack them
 * and quietly resolve a directory instead, which is how a POC ends up testing
 * a resolution artefact rather than the framework.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@flow-state-dev\/core$/, replacement: at("../../packages/core/src/index.ts") },
      { find: /^@flow-state-dev\/engine$/, replacement: at("../../packages/engine/src/index.ts") },
    ],
  },
  test: {
    root: __dirname,
    setupFiles: [at("../../packages/engine/test/setup-env.ts")],
  },
});

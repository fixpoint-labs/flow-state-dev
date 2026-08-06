/**
 * THROWAWAY vitest config for the FIX-1001 spec POC.
 *
 * `spec-poc/` sits outside the pnpm workspace, so its files have no
 * `node_modules` to resolve `@flow-state-dev/*` from. The packages publish
 * their TypeScript source directly (`"default": "./src/index.ts"`), so
 * aliasing the three specifiers this POC imports is enough — no build step.
 * Everything the engine itself imports resolves normally from inside
 * `packages/engine`.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@flow-state-dev\/core\/types$/, replacement: `${repoRoot}packages/core/src/types/index.ts` },
      { find: /^@flow-state-dev\/core$/, replacement: `${repoRoot}packages/core/src/index.ts` },
      { find: /^@flow-state-dev\/engine$/, replacement: `${repoRoot}packages/engine/src/index.ts` },
      { find: /^zod$/, replacement: `${repoRoot}packages/integration-tests/node_modules/zod` }
    ]
  },
  test: {
    testTimeout: 30_000,
    sequence: { concurrent: false },
    setupFiles: ["spec-poc/FIX-1001-drain-terminal-paths/setup.ts"],
    include: ["spec-poc/FIX-1001-drain-terminal-paths/*.poc.test.ts"]
  }
});

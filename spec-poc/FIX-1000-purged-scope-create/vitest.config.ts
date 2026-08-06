/**
 * `spec-poc/` is deliberately NOT a pnpm workspace package (see
 * `spec-poc/README.md`), so a file here has no `node_modules` to resolve its
 * own imports from. Two aliases are all it takes to borrow the engine
 * package's — everything the engine's own source imports still resolves
 * normally, because that happens from inside `packages/engine`.
 *
 * A config file is not a `package.json`: this still never enters the workspace,
 * so `turbo`'s `pnpm typecheck` / `pnpm test` never see it and a spec PR's CI
 * stays green.
 */
import path from "node:path";
import { defineConfig } from "vitest/config";

const repo = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  test: {
    // The same scrub the engine suite uses: this environment sets
    // `FSDEV_DEFAULT_MODEL`, which trips `createModelResolver`'s fail-fast
    // guard against a fixture flow that declares no intents.
    setupFiles: [path.join(repo, "packages/engine/test/setup-env.ts")]
  },
  resolve: {
    alias: [
      { find: /^zod$/, replacement: path.join(repo, "packages/engine/node_modules/zod") },
      {
        find: /^@flow-state-dev\/core$/,
        replacement: path.join(repo, "packages/core/src/index.ts")
      }
    ]
  }
});

import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  test: {
    // Strip ambient FSDEV_* / provider env so the run-command integration
    // tests resolve models deterministically (mirrors core/server setup).
    setupFiles: ["./test/setup-env.ts"],
    // resolve-block / run-command tests dynamically import fixtures that pull
    // core + server in as TypeScript source (aliased below); vitest transpiles
    // that graph on first import. Under Turborepo's parallel test execution the
    // CPU contention can push this past the 5s default, so give it headroom.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      "@flow-state-dev/core/resource-template": resolve(root, "packages/core/src/resource-template/resource-template.ts"),
      "@flow-state-dev/core/prompt-file": resolve(root, "packages/core/src/prompt/prompt-file.ts"),
      "@flow-state-dev/core/types": resolve(root, "packages/core/src/types/index.ts"),
      "@flow-state-dev/core/items/internal": resolve(root, "packages/core/src/items/internal.ts"),
      "@flow-state-dev/core/items": resolve(root, "packages/core/src/items/index.ts"),
      "@flow-state-dev/core/graph": resolve(root, "packages/core/src/graph/index.ts"),
      "@flow-state-dev/core/models": resolve(root, "packages/core/src/models/index.ts"),
      "@flow-state-dev/core/helpers": resolve(root, "packages/core/src/helpers/index.ts"),
      "@flow-state-dev/core": resolve(root, "packages/core/src/index.ts"),
      "@flow-state-dev/engine": resolve(root, "packages/engine/src/index.ts"),
      "@flow-state-dev/testing": resolve(root, "packages/testing/src/index.ts"),
    },
  },
});

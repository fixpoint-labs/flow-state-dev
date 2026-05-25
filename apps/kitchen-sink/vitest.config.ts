import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  test: {
    // Playwright specs live under `e2e/` and are run by `pnpm test:e2e`.
    // Vitest must not collect them.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
  resolve: {
    alias: {
      "@flow-state-dev/tools/bash": resolve(root, "packages/tools/src/bash/index.ts"),
      "@flow-state-dev/tools/mcp": resolve(root, "packages/tools/src/mcp/index.ts"),
      "@flow-state-dev/tools/search": resolve(root, "packages/tools/src/search/index.ts"),
      "@flow-state-dev/tools/fetch": resolve(root, "packages/tools/src/fetch/index.ts"),
      "@flow-state-dev/tools/crawl": resolve(root, "packages/tools/src/crawl/index.ts"),
      "@flow-state-dev/tools": resolve(root, "packages/tools/src/index.ts"),
      "@flow-state-dev/core/helpers": resolve(root, "packages/core/src/helpers/index.ts"),
      "@flow-state-dev/memory": resolve(root, "packages/memory/src/index.ts"),
      "@thought-fabric/core/metacognition": resolve(root, "packages/thought-fabric-core/src/metacognition/index.ts"),
    },
  },
});

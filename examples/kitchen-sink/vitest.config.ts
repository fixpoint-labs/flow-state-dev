import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@flow-state-dev/tools/bash": resolve(root, "packages/tools/src/bash/index.ts"),
      "@flow-state-dev/tools/search": resolve(root, "packages/tools/src/search/index.ts"),
      "@flow-state-dev/tools/fetch": resolve(root, "packages/tools/src/fetch/index.ts"),
      "@flow-state-dev/tools/crawl": resolve(root, "packages/tools/src/crawl/index.ts"),
      "@flow-state-dev/tools": resolve(root, "packages/tools/src/index.ts"),
      "@thought-fabric/core/memory": resolve(root, "packages/thought-fabric-core/src/memory/index.ts"),
    },
  },
});

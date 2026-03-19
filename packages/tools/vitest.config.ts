import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@flow-state-dev/core/types": resolve(root, "packages/core/src/types/index.ts"),
      "@flow-state-dev/core/items": resolve(root, "packages/core/src/items/index.ts"),
      "@flow-state-dev/core": resolve(root, "packages/core/src/index.ts"),
      "@flow-state-dev/testing": resolve(root, "packages/testing/src/index.ts"),
      "@flow-state-dev/tools": resolve(root, "packages/tools/src/index.ts"),
      "@flow-state-dev/tools/search": resolve(root, "packages/tools/src/search/index.ts"),
    },
  },
});

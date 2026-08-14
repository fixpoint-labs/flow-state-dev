import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@flow-state-dev/core/types": resolve(root, "packages/core/src/types/index.ts"),
      "@flow-state-dev/core": resolve(root, "packages/core/src/index.ts"),
    },
  },
});

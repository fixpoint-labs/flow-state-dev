import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@flow-state-dev/core/types": resolve(root, "packages/core/src/types/index.ts"),
      "@flow-state-dev/core/items": resolve(root, "packages/core/src/items/index.ts"),
      "@flow-state-dev/core/capability": resolve(root, "packages/core/src/capability/index.ts"),
      "@flow-state-dev/core/utils": resolve(root, "packages/core/src/utils/index.ts"),
      "@flow-state-dev/core/models": resolve(root, "packages/core/src/models/index.ts"),
      "@flow-state-dev/core": resolve(root, "packages/core/src/index.ts"),
      "@flow-state-dev/testing": resolve(root, "packages/testing/src/index.ts"),
      "@flow-state-dev/server": resolve(root, "packages/server/src/index.ts"),
      "@flow-state-dev/skills": resolve(root, "packages/skills/src/index.ts"),
    },
  },
});

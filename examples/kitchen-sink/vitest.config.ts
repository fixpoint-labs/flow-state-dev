import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@flow-state-dev/tools": resolve(root, "packages/tools/src/index.ts"),
      "@thought-fabric/core/memory": resolve(root, "packages/thought-fabric-core/src/memory/index.ts"),
    },
  },
});

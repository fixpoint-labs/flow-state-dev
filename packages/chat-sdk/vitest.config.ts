import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

export default defineConfig({
  resolve: {
    alias: {
      "@flow-state-dev/core/resource-template": resolve(root, "packages/core/src/resource-template/resource-template.ts"),
      "@flow-state-dev/core/types": resolve(root, "packages/core/src/types/index.ts"),
      "@flow-state-dev/core/items/internal": resolve(root, "packages/core/src/items/internal.ts"),
      "@flow-state-dev/core/items": resolve(root, "packages/core/src/items/index.ts"),
      "@flow-state-dev/core/capability": resolve(root, "packages/core/src/capability/index.ts"),
      "@flow-state-dev/core/helpers": resolve(root, "packages/core/src/helpers/index.ts"),
      "@flow-state-dev/core/models": resolve(root, "packages/core/src/models/index.ts"),
      "@flow-state-dev/core": resolve(root, "packages/core/src/index.ts"),
      "@flow-state-dev/testing/conformance": resolve(root, "packages/testing/src/transports/conformance.ts"),
      "@flow-state-dev/testing": resolve(root, "packages/testing/src/index.ts"),
      "@flow-state-dev/server": resolve(root, "packages/server/src/index.ts"),
      "@flow-state-dev/chat-sdk": resolve(root, "packages/chat-sdk/src/index.ts"),
      "@flow-state-dev/chat-sdk/testing": resolve(root, "packages/chat-sdk/src/testing.ts"),
    },
  },
});

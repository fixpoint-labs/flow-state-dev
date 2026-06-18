import { defineConfig } from "vitest/config";

// The orchestrator's tests run in Node and exercise the real durable runtime
// (runAction + in-memory stores) alongside pure unit tests for the stage
// machine and signal clients. Workspace `@flow-state-dev/*` imports resolve to
// each package's TypeScript source via their package.json `exports`, so no
// build step is required before `vitest run`.
export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // `test/activate-without-evaluator.test.ts` spies on `evaluator` where
    // orchestration's `skillEvaluator` calls it. A mock reaches a package's own
    // imports only when vitest transforms that package, which an installed
    // package in node_modules is not by default.
    server: { deps: { inline: [/@flow-state-dev\//] } },
  },
});

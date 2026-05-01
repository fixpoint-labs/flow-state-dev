import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Flow scenarios run real `runAction` against in-memory stores. Mocked
    // generators keep latency low (~1s per scenario) but loop-guard / wait
    // paths can stretch — give each test a generous ceiling so a regression
    // surfaces as a failed assertion, not a flaky timeout.
    testTimeout: 30_000,
    hookTimeout: 10_000,
    // Tests don't share state but staying serial keeps duration reporting
    // honest and avoids cross-scenario interleaving in console output.
    sequence: { concurrent: false },
    reporters: ["default"],
    include: ["src/scenarios/**/*.test.ts", "test/**/*.test.ts"]
  }
});

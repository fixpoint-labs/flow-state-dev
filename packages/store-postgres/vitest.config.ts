import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite's cold start (paid by the first test in each file, see
    // test/shared-pglite.ts) pushes individual tests over the default 5s
    // timeout on slower CI runners, so the per-test ceiling is raised.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});

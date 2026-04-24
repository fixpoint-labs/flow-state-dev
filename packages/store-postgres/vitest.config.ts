import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite cold-start + per-test fresh instance push individual tests over
    // the default 5s timeout on slower CI runners. The suite already runs
    // serially, so bumping the per-test ceiling is the safe knob.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});

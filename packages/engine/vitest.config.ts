import { defineConfig } from "vitest/config";
import { sharedModuleCache } from "../../scripts/vitest-isolation.mjs";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup-env.ts"],
    // Most files share one module cache per worker; see scripts/vitest-isolation.mjs.
    ...sharedModuleCache(import.meta.dirname, {
      // Asserts the filesystem store's warn-once, which an earlier file trips.
      alsoIsolate: ["test/filesystem-store-development-only.test.ts"],
    }),
  },
});

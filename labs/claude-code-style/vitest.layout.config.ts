import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The lab's layout tests: pages laid out by a real browser (`test/layout/`).
 * They need Chromium, so `pnpm test` leaves them out and the CI's browser job
 * runs them (`pnpm test:layout`).
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["test/layout/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 },
});

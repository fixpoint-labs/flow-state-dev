import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * App Lab's tests. Most run in Node against a real Lab served on a free port;
 * a UI test opts into a DOM with `// @vitest-environment happy-dom`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** The lab's tests: the screen on fixtures in a DOM. The layout tests need a browser: `vitest.layout.config.ts`. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["test/**/*.test.{ts,tsx}"], exclude: ["test/layout/**", "**/node_modules/**"], environment: "node" },
});

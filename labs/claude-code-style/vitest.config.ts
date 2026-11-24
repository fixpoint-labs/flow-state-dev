import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The lab's tests: the screen in a DOM, on the lab's own host in process (`test/app-host.ts`), which
 * reads on its timer with no push socket, so a case waits seconds, not milliseconds. The layout tests
 * need a browser: `vitest.layout.config.ts`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["test/**/*.test.{ts,tsx}"], exclude: ["test/layout/**", "**/node_modules/**"], environment: "node", testTimeout: 30_000, hookTimeout: 30_000 },
});

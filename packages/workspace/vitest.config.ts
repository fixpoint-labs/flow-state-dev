import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    setupFiles: ["./test/setup-env.ts"],
  },
});

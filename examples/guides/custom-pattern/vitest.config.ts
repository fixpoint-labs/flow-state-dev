import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup-env.ts"],
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    setupFiles: ["./test/setup-env.ts", "test/setup.ts"],
    environment: "node",
  },
});

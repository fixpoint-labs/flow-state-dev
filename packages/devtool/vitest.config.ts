import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup-env.ts", "./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
  },
});

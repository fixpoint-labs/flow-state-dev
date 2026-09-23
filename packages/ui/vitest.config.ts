import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@/components/ui": fileURLToPath(new URL("./.storybook/shadcn/components/ui", import.meta.url)),
      "@/lib/utils": fileURLToPath(new URL("./.storybook/shadcn/lib/utils", import.meta.url)),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx,jsx}"],
  },
});

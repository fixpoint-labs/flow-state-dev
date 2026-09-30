import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
  resolve: {
    // Registry components import shadcn primitives through `@/`, which only an
    // app resolves. Tests that render them get Storybook's stubs, through the
    // same aliases `.storybook/main.ts` sets.
    alias: {
      "@/components/ui": resolve(here, ".storybook/shadcn/components/ui"),
      "@/lib/utils": resolve(here, ".storybook/shadcn/lib/utils"),
    },
  },
});

/**
 * Shift Manager's page build. `pnpm build` writes `dist-client/`, which the
 * `shift-manager` command serves beside the Lab's API (`getAssetPath()`). Under
 * `--dev` in a checkout, `fsdev dev` serves the same pages from source through
 * this config, on the Lab's own origin, so the page calls `/api` directly.
 *
 * Tailwind runs as its Vite plugin, which inlines the stylesheet's imports and
 * rebases each one's `url()`s, so the font files the design-system package's
 * stylesheet pulls in are found and bundled.
 *
 * The build records the source files it was made from, so the checkout's
 * `start` script can tell a build that is older than its source and rebuild it.
 */
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { recordBuildInputs } from "../../scripts/build-inputs.mjs";

export default defineConfig({
  plugins: [react(), tailwindcss(), recordBuildInputs({ repoRoot: fileURLToPath(new URL("../..", import.meta.url)) })],
  // The registry copies import `@/components/…` and `@/lib/utils`, as `components.json` names them.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist-client" },
});

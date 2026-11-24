/**
 * The lab's page build. `pnpm build` writes `dist-client/`, which `fsdev dev
 * --app` serves beside the API (`getAssetPath()`). `pnpm dev` builds, then runs
 * that host: the pages have no API without it.
 *
 * Tailwind runs as its Vite plugin, so the design-system stylesheet's font
 * `url()`s are rebased and bundled.
 */
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { recordBuildInputs } from "../../scripts/build-inputs.mjs";

export default defineConfig({
  // The record of the source files the build was made from: the super app's `pnpm dev` rebuilds when one changes.
  plugins: [react(), tailwindcss(), recordBuildInputs({ repoRoot: fileURLToPath(new URL("../..", import.meta.url)) })],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Relative asset URLs, read against the page's `<base href>` (`index.html`): the
  // same build serves at the root of its origin and under a proxy's sub-route
  // (`apps/super-app`), which rewrites that `<base>` to its prefix.
  base: "./",
  build: { outDir: "dist-client" },
});

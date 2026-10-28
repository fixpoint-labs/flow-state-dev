/**
 * The lab's page build. `pnpm build` writes `dist-client/`, which `fsdev dev
 * --app` serves beside the API (`getAssetPath()`); `pnpm dev` serves the same
 * pages from source on fixtures until wiring.
 *
 * Tailwind runs as its Vite plugin, so the design-system stylesheet's font
 * `url()`s are rebased and bundled.
 */
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist-client" },
});

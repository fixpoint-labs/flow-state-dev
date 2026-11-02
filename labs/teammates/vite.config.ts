/**
 * The lab's page build. `pnpm build` writes `dist-client/`, which `fsdev dev
 * --app` serves beside the API (`getAssetPath()`); `pnpm dev` serves the same
 * pages from source on fixtures until wiring. Tailwind runs as its Vite plugin.
 */
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Relative asset URLs, read against the page's `<base href>` (`index.html`): the
  // same build serves at the root of its origin and under a proxy's sub-route
  // (`apps/super-app`), which rewrites that `<base>` to its prefix.
  base: "./",
  build: { outDir: "dist-client" },
});

/**
 * Shift Manager's page build. `pnpm build` writes `dist/`, which the start script
 * serves beside the Lab's API. `pnpm dev` proxies `/api` to a Lab Shift Manager's
 * start script is already serving (`VITE_LAB_URL`, default port 4300).
 *
 * Tailwind runs as its Vite plugin, which inlines the stylesheet's imports and
 * rebases each one's `url()`s, so the font files the design-system package's
 * stylesheet pulls in are found and bundled.
 *
 * The build records the source files it was made from, so the start script can
 * tell a build that is older than its source and rebuild it.
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
  server: {
    proxy: {
      "/api": { target: process.env.VITE_LAB_URL ?? "http://127.0.0.1:4300", changeOrigin: true },
    },
  },
});

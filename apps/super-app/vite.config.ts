/**
 * The super app's DevTool page: one `DevToolPanel` with a switcher over the
 * hosted apps. `pnpm --filter @flow-state-dev/super-app build:devtool` writes
 * `dist/`, which the proxy serves at `/devtool/` (`proxy.mjs`).
 *
 * Run from this folder, which is the page's root (`index.html`, `src/`).
 * The page only ever lives at that one address, so its asset URLs are absolute
 * under it rather than relative to a `<base>`.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/devtool/",
  build: { outDir: "dist", emptyOutDir: true },
});

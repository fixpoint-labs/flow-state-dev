/**
 * The super app's DevTool page: one `DevToolPanel` with a switcher over the
 * hosted apps. `pnpm --filter @flow-state-dev/super-app build:devtool` writes
 * `dist/`, which the proxy serves at `/devtool/` (`proxy.mjs`).
 *
 * Run from this folder, which is the page's root (`index.html`, `src/`).
 * The page only ever lives at that one address, so its asset URLs are absolute
 * under it rather than relative to a `<base>`.
 */
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { recordBuildInputs } from "../../scripts/build-inputs.mjs";

export default defineConfig({
  // The record of the source files the build was made from: `pnpm dev` rebuilds when one changes (`rebuild.mjs`).
  plugins: [react(), recordBuildInputs({ repoRoot: fileURLToPath(new URL("../..", import.meta.url)) })],
  base: "/devtool/",
  build: { outDir: "dist", emptyOutDir: true },
});

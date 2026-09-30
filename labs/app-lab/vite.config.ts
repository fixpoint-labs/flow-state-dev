/**
 * App Lab's page build. `pnpm build` writes `dist/`, which the start script
 * serves beside the Lab's API. `pnpm dev` proxies `/api` to a Lab App Lab's
 * start script is already serving (`VITE_LAB_URL`, default port 4300).
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: process.env.VITE_LAB_URL ?? "http://127.0.0.1:4300", changeOrigin: true },
    },
  },
});

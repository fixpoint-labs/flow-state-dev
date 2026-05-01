import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const apiUrl = process.env.VITE_API_URL ?? "http://localhost";
const apiPort = process.env.VITE_API_PORT ?? "3000";

const packageRoot = path.resolve(__dirname, "../../packages/devtool/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the panel package to source so Vite's HMR keeps working
    // without rebuilding `packages/devtool/dist` on every edit.
    alias: [
      { find: "@flow-state-dev/devtool/react/styles.css", replacement: path.join(packageRoot, "react/styles.css") },
      { find: "@flow-state-dev/devtool/react", replacement: path.join(packageRoot, "react/index.ts") },
      { find: "@flow-state-dev/devtool", replacement: path.join(packageRoot, "index.ts") },
    ],
  },
  server: {
    proxy: {
      "/api": {
        target: `${apiUrl}:${apiPort}`,
        changeOrigin: true
      }
    }
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  }
});

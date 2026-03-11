import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const apiUrl = process.env.VITE_API_URL ?? "http://localhost";
const apiPort = process.env.VITE_API_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
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

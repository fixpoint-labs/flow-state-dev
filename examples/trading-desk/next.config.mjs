import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { workspacePackages } from "../../scripts/workspace-packages.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workspace packages are consumed as TypeScript source in dev (their
// package.json `exports` point at ./src). Next must transpile every one it
// imports; the list is derived from the workspace (see
// scripts/workspace-packages.mjs) rather than hand-maintained.

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  transpilePackages: workspacePackages,
  turbopack: {
    root: resolve(__dirname, "../../"),
  },
};

export default nextConfig;

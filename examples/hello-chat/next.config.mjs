import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workspace packages are consumed as TypeScript source in dev (their
// package.json `exports` point at ./src). Next must transpile every workspace
// package it imports, so derive the list from the workspace rather than
// hand-maintaining it.
const packagesDir = resolve(__dirname, "../../packages");
const workspacePackages = readdirSync(packagesDir)
  .map((d) => {
    try {
      return JSON.parse(
        readFileSync(resolve(packagesDir, d, "package.json"), "utf8"),
      ).name;
    } catch {
      return null;
    }
  })
  .filter(
    (n) =>
      n &&
      (n.startsWith("@flow-state-dev/") || n.startsWith("@thought-fabric/")),
  );

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  transpilePackages: workspacePackages,
  turbopack: {
    root: resolve(__dirname, "../../"),
  },
};

export default nextConfig;

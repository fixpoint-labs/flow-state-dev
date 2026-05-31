import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workspace packages are consumed as TypeScript source in dev (their
// package.json `exports` point at ./src; the dist build is swapped in at
// publish via publishConfig). Next must transpile every workspace package it
// imports, so derive the list from the workspace itself rather than
// hand-maintaining it — adding a package can no longer silently break HMR.
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
  // `pg` ships native bindings; mark external so webpack doesn't try to
  // bundle it. `@vercel/sandbox` doesn't need this entry — the bash
  // adapter takes the SDK class via DI from the consumer (see
  // `flows/chat-agent/blocks/bash-tools.ts`), so the static import is
  // visible to nft like any other dependency.
  serverExternalPackages: ["pg"],
  transpilePackages: workspacePackages,
  turbopack: {
    root: resolve(__dirname, "../../"),
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [...(config.watchOptions?.ignored || []), "**/.fsdev/**"],
    };
    return config;
  },
};

export default nextConfig;

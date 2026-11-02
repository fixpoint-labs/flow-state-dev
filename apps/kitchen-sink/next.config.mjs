import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { workspacePackages } from "../../scripts/workspace-packages.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workspace packages are consumed as TypeScript source in dev (their
// package.json `exports` point at ./src; the dist build is swapped in at
// publish via publishConfig). Next must transpile every one it imports, so the
// list is derived from the workspace (see scripts/workspace-packages.mjs) —
// adding a package can no longer silently break HMR.

// Serving under a sub-route (`apps/super-app` serves this app at
// `/kitchen-sink`): `KITCHEN_SINK_BASE_PATH` sets Next's `basePath`, which is
// read at build time, and `KITCHEN_SINK_DIST_DIR` keeps that build apart from
// the root-served one in `.next`. Both unset, the app serves at `/` from `.next`.
const basePath = process.env.KITCHEN_SINK_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(basePath === "" ? {} : { basePath }),
  ...(process.env.KITCHEN_SINK_DIST_DIR ? { distDir: process.env.KITCHEN_SINK_DIST_DIR } : {}),
  // `lib/base-path.ts` reads it: a flow client's `baseUrl` takes the prefix itself.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  outputFileTracingRoot: resolve(__dirname, "../../"),
  // `pg` ships native bindings; mark external so webpack doesn't try to
  // bundle it. `@vercel/sandbox` doesn't need this entry — the bash
  // adapter takes the SDK class via DI from the consumer (see
  // `flows/chat-agent/shared/capabilities/bash.ts`), so the static import is
  // visible to nft like any other dependency. The Claude Agent SDK is loaded
  // by name at run time and starts the Claude Code executable it ships, so it
  // stays a package on disk, never bundled. The Cursor SDK is the same: it
  // ships its local runtime as a native binary, and the Cursor package loads
  // it by name, in the runtime's own process. The Codex SDK is the same: it
  // starts the Codex program its platform package ships.
  serverExternalPackages: ["pg", "better-sqlite3", "bullmq", "ioredis", "express", "@anthropic-ai/claude-agent-sdk", "@cursor/sdk", "@openai/codex-sdk"],
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

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  // `pg` ships native bindings; mark external so webpack doesn't try to
  // bundle it. `@vercel/sandbox` doesn't need this entry — the bash
  // adapter takes the SDK class via DI from the consumer (see
  // `flows/chat-agent/blocks/bash-tools.ts`), so the static import is
  // visible to nft like any other dependency.
  serverExternalPackages: ["pg"],
  transpilePackages: [
    "@flow-state-dev/core",
    "@flow-state-dev/client",
    "@flow-state-dev/react",
    "@flow-state-dev/server",
    "@flow-state-dev/store-postgres",
    "@flow-state-dev/vercel",
  ],
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

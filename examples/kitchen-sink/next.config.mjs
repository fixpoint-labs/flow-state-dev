import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  serverExternalPackages: [
    "pg",
    // Provider/gateway packages loaded via createRequire() in the model
    // resolver. Must be external so Node.js module resolution can find them.
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
    "@ai-sdk/google",
    "@ai-sdk/gateway",
    "@openrouter/ai-sdk-provider",
  ],
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

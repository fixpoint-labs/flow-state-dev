import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  // Packages bundled by the framework's adapters via dynamic `import()` —
  // mark as external so Next.js leaves the require alone and Vercel
  // deploys them to node_modules instead of inlining into a chunk. The
  // tracer in bash-tools.ts adds a static `import("@vercel/sandbox")`
  // so nft follows the package and its transitive deps to the deploy.
  serverExternalPackages: ["pg", "@vercel/sandbox"],
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

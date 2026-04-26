import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(__dirname, "../../"),
  // Packages bundled by the framework's adapters via dynamic `import()` —
  // mark as external so Next.js leaves the require alone and Vercel
  // deploys them to node_modules instead of inlining into a chunk.
  serverExternalPackages: ["pg", "@vercel/sandbox"],
  // `serverExternalPackages` solves bundling, but the framework's
  // `import(/* webpackIgnore: true */ "@vercel/sandbox")` hides the
  // dependency from Vercel's file tracer (nft). Force-include it for
  // every server route so the package files reach the deployment.
  outputFileTracingIncludes: {
    "/**/*": [
      "../../node_modules/.pnpm/@vercel+sandbox@*/node_modules/@vercel/sandbox/**",
      "./node_modules/@vercel/sandbox/**",
    ],
  },
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

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Inside the flow-state-dev repository, workspace packages are consumed as
// TypeScript source (their package.json `exports` point at ./src), so Next
// must transpile every one it imports, and trace files from the repository
// root. The list is derived from the workspace (scripts/workspace-packages.mjs)
// rather than hand-maintained. A copy of this example outside the repository
// installs the published packages, which need neither, and reads nothing
// outside its own folder.
const workspaceRoot = resolve(__dirname, "../../");
const inRepo = existsSync(resolve(workspaceRoot, "pnpm-workspace.yaml"));

/** @type {import('next').NextConfig} */
const nextConfig = inRepo
  ? {
      outputFileTracingRoot: workspaceRoot,
      transpilePackages: (await import("../../scripts/workspace-packages.mjs")).workspacePackages,
      turbopack: { root: workspaceRoot },
    }
  : {};

export default nextConfig;

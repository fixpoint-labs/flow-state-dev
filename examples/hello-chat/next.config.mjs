import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Inside the flow-state-dev repository, workspace packages are consumed as
// TypeScript source (their package.json `exports` point at ./src), so Next
// must transpile every one it imports, and trace files from the repository
// root. The list is derived from the workspace (scripts/workspace-packages.mjs)
// rather than hand-maintained. A copy of this example outside the repository
// installs the published packages, which need neither, and reads nothing
// outside its own folder. The repository is told by its root package name,
// not by a pnpm-workspace.yaml: a copy inside any other pnpm monorepo has one.
const workspaceRoot = resolve(__dirname, "../../");
const rootManifest = resolve(workspaceRoot, "package.json");
const inRepo =
  existsSync(rootManifest) && JSON.parse(readFileSync(rootManifest, "utf8")).name === "flow-state-dev";

/** @type {import('next').NextConfig} */
const nextConfig = {};

// Set after the literal, never as a conditional export: the plugin's install
// detector reads this file as a plain object literal (its accepted-shapes test).
if (inRepo) {
  nextConfig.outputFileTracingRoot = workspaceRoot;
  nextConfig.transpilePackages = (await import("../../scripts/workspace-packages.mjs")).workspacePackages;
  nextConfig.turbopack = { root: workspaceRoot };
}

export default nextConfig;

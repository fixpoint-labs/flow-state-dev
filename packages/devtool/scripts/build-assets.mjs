/**
 * Builds the standalone DevTool app (apps/devtool) and copies its dist/ into
 * packages/devtool/dist-client/ so the package ships pre-built static assets
 * for `fsdev dev` to serve.
 *
 * The app's `tsc --noEmit` step uses composite project references, so its
 * workspace dependencies (core, client, react, devtool) must be built first.
 * We build through Turborepo, which orders those dependencies ahead of the
 * app's own build — no manual sequencing here.
 *
 * Usage: node scripts/build-assets.mjs
 */
import { execSync } from "node:child_process";
import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const monorepoRoot = resolve(packageRoot, "../..");
const devtoolAppDir = resolve(monorepoRoot, "apps/devtool");
const sourceDistDir = resolve(devtoolAppDir, "dist");
const targetDir = resolve(packageRoot, "dist-client");

console.log("Building DevTool app (with workspace dependencies)...");
execSync("pnpm exec turbo run build --filter=@flow-state-dev/devtool-app", {
  cwd: monorepoRoot,
  stdio: "inherit",
});

if (!existsSync(sourceDistDir)) {
  console.error("Build succeeded but dist/ not found at", sourceDistDir);
  process.exit(1);
}

if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true });
}

cpSync(sourceDistDir, targetDir, { recursive: true });
console.log("DevTool assets copied to", targetDir);

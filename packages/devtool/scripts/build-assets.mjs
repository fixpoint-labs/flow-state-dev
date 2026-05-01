/**
 * Builds the standalone DevTool app (apps/devtool) and copies its dist/ into
 * packages/devtool/dist-client/ so the package ships pre-built static assets
 * for `fsdev dev` to serve.
 *
 * The Vite build now consumes the panel from the same package's library
 * entry, so we build the library first (`pnpm --filter <pkg> build`) before
 * running the Vite build via the alias config in apps/devtool.
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

console.log("Building DevTool app...");
execSync("pnpm run build", {
  cwd: devtoolAppDir,
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

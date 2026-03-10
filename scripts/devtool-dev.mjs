/**
 * Runs tsc --build --watch for framework packages alongside the devtool Vite
 * dev server. Kills both when either exits or when the process receives SIGINT.
 *
 * Usage: node scripts/devtool-dev.mjs [--port <api-port>]
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const children = [];

function killAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  killAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  killAll();
  process.exit(0);
});

// tsc --build --watch on the react package (cascades to core + client via
// project references). The --preserveWatchOutput flag keeps the terminal clean.
const tsc = spawn(
  "npx",
  ["tsc", "--build", "--watch", "--preserveWatchOutput", "packages/react/tsconfig.json"],
  { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
);
children.push(tsc);

tsc.stdout.on("data", (data) => {
  const line = data.toString().trim();
  if (line) {
    console.log(`[tsc] ${line}`);
  }
});

// Vite dev server for the devtool app.
const vite = spawn("pnpm", ["--filter", "devtool", "dev"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env },
});
children.push(vite);

vite.on("exit", (code) => {
  killAll();
  process.exit(code ?? 0);
});

tsc.on("exit", (code) => {
  if (code !== 0) {
    console.error(`[tsc] exited with code ${code}`);
  }
});

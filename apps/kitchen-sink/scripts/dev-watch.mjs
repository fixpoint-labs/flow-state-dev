/**
 * Watches workspace package source via `tsc --build --watch` and restarts
 * `next dev` whenever a dist/ file changes. Ensures the example app always
 * runs against freshly-compiled package output.
 *
 * Usage: node scripts/dev-watch.mjs
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(__dirname, "..");
const monoRoot = resolve(exampleRoot, "../..");

// Each entry is the directory under packages/ whose dist/ is watched. Add a
// package here when kitchen-sink imports from it — otherwise edits to that
// package won't trigger a next dev restart and the running app keeps using
// stale compiled output. Last regression: thought-fabric-core was missing,
// so memory/digest changes silently didn't take effect until full restart.
const WATCHED_PACKAGES = [
  "core",
  "client",
  "server",
  "react",
  "thought-fabric-core",
  "tools",
  "patterns",
  "ui",
];
const RESTART_DEBOUNCE_MS = 500;

let nextProcess = null;
let restartTimer = null;
let initialBuildDone = false;

function log(message) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[36m[dev-watch ${ts}]\x1b[0m ${message}`);
}

function startNext() {
  if (nextProcess !== null) {
    return;
  }

  log("Starting next dev...");
  nextProcess = spawn("npx", ["next", "dev"], {
    cwd: exampleRoot,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  nextProcess.on("exit", (code) => {
    if (code !== null) {
      log(`next dev exited (code ${code})`);
    }
    nextProcess = null;
  });
}

function killNext() {
  return new Promise((resolve) => {
    if (nextProcess === null) {
      resolve();
      return;
    }

    log("Stopping next dev...");
    nextProcess.on("exit", () => resolve());
    nextProcess.kill("SIGTERM");

    setTimeout(() => {
      if (nextProcess !== null) {
        nextProcess.kill("SIGKILL");
      }
      resolve();
    }, 3000);
  });
}

async function restartNext() {
  await killNext();
  startNext();
}

function scheduleRestart() {
  if (!initialBuildDone) {
    return;
  }

  if (restartTimer !== null) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    log("Package dist changed — restarting...");
    await restartNext();
  }, RESTART_DEBOUNCE_MS);
}

// Watch each package's dist/ directory for changes.
const watchers = [];
for (const pkg of WATCHED_PACKAGES) {
  const distDir = resolve(monoRoot, "packages", pkg, "dist");
  try {
    const watcher = watch(distDir, { recursive: true }, (_event, filename) => {
      if (filename && (filename.endsWith(".js") || filename.endsWith(".d.ts"))) {
        scheduleRestart();
      }
    });
    watchers.push(watcher);
  } catch {
    // dist/ may not exist yet on first run — tsc --build will create it.
  }
}

// Start tsc --build --watch for all packages.
log("Starting tsc --build --watch...");
const tsc = spawn(
  "npx",
  ["tsc", "--build", "--watch", "--preserveWatchOutput"],
  {
    cwd: monoRoot,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, FORCE_COLOR: "1" },
  }
);

tsc.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  // Detect when the initial build completes (or a subsequent rebuild).
  if (text.includes("Found 0 errors. Watching for file changes")) {
    if (!initialBuildDone) {
      initialBuildDone = true;
      log("Initial build complete.");
      startNext();

      // Re-attach watchers for dist dirs that may not have existed before.
      for (const pkg of WATCHED_PACKAGES) {
        const distDir = resolve(monoRoot, "packages", pkg, "dist");
        try {
          const watcher = watch(distDir, { recursive: true }, (_event, filename) => {
            if (filename && (filename.endsWith(".js") || filename.endsWith(".d.ts"))) {
              scheduleRestart();
            }
          });
          watchers.push(watcher);
        } catch {
          // Ignore if still missing.
        }
      }
    }
  }
});

tsc.on("exit", (code) => {
  log(`tsc exited (code ${code})`);
  process.exit(code ?? 1);
});

// Cleanup on exit.
function cleanup() {
  for (const w of watchers) {
    w.close();
  }
  tsc.kill();
  if (nextProcess !== null) {
    nextProcess.kill();
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

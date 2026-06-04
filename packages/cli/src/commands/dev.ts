/**
 * `fsdev dev` command — starts an HTTP dev server serving the flow API and DevTool UI.
 *
 * Discovers flows from conventional directories, registers them in a FlowRegistry,
 * then delegates the HTTP server to `@flow-state-dev/node`'s `serve()`, which
 * routes `/api/flows/*` to createFlowApiRouter and serves the DevTool static
 * assets (with SPA fallback) for all other requests.
 */
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import type { FlowInstance, ModelResolver } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createModelResolver,
} from "@flow-state-dev/server";
import { serve } from "@flow-state-dev/node";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { discoverFlows, getSearchedDirs, type DiscoverFlowsOptions } from "../resolve-flow";
import { CliError } from "../resolve-block";
import { EXIT_SUCCESS, EXIT_DISCOVERY_ERROR, EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";
import { loadEnvFiles } from "../load-env";

interface DevCommandOptions {
  port?: string;
  flowDir?: string[];
  model?: string;
  open?: boolean;
}

/** Commander accumulator for repeatable options. */
function collectValues(value: string, previous: string[] | undefined): string[] {
  return (previous ?? []).concat(value);
}

/** Registers the `dev` subcommand on the given commander program. */
export function registerDevCommand(program: Command): void {
  program
    .command("dev")
    .description("Start the DevTool dev server with auto-discovered flows")
    .option("-p, --port <port>", "Port to listen on", "4200")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("-m, --model <model>", "Override model for all generator blocks")
    .option("--no-open", "Don't open the browser automatically")
    .action(async (options: DevCommandOptions) => {
      try {
        await executeDevCommand(options);
      } catch (err) {
        if (err instanceof CliError) {
          process.stderr.write(err.message + "\n");
          process.exitCode = err.exitCode;
          return;
        }
        process.stderr.write(
          `Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = EXIT_INTERNAL_ERROR;
      }
    });
}

/** Core execution logic for `fsdev dev`. */
async function executeDevCommand(options: DevCommandOptions): Promise<void> {
  const port = parseInt(options.port ?? "4200", 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new CliError(`Invalid port: ${options.port}`, EXIT_CONFIG_ERROR);
  }

  // 0. Load .env.local files
  const cwd = process.cwd();
  loadEnvFiles(cwd);

  // 1. Resolve DevTool asset path
  const assetPath = await resolveDevToolAssets();

  // 2. Discover flows
  const discoverOptions: DiscoverFlowsOptions = {
    ...(options.flowDir !== undefined ? { flowDirs: options.flowDir } : {}),
  };
  const flows = await discoverFlows(discoverOptions);

  if (flows.length === 0) {
    const searched = getSearchedDirs(discoverOptions).join(", ");
    throw new CliError(
      `No flows found. Searched: ${searched}\n` +
      `Place flow definitions in src/flows/ or flows/, or use --flow-dir.`,
      EXIT_DISCOVERY_ERROR,
    );
  }

  // 3. Create flow registry
  const registry = createFlowRegistry();
  registry.registerMany(flows as FlowInstance[]);

  // 4. Create stores. SQLite is the default (FIX-406 6A) — the filesystem
  // store's O(N²) event persistence can't hold real load. better-sqlite3 won't
  // create parent dirs, so ensure the data dir exists first.
  await mkdir(".fsdev/data", { recursive: true });
  const stores = createSQLiteStores({ filename: ".fsdev/data/fsdev.db" });

  // 5. Create model resolver
  let modelResolver: ModelResolver | undefined;
  if (options.model !== undefined) {
    const defaultResolver = createModelResolver();
    const override = ((_modelId: string, blockName?: string) => {
      return defaultResolver(options.model!, blockName);
    }) as ModelResolver;
    override.resolveId = (modelId: string) => defaultResolver.resolveId(modelId);
    modelResolver = override;
  }

  // 6. Create flow API router
  const router = createFlowApiRouter({
    registry,
    stores,
    modelResolver,
    // fsdev dev is local-only by definition; opt in to the privileged debug
    // surface so the DevTool's Resources panel can read full server state.
    debugEndpointsEnabled: true,
    // The DevTool observes per-step state snapshots, so the dev server runs at
    // the most verbose tracing level (FIX-406 6H).
    tracingLevel: "verbose",
    onError: (error: Error, context: { method: string; path: string }) => {
      process.stderr.write(`[API error] ${context.method} ${context.path}: ${error.message}\n`);
    },
  });

  // 7. Serve over HTTP via the shared Node host adapter. `serve` owns the
  // node:http bridge (incl. unbuffered SSE) and DevTool static serving; the
  // dev server binds localhost (not the PaaS-default 0.0.0.0) and mounts the
  // API under /api/flows.
  const handle = await serve(router, {
    port,
    host: "127.0.0.1",
    basePath: "/api/flows",
    staticDir: assetPath,
  });

  const flowNames = flows.map((f) => f.kind);
  process.stderr.write("\n");
  process.stderr.write(`  DevTool server running at http://localhost:${port}\n`);
  process.stderr.write("\n");
  process.stderr.write(`  Flows:  ${flowNames.join(", ")}\n`);
  process.stderr.write(`  API:    http://localhost:${port}/api/flows\n`);
  process.stderr.write(`  Data:   .fsdev/data/fsdev.db (SQLite)\n`);
  process.stderr.write("\n");

  if (options.open !== false) {
    openBrowser(`http://localhost:${port}`);
  }

  // Keep the process alive and handle graceful shutdown. `serve` tears down
  // the HTTP server and router on SIGINT/SIGTERM; the dev command additionally
  // closes the SQLite stores it owns (they're passed to the router directly,
  // not via a FlowState, so serve() can't dispose them).
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\nShutting down...\n");
    await handle.close();
    stores.close();
    process.exit(EXIT_SUCCESS);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

/**
 * Resolves the DevTool static assets directory.
 * Tries the published @flow-state-dev/devtool package first,
 * then falls back to a local monorepo build.
 */
async function resolveDevToolAssets(): Promise<string> {
  // Try the @flow-state-dev/devtool package
  try {
    const devtoolPkg = await import("@flow-state-dev/devtool");
    return devtoolPkg.getAssetPath();
  } catch {
    // Not installed or assets not built — try fallback
  }

  // Monorepo fallback: apps/devtool/dist or packages/devtool/dist-client
  const monorepoFallbacks = [
    resolve(process.cwd(), "apps/devtool/dist"),
    resolve(process.cwd(), "packages/devtool/dist-client"),
  ];

  for (const candidate of monorepoFallbacks) {
    if (existsSync(resolve(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw new CliError(
    "DevTool assets not found. Install @flow-state-dev/devtool or build the devtool app:\n" +
    "  pnpm add @flow-state-dev/devtool\n" +
    "  # or in the monorepo: cd apps/devtool && pnpm build",
    EXIT_CONFIG_ERROR,
  );
}

/** Opens a URL in the default browser (best-effort, non-blocking). */
function openBrowser(url: string): void {
  const platform = process.platform;

  const command =
    platform === "darwin" ? `open "${url}"` :
    platform === "win32" ? `start "" "${url}"` :
    `xdg-open "${url}"`;

  exec(command, () => {
    // Ignore errors — browser opening is best-effort
  });
}

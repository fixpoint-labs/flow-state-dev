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
import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createModelResolver,
  type FlowApiRouter,
  type FlowState,
} from "@flow-state-dev/server";
import { serve } from "@flow-state-dev/node";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import {
  discoverFlows,
  getSearchedDirs,
  formatImportFailureWarning,
  formatFailedImportSection,
  type DiscoverFlowsOptions,
  type FlowImportFailure,
} from "../resolve-flow";
import { loadFsdevConfig } from "../load-config";
import { forceModelResolver } from "../model-override";
import { CliError } from "../resolve-block";
import { EXIT_SUCCESS, EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR, EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";
import { loadEnvFiles, loadExplicitEnvFiles } from "../load-env";

interface DevCommandOptions {
  port?: string;
  flowDir?: string[];
  /** Explicit `--dotenv <path>` entries to load before the cwd `.env.local` walk-up. */
  dotenv?: string[];
  model?: string;
  open?: boolean;
  /**
   * fsdev config selection. A string is an explicit `--config <path>`; `false`
   * is `--no-config`; `true`/absent means search for `fsdev.config.*` in cwd.
   */
  config?: string | boolean;
  /** Override the working directory (defaults to process.cwd()). For tests. */
  cwd?: string;
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
    .option("--dotenv <path>", "Load a specific .env file, e.g. an app's (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--no-config", "Ignore fsdev.config.* and use directory discovery")
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

/** Core execution logic for `fsdev dev`, separated for testability. */
export async function executeDevCommand(options: DevCommandOptions): Promise<void> {
  const port = parseInt(options.port ?? "4200", 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new CliError(`Invalid port: ${options.port}`, EXIT_CONFIG_ERROR);
  }

  // 0. Load .env files before importing a config so its providers see env.
  // Explicit --dotenv entries first (they outrank the cwd .env.local walk-up).
  const cwd = options.cwd ?? process.cwd();
  if (options.dotenv !== undefined) loadExplicitEnvFiles(cwd, options.dotenv);
  loadEnvFiles(cwd);

  // 1. Resolve the runtime source. With an fsdev.config.*, the dev server serves
  // the app's own router (so the DevTool observes the app's real stores/flows);
  // otherwise it discovers flows and builds a router over local SQLite stores.
  const useConfig = options.config !== false;
  const configPath = typeof options.config === "string" ? options.config : undefined;
  if (useConfig) {
    // fsdev dev is local-only: opt into the privileged debug surface and verbose
    // tracing so the DevTool's Resources panel and per-step snapshots work. The
    // config's FlowState builds its router lazily, so these must be set as env
    // defaults *before* the config loads — createFlowApiRouter reads them when
    // the FlowState doesn't pass an explicit value.
    process.env.FSDEV_DEBUG_ENDPOINTS ??= "1";
    process.env.FSDEV_TRACING_LEVEL ??= "verbose";
  }
  const loaded = useConfig ? await loadFsdevConfig({ cwd, configPath }) : undefined;

  let serveApp: FlowState | FlowApiRouter;
  let flowNames: string[];
  let dataLine: string;
  let closeStores: (() => void) | undefined;

  if (loaded !== undefined) {
    // --- config path: serve the app's own FlowState ---
    if (options.model !== undefined) {
      throw new CliError(
        "--model can't be combined with fsdev.config.*; the config builds the router with its own " +
          "resolver. Set the model in the config, or pass --no-config.",
        EXIT_INVALID_ARGS,
      );
    }
    if (options.flowDir !== undefined) {
      throw new CliError(
        "--flow-dir bypasses fsdev.config.*; pass --no-config to use directory discovery.",
        EXIT_INVALID_ARGS,
      );
    }
    // serve() resolves getRouter() (triggering store init) and disposes the
    // FlowState on close(), so the dev command owns no stores in this path.
    serveApp = loaded.flowState;
    // Resolve the runtime now so the banner lists flow KINDS (what `fsdev run`
    // takes as its argument), not the config's map keys. getRuntime is memoized,
    // so serve() reuses this resolution rather than initializing stores twice.
    let runtime;
    try {
      runtime = await loaded.flowState.getRuntime();
    } catch (err) {
      // Store init opened (or partially opened) the app's pools before it
      // rejected; dispose so connections aren't leaked until process exit.
      await loaded.flowState.dispose().catch(() => {});
      throw new CliError(
        `Failed to initialize fsdev config ${loaded.path}: ${err instanceof Error ? err.message : String(err)}`,
        EXIT_CONFIG_ERROR,
      );
    }
    flowNames = [...new Set(runtime.registry.list().map((f) => f.kind))];
    dataLine = `config: ${loaded.path}`;
  } else {
    // --- discovery path: scan flows, build a router over local SQLite ---
    // Import failures are warned to stderr unconditionally — diagnostics about
    // broken modules, same category as CliError output.
    const failures: FlowImportFailure[] = [];
    const discoverOptions: DiscoverFlowsOptions = {
      cwd: options.cwd,
      ...(options.flowDir !== undefined ? { flowDirs: options.flowDir } : {}),
      onImportFailed: (failure) => failures.push(failure),
    };
    const flows = await discoverFlows(discoverOptions);
    for (const failure of failures) {
      process.stderr.write(formatImportFailureWarning(failure));
    }

    if (flows.length === 0) {
      const searched = getSearchedDirs(discoverOptions).join(", ");
      throw new CliError(
        `No flows found. Searched: ${searched}\n` +
        `Place flow definitions in src/flows/ or flows/, or use --flow-dir.` +
        formatFailedImportSection(failures),
        EXIT_DISCOVERY_ERROR,
      );
    }

    const registry = createFlowRegistry();
    registry.registerMany(flows as FlowInstance[]);

    // SQLite is the default (FIX-406 6A) — the filesystem store's O(N²) event
    // persistence can't hold real load. better-sqlite3 won't create parent dirs,
    // so ensure the data dir exists first.
    await mkdir(".fsdev/data", { recursive: true });
    const stores = createSQLiteStores({ filename: ".fsdev/data/fsdev.db" });

    const modelResolver =
      options.model !== undefined
        ? forceModelResolver(createModelResolver(), options.model)
        : undefined;

    serveApp = createFlowApiRouter({
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
    flowNames = flows.map((f) => f.kind);
    dataLine = ".fsdev/data/fsdev.db (SQLite)";
    // The router holds these stores directly (not via a FlowState), so serve()
    // can't dispose them — the dev command closes them in its teardown.
    closeStores = () => stores.close();
  }

  // 2. Resolve DevTool asset path. Done after the runtime resolves so invalid
  // args or an empty discovery surface as their own errors before this IO.
  const assetPath = await resolveDevToolAssets();

  // 3. Serve over HTTP via the shared Node host adapter. `serve` owns the
  // node:http bridge (incl. unbuffered SSE) and DevTool static serving; the
  // dev server binds localhost (not the PaaS-default 0.0.0.0) and mounts the
  // API under /api/flows. Passing a FlowState lets serve() resolve and dispose
  // it; passing a router leaves store lifecycle to the dev command.
  const handle = await serve(serveApp, {
    port,
    host: "127.0.0.1",
    basePath: "/api/flows",
    staticDir: assetPath,
    // The dev command owns shutdown, so opt out of serve's signal handlers and
    // drive a single teardown path below.
    handleSignals: false,
  }).catch(async (err: unknown) => {
    // serve() failed to bind (e.g. EADDRINUSE). Ownership of the resolved
    // runtime never transferred to the handle, so release it here: dispose the
    // config's FlowState, or close the discovery path's SQLite stores.
    if (loaded !== undefined) await loaded.flowState.dispose().catch(() => {});
    else closeStores?.();
    throw err;
  });

  process.stderr.write("\n");
  process.stderr.write(`  DevTool server running at http://localhost:${port}\n`);
  process.stderr.write("\n");
  process.stderr.write(`  Flows:  ${flowNames.join(", ")}\n`);
  process.stderr.write(`  API:    http://localhost:${port}/api/flows\n`);
  process.stderr.write(`  Data:   ${dataLine}\n`);
  process.stderr.write("\n");

  if (options.open !== false) {
    openBrowser(`http://localhost:${port}`);
  }

  // Keep the process alive and handle graceful shutdown. `handle.close()` tears
  // down the HTTP server and (in the config path) disposes the FlowState; the
  // discovery path additionally closes the SQLite stores it owns. serve's own
  // signal handling is disabled above so this is the single teardown path.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\nShutting down...\n");
    await handle.close();
    closeStores?.();
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

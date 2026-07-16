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
import {
  createFlowApiRouter,
  createFlowRegistry,
  createModelResolver,
  type FlowApiRouter,
  type FlowState,
} from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { formatFailedImportSection } from "../resolve-flow";
import { resolveRuntimeSource, assertNoFlowDirWithConfig } from "../resolve-runtime";
import { forceModelResolver } from "../model-override";
import { CliError } from "../resolve-block";
import { collectValues } from "../cli-options";
import { EXIT_SUCCESS, EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR, EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";

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
  /**
   * Development transport auth. When true, HTTP action requests are trusted as
   * their body `userId` so bearer-gated flows are debuggable in DevTool with no
   * token. Local-only, opt-in, off by default. Refuses to run when a database
   * URL is set (possible production backend). (FIX-894)
   */
  devAuth?: boolean;
  /** Override the working directory (defaults to process.cwd()). For tests. */
  cwd?: string;
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
    .option("--dev-auth", "Trust request-body userId for HTTP actions so bearer-gated flows are debuggable without a token (local dev only; refuses to run against a database URL)")
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

  // 0-1. Load .env and resolve the runtime source (shared prelude). With an
  // fsdev.config.*, the dev server serves the app's own router (so the DevTool
  // observes the app's real stores/flows); otherwise it discovers flows and
  // builds a router over local SQLite stores. `fsdev dev` is local-only: before
  // the config loads, opt into the privileged debug surface and verbose tracing
  // so the DevTool's Resources panel and per-step snapshots work. The config's
  // FlowState builds its router lazily, so these must be env defaults set before
  // the config loads (createFlowApiRouter reads them when the FlowState doesn't
  // pass an explicit value) — and after env files, so a .env override still wins.
  const resolved = await resolveRuntimeSource({
    cwd: options.cwd,
    config: options.config,
    flowDir: options.flowDir,
    dotenv: options.dotenv,
    beforeConfigLoad: () => {
      if (options.config !== false) {
        process.env.FSDEV_DEBUG_ENDPOINTS ??= "1";
        process.env.FSDEV_TRACING_LEVEL ??= "verbose";
        // A config-based FlowState builds its own router and can't take a
        // devAuth option, so opt in via the env fallback createFlowApiRouter
        // reads (mirrors FSDEV_DEBUG_ENDPOINTS). Discovery path passes it
        // explicitly instead. Only when --dev-auth is requested.
        if (options.devAuth) {
          process.env.FSDEV_DEV_AUTH ??= "1";
        }
      }
    },
  });

  // Effective dev-auth for this server: the --dev-auth flag OR a preset
  // FSDEV_DEV_AUTH=1 (which the engine's env fallback honors even without the
  // flag). The safeguards below — the loud warning and the production-backend
  // refusal — key off this effective state, not just the flag, so a preset env
  // can't activate dev-auth while slipping past both guards.
  const devAuthActive = options.devAuth === true || process.env.FSDEV_DEV_AUTH === "1";

  let serveApp: FlowState | FlowApiRouter;
  let flowNames: string[];
  let dataLine: string;
  let closeStores: (() => void) | undefined;

  if (resolved.source === "config") {
    // --- config path: serve the app's own FlowState ---
    // A config-based server can select a production backend (e.g. `prod` when
    // FSD_DB_URL/DATABASE_URL is set). Dev-auth trusts the body `userId` with no
    // real authentication, so refuse to point it at a possible production store.
    // Each var is tested independently — `??` would let an empty FSD_DB_URL mask a
    // set DATABASE_URL. Checked before getRuntime() opens any connection pool.
    if (devAuthActive) {
      const remoteDbSet = [process.env.FSD_DB_URL, process.env.DATABASE_URL].some(
        (v) => v !== undefined && v.length > 0,
      );
      if (remoteDbSet) {
        await resolved.flowState.dispose().catch(() => {});
        throw new CliError(
          "Development auth refuses to run against a remote/production backend. A database " +
            "URL is set (FSD_DB_URL or DATABASE_URL), so this fsdev config may be serving " +
            "production-backed stores. Dev-auth bypasses per-flow transport auth and trusts " +
            "the request-body userId — never point it at production data. Unset the database " +
            "URL to debug locally, or drop --dev-auth / FSDEV_DEV_AUTH.",
          EXIT_INVALID_ARGS,
        );
      }
    }
    if (options.model !== undefined) {
      throw new CliError(
        "--model can't be combined with fsdev.config.*; the config builds the router with its own " +
          "resolver. Set the model in the config, or pass --no-config.",
        EXIT_INVALID_ARGS,
      );
    }
    assertNoFlowDirWithConfig(options.flowDir);
    // serve() resolves getRouter() (triggering store init) and disposes the
    // FlowState on close(), so the dev command owns no stores in this path.
    serveApp = resolved.flowState;
    // Resolve the runtime now so the banner lists flow KINDS (what `fsdev run`
    // takes as its argument), not the config's map keys. getRuntime is memoized,
    // so serve() reuses this resolution rather than initializing stores twice.
    let runtime;
    try {
      runtime = await resolved.flowState.getRuntime();
    } catch (err) {
      // Store init opened (or partially opened) the app's pools before it
      // rejected; dispose so connections aren't leaked until process exit.
      await resolved.flowState.dispose().catch(() => {});
      throw new CliError(
        `Failed to initialize fsdev config ${resolved.configPath}: ${err instanceof Error ? err.message : String(err)}`,
        EXIT_CONFIG_ERROR,
      );
    }
    flowNames = [...new Set(runtime.registry.list().map((f) => f.kind))];
    dataLine = `config: ${resolved.configPath}`;
  } else {
    // --- discovery path: scan flows, build a router over local SQLite ---
    if (resolved.flows.length === 0) {
      const searched = resolved.searchedDirs.join(", ");
      throw new CliError(
        `No flows found. Searched: ${searched}\n` +
        `Place flow definitions in src/flows/ or flows/, or use --flow-dir.` +
        formatFailedImportSection(resolved.importFailures),
        EXIT_DISCOVERY_ERROR,
      );
    }

    const registry = createFlowRegistry();
    registry.registerMany(resolved.flows);

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
      // Discovery always serves local SQLite, so --dev-auth is safe here; pass
      // it explicitly rather than relying on the env fallback.
      devAuth: options.devAuth,
      // The DevTool observes per-step state snapshots, so the dev server runs at
      // the most verbose tracing level (FIX-406 6H).
      tracingLevel: "verbose",
      onError: (error: Error, context: { method: string; path: string }) => {
        process.stderr.write(`[API error] ${context.method} ${context.path}: ${error.message}\n`);
      },
    });
    flowNames = resolved.flows.map((f) => f.kind);
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
    if (resolved.source === "config") await resolved.flowState.dispose().catch(() => {});
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

  // Never bypass auth silently. When dev-auth is on — via the flag OR a preset
  // FSDEV_DEV_AUTH=1 — name the store target so an accidental bypass is loud.
  if (devAuthActive) {
    process.stderr.write(
      "  ⚠  DEVELOPMENT AUTH ENABLED (--dev-auth)\n" +
      "     HTTP action requests are trusted as their body `userId`; per-flow\n" +
      "     transport auth is bypassed for DevTool traffic (MCP/scheduled untouched).\n" +
      `     Store target: ${dataLine}. Never use against production data.\n\n`,
    );
  }

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

/**
 * `fsdev serve` command — starts a production HTTP server for the flow API and
 * MCP endpoints, with no DevTool UI.
 *
 * The production counterpart to `fsdev dev`: it loads the app's committed
 * `fsdev.config.*` (never directory discovery), hands the app's `FlowState` to
 * `@flow-state-dev/node`'s `serve()` with no `staticDir` (so the DevTool SPA is
 * never mounted), and binds PaaS-friendly defaults (`$HOST ?? 0.0.0.0`,
 * `$PORT ?? 3000`) — the inverse of `dev`'s localhost + fixed port. Before
 * binding a network host it runs the shared loopback-bind guard, which refuses to
 * expose a flow that would run on the framework's default (unauthenticated)
 * principal resolver.
 */
import type { Command } from "commander";
import { serve, assertNetworkBindIsAuthenticated } from "@flow-state-dev/node";
import { resolveRuntimeSource } from "../resolve-runtime";
import { CliError } from "../resolve-block";
import { collectValues } from "../cli-options";
import { EXIT_SUCCESS, EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";

interface ServeCommandOptions {
  /** `-p, --port` — omit to let `$PORT ?? 3000` apply via serve(). */
  port?: string;
  /** `--host` — omit to let `$HOST ?? 0.0.0.0` apply. */
  host?: string;
  /** Explicit `--config <path>`. No `--no-config`: serve always requires a committed config. */
  config?: string;
  /** Explicit `--dotenv <path>` entries to load before the cwd `.env.local` walk-up. */
  dotenv?: string[];
  /** Bind a network host even if a flow has no authentication configured. */
  allowUnauthenticated?: boolean;
  /** Override the working directory (defaults to process.cwd()). For tests. */
  cwd?: string;
}

/** Registers the `serve` subcommand on the given commander program. */
export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start a production server for the flow API and MCP endpoints (no DevTool UI)")
    .option("-p, --port <port>", "Port to listen on (default: $PORT, then 3000)")
    .option("--host <host>", "Host to bind (default: $HOST, then 0.0.0.0)")
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--dotenv <path>", "Load a specific .env file (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--allow-unauthenticated", "Bind a network host even if a flow has no authentication configured")
    .action(async (options: ServeCommandOptions) => {
      try {
        await executeServeCommand(options);
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

/** Core execution logic for `fsdev serve`, separated for testability. */
export async function executeServeCommand(options: ServeCommandOptions): Promise<void> {
  // Validate --port up front. Omitted → undefined, so serve() applies $PORT ?? 3000.
  let port: number | undefined;
  if (options.port !== undefined) {
    port = parseInt(options.port, 10);
    if (isNaN(port) || port < 0 || port > 65535) {
      throw new CliError(`Invalid port: ${options.port}`, EXIT_CONFIG_ERROR);
    }
  }

  // Load .env and the committed config. requireConfig throws before directory
  // discovery runs, so a repo with conventional flow modules doesn't import them
  // on the way to the "requires committed config" error. A successful return is
  // always source: "config".
  const resolved = await resolveRuntimeSource({
    cwd: options.cwd,
    config: options.config ?? true,
    dotenv: options.dotenv,
    requireConfig: true,
  });
  if (resolved.source !== "config") {
    // Unreachable: requireConfig makes a non-config resolution throw. Narrows the
    // union for TypeScript and fails loudly if that invariant ever changes.
    throw new CliError("fsdev serve requires a committed fsdev config.", EXIT_CONFIG_ERROR);
  }

  // $HOST fallback is symmetric with serve()'s $PORT handling and preserves the
  // documented `HOST=127.0.0.1` local-only recipe for apps migrating off a
  // hand-written entrypoint.
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  // Loopback-bind safety rail. Refuses a network host when a served flow would
  // run on the framework's default (unauthenticated) principal resolver.
  // getRuntime() is memoized inside the guard, so serve() reuses that resolution
  // rather than initializing stores twice.
  try {
    await assertNetworkBindIsAuthenticated(resolved.flowState, {
      host,
      allowUnauthenticated: options.allowUnauthenticated,
    });
  } catch (err) {
    // Ownership of the FlowState never transferred to a handle; dispose it here.
    await resolved.flowState.dispose().catch(() => {});
    throw new CliError(err instanceof Error ? err.message : String(err), EXIT_CONFIG_ERROR);
  }

  // Serve over HTTP with no staticDir (no DevTool UI, ever). serve owns the
  // node:http bridge and unbuffered SSE; the config's adapters (e.g. MCP) mount
  // as they do under `dev`. handleSignals: false so shutdown lives in one path.
  const handle = await serve(resolved.flowState, {
    host,
    port,
    basePath: "/api/flows",
    handleSignals: false,
  }).catch(async (err: unknown) => {
    // A listen failure (EADDRINUSE, EACCES) — ownership never transferred, so
    // dispose the FlowState. Surface as a config error (exit 3): an operational
    // misconfiguration a deployment script can act on, not an internal bug.
    await resolved.flowState.dispose().catch(() => {});
    throw new CliError(
      `Failed to start server on ${host}:${port ?? process.env.PORT ?? 3000}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      EXIT_CONFIG_ERROR,
    );
  });

  process.stderr.write("\n");
  process.stderr.write(`  Server running at http://${host}:${handle.port}\n`);
  process.stderr.write(`  API:    http://${host}:${handle.port}/api/flows\n`);
  process.stderr.write(`  Config: ${resolved.configPath}\n`);
  process.stderr.write("\n");

  // Keep the process alive and drive a single graceful-shutdown path.
  // handle.close() disposes the FlowState (via createServerApp), so we don't
  // dispose separately here.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\nShutting down...\n");
    await handle.close();
    process.exit(EXIT_SUCCESS);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

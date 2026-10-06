/**
 * `fsdev dev` command — starts an HTTP dev server serving the flow API and DevTool UI.
 *
 * Discovers flows from conventional directories, registers them in a FlowRegistry,
 * then delegates the HTTP server to `@flow-state-dev/node`'s `serve()`, which
 * routes `/api/flows/*` to createFlowApiRouter and serves the DevTool static
 * assets (with SPA fallback) for all other requests.
 *
 * With `--app <package|dir>`, an app's built pages take the root of the port
 * instead, beside the same API, and the DevTool moves to a port of its own over
 * the same runtime. Each page the app serves carries the DevTool's address as
 * the `fsdev-devtool-url` meta. fsdev knows nothing else about the app.
 *
 * `--host` binds loopback by default. A non-loopback host runs `fsdev serve`'s
 * authentication guard, refuses a config that hands its page a bearer token, and
 * leaves the anonymous debug surface closed.
 *
 * `--watch` (loopback only) runs this command again as a child under
 * `node --watch` and restarts it on a Lab change, reloading the open pages; an
 * `--app` with a source folder is served through its own Vite (`dev-watch.ts`,
 * `dev-vite.ts`).
 */
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Command } from "commander";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createModelResolver,
  type DevToolConnectionConfig,
  type FlowApiRouter,
  type FlowState,
} from "@flow-state-dev/engine";
import {
  assertNetworkBindIsAuthenticated,
  createPageHtmlTransform,
  isLoopbackHost,
  serve,
  type ServeHandle,
} from "@flow-state-dev/node";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { declaredDevtoolConfig } from "../devtool-config";
import { resolveApp, type AppPages } from "../dev-app";
import { createVitePages } from "../dev-vite";
import {
  announceReady,
  chainPageHandlers,
  createReloadSignal,
  reportWatchFiles,
  superviseDev,
  takeWatchChild,
  watchLabFiles,
  type ReloadSignal,
} from "../dev-watch";
import { formatFailedImportSection } from "../resolve-flow";
import { locateConfig } from "../load-config";
import { resolveRuntimeSource, assertNoFlowDirWithConfig } from "../resolve-runtime";
import { forceModelResolver } from "../model-override";
import { CliError } from "../resolve-block";
import { collectValues } from "../cli-options";
import { EXIT_SUCCESS, EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR, EXIT_CONFIG_ERROR, EXIT_INTERNAL_ERROR } from "../exit-codes";

/** Options for {@link executeDevCommand}: the `fsdev dev` flags, plus programmatic extras. */
export interface DevCommandOptions {
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
  /**
   * `--app <package|dir>`: serve this app's built pages at the root, the DevTool beside them.
   * The path of the package's module file also names the package, wherever `cwd` is.
   */
  app?: string;
  /** `--host <host>`: the host to bind. Default `127.0.0.1`. */
  host?: string;
  /** `--allow-unauthenticated`: bind a network host even if a flow has no authentication. */
  allowUnauthenticated?: boolean;
  /**
   * `--watch`: restart when a file the config loaded changes, and reload open
   * pages; serve an app's source through Vite when it has one. Loopback only.
   * The process's own entry (`process.argv[1]`) is re-run with the same
   * arguments under `node --watch`, so a command that wraps this one restarts
   * as itself and passes the same options again.
   */
  watch?: boolean;
  /**
   * Extra `<meta name content>` tags for every HTML page served at the root of
   * the port. Programmatic only, for a command that wraps `fsdev dev`. Written
   * on any host, so never a secret.
   */
  pageMeta?: Record<string, string>;
}

/** Name of the meta tag that carries the DevTool's address to an app's pages. */
export const DEVTOOL_URL_META = "fsdev-devtool-url";

/** The running dev server, as {@link executeDevCommand} returns it. */
export interface DevServer {
  /** Address of the pages at the root of the port (the DevTool, or the `--app` pages). */
  readonly url: string;
  /** The DevTool's address when it runs on a port of its own beside an app; else `undefined`. */
  readonly devtoolUrl: string | undefined;
  /**
   * Close the servers and dispose the runtime, without exiting the process.
   * Also removes the SIGINT/SIGTERM handlers the command installed. Idempotent.
   */
  close(): Promise<void>;
}

/** The default bind: loopback only. */
const DEFAULT_HOST = "127.0.0.1";

/** Registers the `dev` subcommand on the given commander program. */
export function registerDevCommand(program: Command): void {
  program
    .command("dev")
    .description("Start the DevTool dev server with auto-discovered flows")
    .option("-p, --port <port>", "Port to listen on", "4200")
    .option("--host <host>", "Host to bind (default: 127.0.0.1)")
    .option("--allow-unauthenticated", "Bind a network host even if a flow has no authentication configured")
    .option("--app <package|dir>", "Serve an app's built pages at the root; the DevTool moves to its own port")
    .option("--watch", "Restart when a file your config loaded changes, and reload open pages (loopback only)")
    .option("--flow-dir <path>", "Override flow discovery root (repeatable)", collectValues, undefined)
    .option("--dotenv <path>", "Load a specific .env file, e.g. an app's (repeatable, resolved from cwd)", collectValues, undefined)
    .option("--config <path>", "Path to an fsdev config file (default: fsdev.config.{ts,mts,js,mjs} in cwd)")
    .option("--no-config", "Ignore fsdev.config.* and use directory discovery")
    .option("-m, --model <model>", "Override model for generator blocks run in this process")
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

/**
 * Core execution logic for `fsdev dev`, separated for testability. Resolves once
 * the server listens, with a handle to stop it; SIGINT/SIGTERM stop it and exit.
 *
 * With `watch`, the process supervises instead: it resolves once a child runs
 * the server under `node --watch` (see `dev-watch.ts`), and the child, which
 * runs this same function, serves.
 */
export async function executeDevCommand(options: DevCommandOptions): Promise<DevServer> {
  // A whole number in range: parseInt would bind 12 for "12abc".
  const portInput = options.port ?? "4200";
  const port = /^\d+$/.test(portInput) ? Number(portInput) : NaN;
  if (!Number.isInteger(port) || port > 65535) {
    throw new CliError(`Invalid port: ${options.port}`, EXIT_CONFIG_ERROR);
  }
  const host = options.host ?? DEFAULT_HOST;
  const loopback = isLoopbackHost(host);
  const cwd = options.cwd ?? process.cwd();
  // Set when this process is a child a `--watch` parent started.
  const watchChild = takeWatchChild();

  if (options.watch === true && !loopback) {
    throw new CliError(
      `Refusing --watch on ${host}: it restarts the server and reloads its pages for local development, ` +
        `so it binds loopback only. Bind --host 127.0.0.1.`,
      EXIT_CONFIG_ERROR,
    );
  }

  // The app's pages, checked before the config loads so bad input fails first.
  const app =
    options.app === undefined
      ? undefined
      : await resolveApp(options.app, cwd, options.watch === true);

  if (options.watch === true && watchChild === undefined) {
    // The parent: bad input fails here, since a child that fails before it
    // reports a file leaves `node --watch` nothing to restart it on.
    if (typeof options.config === "string") locateConfig({ cwd, configPath: options.config });
    for (const file of options.dotenv ?? []) {
      const path = isAbsolute(file) ? file : resolve(cwd, file);
      if (!existsSync(path)) throw new CliError(`--dotenv file not found: ${path}`, EXIT_CONFIG_ERROR);
    }
    // The child loads the config.
    let devtool = false;
    if (app !== undefined) devtool = await resolveDevToolAssets().then(() => true, () => false);
    const supervisor = await superviseDev({
      host,
      port,
      devtool,
      onFirstReady: (url) => {
        if (options.open !== false) openBrowser(shownUrl(url, host));
      },
    });
    process.stderr.write(
      `\n  Watching: a save to a file the config loaded restarts the server, and open pages reload.\n`,
    );
    return withSignals(supervisor);
  }
  if (app?.note !== undefined) process.stderr.write(`${app.note}\n`);

  let reload: ReloadSignal | undefined;
  if (watchChild !== undefined) {
    // Before the config loads, so a save to a file it reads at import (a tree
    // file, say) restarts this child even when that file made the load fail.
    const configPath =
      options.config === false
        ? undefined
        : locateConfig({ cwd, configPath: typeof options.config === "string" ? options.config : undefined });
    if (configPath !== undefined) {
      const pages = app?.pages.kind === "source" ? app.pages.root : app?.pages.dir;
      watchLabFiles(dirname(configPath), pages === undefined ? [] : [pages]);
    }
    reload = createReloadSignal();
  }

  const runtime = await resolveDevRuntime(options, host, loopback);

  const server = await startListeners({
    ...runtime,
    host,
    port: watchChild?.port ?? port,
    devtoolPort: watchChild?.devtoolPort ?? 0,
    appPages: app?.pages,
    pageMeta: options.pageMeta,
    // A child's browser opens from the parent, once.
    open: watchChild === undefined && options.open !== false,
    reload,
  });
  announceReady();
  return server;
}

/** The runtime `fsdev dev` serves, and what it takes to print and release it. */
interface DevRuntime {
  /** The config's FlowState, or the discovery path's router. */
  serveApp: FlowState | FlowApiRouter;
  flowNames: string[];
  dataLine: string;
  /** DevTool connection config declared in the config (userId / bearer token). */
  devtoolConfig: DevToolConnectionConfig | undefined;
  /** Closes the discovery path's SQLite stores, which no FlowState owns. */
  closeStores: (() => void) | undefined;
  /** Dispose the runtime when a server fails to bind. */
  releaseRuntime(): Promise<void>;
}

/**
 * Load the config (or discover flows) and resolve the runtime, applying the
 * network-bind guards. Throws a CliError for bad input, as `fsdev dev` reports it.
 */
async function resolveDevRuntime(options: DevCommandOptions, host: string, loopback: boolean): Promise<DevRuntime> {
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
    beforeConfigLoad: (envFiles) => {
      // A watch child restarts on a save to an env file it loaded.
      reportWatchFiles(envFiles);
      // Never on a network bind: the debug surface reads full server state and
      // admits Origin-less requests, which only a loopback page may make.
      if (!loopback) {
        // Force off rather than leave unset: a .env file, the shell, or an
        // earlier loopback run in this process may have turned them on.
        process.env.FSDEV_DEBUG_ENDPOINTS = "0";
        process.env.FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL = "0";
      } else if (options.config !== false) {
        process.env.FSDEV_DEBUG_ENDPOINTS ??= "1";
        // The DevTool's same-origin GETs carry no Origin header; the engine
        // closes the debug surface to those unless opted in. Safe here: this
        // branch runs only for a loopback bind.
        process.env.FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL ??= "1";
        process.env.FSDEV_TRACING_LEVEL ??= "verbose";
      }
    },
  });

  let serveApp: FlowState | FlowApiRouter;
  let flowNames: string[];
  let dataLine: string;
  let closeStores: (() => void) | undefined;
  // DevTool connection config declared in the app's fsdev.config.ts (userId /
  // bearer token). Only the config path has a FlowState to read it from; the
  // discovery path serves a bare router with no such config.
  let devtoolConfig: DevToolConnectionConfig | undefined;

  if (resolved.source === "config") {
    // --- config path: serve the app's own FlowState ---
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
    flowNames = runtime.registry.list().map((f) => f.id);
    dataLine = `config: ${resolved.configPath}`;
    // `meta` is a sync getter — no extra store init. Injected into the DevTool
    // page by serve() so a secured flow is debuggable without hand-editing
    // DevTool settings. Normalize an empty/blank-only `devtool` block to
    // undefined so serve() leaves the static path byte-identical to production.
    devtoolConfig = declaredDevtoolConfig(resolved.flowState);

    if (!loopback) {
      // serve() writes the devtool block into loopback pages only, so a page on
      // this host would open without the bearer the config requires.
      if ((devtoolConfig?.bearerToken?.trim().length ?? 0) > 0) {
        await resolved.flowState.dispose().catch(() => {});
        throw new CliError(
          `Refusing to bind ${host}: this config hands its page a bearer token, and that token only ever ` +
            `goes to a page on a loopback host. Bind --host 127.0.0.1.`,
          EXIT_CONFIG_ERROR,
        );
      }
      try {
        await assertNetworkBindIsAuthenticated(resolved.flowState, {
          host,
          allowUnauthenticated: options.allowUnauthenticated,
        });
      } catch (err) {
        await resolved.flowState.dispose().catch(() => {});
        throw new CliError(err instanceof Error ? err.message : String(err), EXIT_CONFIG_ERROR);
      }
    }
  } else {
    // --- discovery path: scan flows, build a router over local SQLite ---
    if (!loopback) {
      // The discovered router opens the debug surface and has no authentication
      // to check; a network bind needs a config, as `fsdev serve` does.
      throw new CliError(
        `Refusing to bind ${host}: a non-loopback host needs an fsdev config (--config), ` +
          `so its authentication can be checked.`,
        EXIT_CONFIG_ERROR,
      );
    }
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
      // The DevTool's same-origin GETs carry no Origin header; this server
      // binds 127.0.0.1, so admitting them is safe.
      debugAllowAnonymousLocal: true,
      // The DevTool observes per-step state snapshots, so the dev server runs at
      // the most verbose tracing level (FIX-406 6H).
      tracingLevel: "verbose",
      onError: (error: Error, context: { method: string; path: string }) => {
        process.stderr.write(`[API error] ${context.method} ${context.path}: ${error.message}\n`);
      },
    });
    flowNames = resolved.flows.map((f) => f.id);
    dataLine = ".fsdev/data/fsdev.db (SQLite)";
    // The router holds these stores directly (not via a FlowState), so serve()
    // can't dispose them — the dev command closes them in its teardown.
    closeStores = () => stores.close();
  }

  // Release the resolved runtime when a server fails to bind: dispose the
  // config's FlowState, or close the discovery path's SQLite stores.
  const releaseRuntime = async () => {
    if (resolved.source === "config") await resolved.flowState.dispose().catch(() => {});
    else closeStores?.();
  };

  return {
    serveApp,
    flowNames,
    dataLine,
    devtoolConfig,
    closeStores,
    releaseRuntime,
  };
}

/** What {@link startListeners} serves, and where. */
interface ListenerOptions extends DevRuntime {
  host: string;
  port: number;
  /** The DevTool's port beside an app: fixed by a `--watch` parent, else `0`. */
  devtoolPort: number;
  appPages: AppPages | undefined;
  /** Extra page meta from a programmatic caller. */
  pageMeta: Record<string, string> | undefined;
  open: boolean;
  /** Set in a `--watch` child: the pages reload when the next child is up. */
  reload: ReloadSignal | undefined;
}

/** How long a `--watch` child's servers wait for open requests before a restart closes them. */
const WATCH_SHUTDOWN_GRACE_MS = 1_000;

/**
 * How long a `--watch` child's whole shutdown may take before it exits anyway.
 * The runtime waits up to its drain budget (30 s by default) for runs still
 * going, and a held run would hold every restart that long. A restart is a new
 * process either way; a run cut off here is left as a killed process leaves it.
 *
 * A ceiling on the exit rather than a smaller drain budget, because the budget
 * (`dispatchDrainTimeoutMs`) is fixed when the config builds its FlowState and
 * `dispose()` takes none. Exiting before the stores close is what a kill does:
 * a committed SQLite write survives an unclosed connection, and the run left
 * `in_progress` is marked interrupted by the restarted child's recovery sweep
 * (`detectInterruptedRequests`) once its heartbeat goes stale.
 */
const WATCH_SHUTDOWN_CEILING_MS = 3_000;

/**
 * Start the servers over a resolved runtime, print the banner, and install the
 * SIGINT/SIGTERM teardown. Releases the runtime when a server fails to bind.
 */
async function startListeners(o: ListenerOptions): Promise<DevServer> {
  const { host, appPages, reload } = o;

  // 2. Resolve DevTool asset path. Done after the runtime resolves so invalid
  // args or an empty discovery surface as their own errors before this IO.
  // Beside an app the DevTool is optional: without its pages the app still
  // starts, and its pages get no address.
  let devtoolAssets: string | undefined;
  try {
    devtoolAssets = await resolveDevToolAssets();
  } catch (err) {
    if (appPages === undefined) throw err;
    process.stderr.write(
      `DevTool not served beside the app, so its pages get no ${DEVTOOL_URL_META}: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // Under --watch, each server stamps its pages with the boot id and serves
  // the stream they reload from, and drains quickly so a restart isn't held up.
  const watchOptions =
    reload === undefined
      ? {}
      : { pageScript: reload.pageScript, pageHandler: reload.handler, shutdownGraceMs: WATCH_SHUTDOWN_GRACE_MS };

  // 3. Serve over HTTP via the shared Node host adapter. `serve` owns the
  // node:http bridge (incl. unbuffered SSE) and static serving; the dev server
  // binds loopback by default (not the PaaS-default 0.0.0.0) and mounts the
  // API under /api/flows. Passing a FlowState lets serve() resolve and dispose
  // it; passing a router leaves store lifecycle to the dev command. The dev
  // command owns shutdown, so each serve() opts out of its signal handlers.
  //
  // With an app, the DevTool gets a port of its own over the same runtime (its
  // build loads its files from `/`, so it can't share the app's origin), and
  // starts first because its address goes into the app's pages.
  let devtoolHandle: ServeHandle | undefined;
  if (appPages !== undefined && devtoolAssets !== undefined) {
    devtoolHandle = await serve(o.serveApp, {
      port: o.devtoolPort,
      host,
      basePath: "/api/flows",
      staticDir: devtoolAssets,
      devtoolConfig: o.devtoolConfig,
      ...(reload === undefined ? {} : { pageMeta: reload.pageMeta }),
      ...watchOptions,
      handleSignals: false,
      // The app's server owns the shared runtime and disposes it last.
      disposeOnClose: false,
    }).catch(async (err: unknown) => {
      await o.releaseRuntime();
      throw err;
    });
  }
  const devtoolUrl = devtoolHandle === undefined ? undefined : `http://${urlHost(host)}:${devtoolHandle.port}/`;
  // A wildcard bind address reaches nothing from a browser, and the server
  // can't know which of its addresses the browser used, so the page gets no
  // DevTool address then; the banner still prints the port.
  const pageMeta = {
    ...o.pageMeta,
    ...reload?.pageMeta,
    ...(devtoolUrl === undefined || isWildcardHost(host) ? {} : { [DEVTOOL_URL_META]: devtoolUrl }),
  };

  // From source, Vite answers the page requests a built directory would, and
  // its index goes through the same page transform serve() applies.
  const vite =
    appPages?.kind === "source"
      ? createVitePages({
          root: appPages.root,
          viteEntry: appPages.viteEntry,
          htmlTransform: createPageHtmlTransform({
            host,
            devtoolConfig: o.devtoolConfig,
            pageMeta,
            pageScript: reload?.pageScript,
          }),
        })
      : undefined;
  const pageHandler =
    reload === undefined ? vite?.handler : chainPageHandlers(reload.handler, vite?.handler);

  let handle: ServeHandle;
  try {
    handle = await serve(o.serveApp, {
      port: o.port,
      host,
      basePath: "/api/flows",
      staticDir: appPages === undefined ? devtoolAssets : appPages.kind === "built" ? appPages.dir : undefined,
      devtoolConfig: o.devtoolConfig,
      pageMeta,
      ...watchOptions,
      pageHandler,
      handleSignals: false,
    });
    await vite?.attach(handle.server).catch(async (err: unknown) => {
      await handle.close();
      throw err;
    });
  } catch (err) {
    // A server failed to bind (e.g. EADDRINUSE) or Vite failed to start.
    // Ownership of the resolved runtime never transferred, so release it here.
    reload?.close();
    await devtoolHandle?.close().catch(() => {});
    await vite?.close().catch(() => {});
    await o.releaseRuntime();
    throw err;
  }

  const url = `http://${urlHost(host)}:${handle.port}/`;
  const shown = (u: string) => shownUrl(u, host);
  process.stderr.write("\n");
  if (appPages === undefined) {
    process.stderr.write(`  DevTool server running at ${shown(url)}\n`);
  } else {
    const from = appPages.kind === "built" ? appPages.dir : `${appPages.root}, through Vite`;
    process.stderr.write(`  App:     ${shown(url)}  (${from})\n`);
    process.stderr.write(`  DevTool: ${devtoolUrl === undefined ? "not served" : shown(devtoolUrl)}\n`);
  }
  process.stderr.write("\n");
  process.stderr.write(`  Flows:  ${o.flowNames.join(", ")}\n`);
  process.stderr.write(`  API:    ${shown(url)}/api/flows\n`);
  process.stderr.write(`  Data:   ${o.dataLine}\n`);
  process.stderr.write("\n");

  if (o.open) {
    openBrowser(shown(url));
  }

  // Graceful shutdown. Open reload streams end first, so the pages reconnect
  // to the next server. The DevTool's server drains without disposing; then
  // the app's server drains and (in the config path) disposes the FlowState
  // both share, so the runtime outlives every in-flight request. The discovery
  // path additionally closes the SQLite stores it owns. serve's own signal
  // handling is disabled above so this is the single teardown path.
  return withSignals(
    {
      url,
      devtoolUrl,
      close: async () => {
        reload?.close();
        await devtoolHandle?.close();
        await vite?.close();
        await handle.close();
        o.closeStores?.();
      },
    },
    reload === undefined ? undefined : WATCH_SHUTDOWN_CEILING_MS,
  );
}

/**
 * `server`, with SIGINT/SIGTERM closing it and exiting. Its `close()` becomes
 * idempotent and removes the handlers once closed, so a second signal
 * mid-shutdown is ignored. With `ceilingMs`, a signal exits once that long has
 * passed even if the close has not finished.
 */
function withSignals(server: DevServer, ceilingMs?: number): DevServer {
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await server.close();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    })();
    return closing;
  };
  const onSignal = () => {
    if (closing !== undefined) return;
    process.stderr.write("\nShutting down...\n");
    void close().then(() => process.exit(EXIT_SUCCESS));
    if (ceilingMs !== undefined) setTimeout(() => process.exit(EXIT_SUCCESS), ceilingMs).unref();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  return { url: server.url, devtoolUrl: server.devtoolUrl, close };
}

/** `url` as the banner prints it: `localhost` for the default bind, as it always has, without a trailing slash. */
function shownUrl(url: string, host: string): string {
  return (host === DEFAULT_HOST ? url.replace(DEFAULT_HOST, "localhost") : url).replace(/\/$/, "");
}

/** Whether `host` is an all-interfaces bind address rather than one a browser can reach. */
function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

/** `host` as it goes in a URL: an IPv6 address in brackets. */
function urlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
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

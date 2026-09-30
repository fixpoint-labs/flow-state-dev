/**
 * `pnpm --filter @flow-state-dev/app-lab start --config <path>` — open a Lab in App Lab.
 *
 * Loads the Lab's own `fsdev` config (the file `fsdev dev` already serves) with
 * the CLI's loader, and hands the `FlowState` it default-exports to the shipped
 * Node host with App Lab's built pages as the static directory. One process
 * serves the Lab's API under `/api/flows` and App Lab's pages beside it, the
 * way `fsdev dev` serves the DevTool. Nothing in the Lab's config is edited or
 * wrapped, and nothing here knows which Lab it is serving.
 *
 * A config that does not load, or whose default export is not a `FlowState`,
 * stops the process with the loader's own message (BR-2).
 *
 * Binds loopback by default. A non-loopback `--host` runs the same guard
 * `fsdev serve` does, which refuses a Lab that would answer on the framework's
 * unauthenticated default principal, and is refused outright for a Lab that
 * hands its page a bearer token: that token only ever goes to a loopback page.
 *
 * Paths are resolved from the directory the command was typed in
 * (`INIT_CWD`, which pnpm sets for a filtered script), and the process runs
 * there, so a Lab's relative paths (its SQLite file, say) land where they would
 * under `fsdev dev` started from the same place.
 *
 * Options:
 *   --config <path>   the Lab's fsdev config (required)
 *   --port <n>        default 4300; 0 picks a free port
 *   --host <host>     default 127.0.0.1
 *   --assets <dir>    serve a different build of App Lab's pages (default: this package's dist/)
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { declaredDevtoolConfig, loadFsdevConfig } from "@flow-state-dev/fsdev";
import { assertNetworkBindIsAuthenticated, isLoopbackHost, serve } from "@flow-state-dev/node";

/** App Lab's own build output. */
const DEFAULT_ASSETS = fileURLToPath(new URL("../dist", import.meta.url));

/** Exit code for a config or argument problem; matches the CLI's. */
const EXIT_CONFIG_ERROR = 3;

function fail(message: string, code = EXIT_CONFIG_ERROR): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    port: { type: "string", default: "4300" },
    host: { type: "string", default: "127.0.0.1" },
    assets: { type: "string" },
  },
  strict: true,
});

const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const from = (path: string): string => (isAbsolute(path) ? path : resolve(invokedFrom, path));

if (values.config === undefined) {
  fail("App Lab needs a Lab to open: pass --config <path to the Lab's fsdev config>.");
}
const port = /^\d+$/.test(values.port!) ? Number(values.port) : NaN;
if (!Number.isInteger(port) || port > 65535) fail(`Invalid port: ${values.port}`);

const assets = values.assets === undefined ? DEFAULT_ASSETS : from(values.assets);
if (!existsSync(resolve(assets, "index.html"))) {
  fail(`App Lab's pages are not built at ${assets}. Run: pnpm --filter @flow-state-dev/app-lab build`);
}

// Process-global: nothing else in this package may assume the package directory as cwd.
process.chdir(invokedFrom);

let loaded: Awaited<ReturnType<typeof loadFsdevConfig>>;
try {
  loaded = await loadFsdevConfig({ cwd: invokedFrom, configPath: values.config });
} catch (error) {
  const code = (error as { exitCode?: unknown }).exitCode;
  fail(error instanceof Error ? error.message : String(error), typeof code === "number" ? code : EXIT_CONFIG_ERROR);
}
if (loaded === undefined) fail(`No fsdev config at ${values.config}.`);
const flowState = loaded.flowState;

const host = values.host!;

// The same connection config `fsdev dev` hands the DevTool page: which user the
// Lab runs as, and its bearer token if it declares one. `serve()` injects it on
// a loopback host only, so on any other host the page would open without the
// credential the Lab requires. Refuse that up front rather than serve a page
// that can't read the Lab.
const devtoolConfig = declaredDevtoolConfig(flowState);
if ((devtoolConfig?.bearerToken?.trim().length ?? 0) > 0 && !isLoopbackHost(host)) {
  await flowState.dispose().catch(() => {});
  fail(
    `App Lab won't serve ${host}: this Lab hands its page a bearer token, and that token is only ever given to a page on a loopback host. Bind --host 127.0.0.1.`,
  );
}

try {
  await assertNetworkBindIsAuthenticated(flowState, { host });
} catch (error) {
  await flowState.dispose().catch(() => {});
  fail(error instanceof Error ? error.message : String(error));
}

const handle = await serve(flowState, {
  host,
  port,
  basePath: "/api/flows",
  staticDir: assets,
  devtoolConfig,
  handleSignals: false,
}).catch(async (error: unknown) => {
  await flowState.dispose().catch(() => {});
  return fail(`App Lab could not listen on ${host}:${port}: ${error instanceof Error ? error.message : String(error)}`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

try {
  await flowState.ready();
} catch (error) {
  await handle.close().catch(() => {});
  fail(`The Lab failed to start: ${error instanceof Error ? error.message : String(error)}`);
}

process.stderr.write(`\n  App Lab: http://${host}:${handle.port}\n  Lab:     ${loaded.path}\n\n`);

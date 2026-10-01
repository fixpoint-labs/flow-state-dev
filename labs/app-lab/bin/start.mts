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
 *   --devtool <url>   use a devtool running elsewhere for a task's trace link,
 *                     instead of the one this process serves (below)
 *   --devtool-assets <dir>
 *                     serve a different build of the devtool's pages
 *                     (default: the shipped `@flow-state-dev/devtool` build)
 *
 * The devtool. A task's trace link opens the run in the devtool, which can only
 * show it if it reads the store the run is in. A devtool in another process
 * over an in-memory Lab never does, so by default this process serves the
 * shipped devtool too: the same pages and the same `serve()` call `fsdev dev`
 * makes, over this same `FlowState`, on a port of its own (the devtool's
 * build loads its files from `/`, so it cannot share App Lab's origin). With
 * the devtool's pages not built, App Lab still starts, says so, and leaves the
 * link off. `--devtool <url>` replaces it with a devtool you run yourself.
 *
 * Either way the address reaches the page the same way: App Lab's pages are
 * copied to a temp directory with it written into index.html, once the Lab has
 * loaded, and the copy is removed when the process stops. The build itself is
 * untouched.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getAssetPath } from "@flow-state-dev/devtool";
import { declaredDevtoolConfig, loadFsdevConfig } from "@flow-state-dev/fsdev";
import { assertNetworkBindIsAuthenticated, isLoopbackHost, serve, type ServeHandle } from "@flow-state-dev/node";

/** App Lab's own build output. */
const DEFAULT_ASSETS = fileURLToPath(new URL("../dist", import.meta.url));

/** Exit code for a config or argument problem; matches the CLI's. */
const EXIT_CONFIG_ERROR = 3;

/** The copy of the pages `--devtool` writes its address into; removed whenever the process ends. */
let scratch: string | undefined;
function removeScratch(): void {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
}

function fail(message: string, code = EXIT_CONFIG_ERROR): never {
  removeScratch();
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    config: { type: "string" },
    port: { type: "string", default: "4300" },
    host: { type: "string", default: "127.0.0.1" },
    assets: { type: "string" },
    devtool: { type: "string" },
    "devtool-assets": { type: "string" },
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

const built = values.assets === undefined ? DEFAULT_ASSETS : from(values.assets);
if (!existsSync(resolve(built, "index.html"))) {
  fail(`App Lab's pages are not built at ${built}. Run: pnpm --filter @flow-state-dev/app-lab build`);
}

/** The meta tag the page reads the devtool address from (`readDevtoolUrl`). */
const DEVTOOL_META = "app-lab-devtool";

/** The `--devtool` address, checked before anything loads. */
function devtoolAddress(devtool: string): URL {
  let url: URL;
  try {
    url = new URL(devtool);
  } catch {
    return fail(`Invalid --devtool address: ${devtool}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail(`--devtool must be an http(s) address: ${devtool}`);
  return url;
}

/**
 * The pages with the devtool address written in: a copy in a temp directory,
 * made only once the Lab is ready to be served, and removed on shutdown or on
 * any failure after it.
 */
function pagesWithDevtool(url: URL): string {
  scratch = mkdtempSync(join(tmpdir(), "app-lab-pages-"));
  cpSync(built, scratch, { recursive: true });
  const index = join(scratch, "index.html");
  const attr = url.href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = readFileSync(index, "utf8");
  const tag = `<meta name="${DEVTOOL_META}" content="${attr}">`;
  writeFileSync(index, /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${html}`);
  return scratch;
}

/**
 * The devtool pages this process serves: `--devtool-assets`, or the shipped
 * build `fsdev dev` serves (`getAssetPath()`). `undefined` when that build is
 * missing, which turns the trace link off rather than stopping App Lab.
 */
function devtoolPages(): string | undefined {
  if (values["devtool-assets"] !== undefined) {
    const dir = from(values["devtool-assets"]);
    if (!existsSync(resolve(dir, "index.html"))) fail(`No devtool pages at ${dir}.`);
    return dir;
  }
  try {
    return getAssetPath();
  } catch (error) {
    process.stderr.write(
      `App Lab is serving no devtool, so Open trace is off: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return undefined;
  }
}

let devtoolUrl = values.devtool === undefined ? undefined : devtoolAddress(values.devtool);

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

// The devtool this process serves, unless `--devtool` names another. Started
// first, because its address goes into App Lab's pages.
let devtoolHandle: ServeHandle | undefined;
const ownDevtool = devtoolUrl === undefined ? devtoolPages() : undefined;
if (ownDevtool !== undefined) {
  devtoolHandle = await serve(flowState, {
    host,
    port: 0,
    basePath: "/api/flows",
    staticDir: ownDevtool,
    devtoolConfig,
    handleSignals: false,
  }).catch(async (error: unknown) => {
    await flowState.dispose().catch(() => {});
    return fail(`App Lab could not serve the devtool on ${host}: ${error instanceof Error ? error.message : String(error)}`);
  });
  devtoolUrl = new URL(`http://${host.includes(":") ? `[${host}]` : host}:${devtoolHandle.port}/`);
}

const assets = devtoolUrl === undefined ? built : pagesWithDevtool(devtoolUrl);

const handle = await serve(flowState, {
  host,
  port,
  basePath: "/api/flows",
  staticDir: assets,
  devtoolConfig,
  handleSignals: false,
}).catch(async (error: unknown) => {
  await devtoolHandle?.close().catch(() => {});
  await flowState.dispose().catch(() => {});
  return fail(`App Lab could not listen on ${host}:${port}: ${error instanceof Error ? error.message : String(error)}`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await devtoolHandle?.close();
  await handle.close();
  removeScratch();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

try {
  await flowState.ready();
} catch (error) {
  await devtoolHandle?.close().catch(() => {});
  await handle.close().catch(() => {});
  fail(`The Lab failed to start: ${error instanceof Error ? error.message : String(error)}`);
}

process.stderr.write(
  `\n  App Lab: http://${host}:${handle.port}\n` +
    (devtoolHandle === undefined ? "" : `  Devtool: ${devtoolUrl!.href}\n`) +
    `  Lab:     ${loaded.path}\n\n`,
);

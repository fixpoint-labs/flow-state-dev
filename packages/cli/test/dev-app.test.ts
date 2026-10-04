/**
 * `fsdev dev --app` and `--host`: an app's pages at the root of the port, the
 * DevTool on a port of its own beside them, and the guards on a network bind.
 *
 * Each case starts real servers over a fixture config and reads them over HTTP.
 * The DevTool's pages are a temp directory standing in for the
 * `@flow-state-dev/devtool` build, or missing, per case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { executeDevCommand, type DevServer } from "../src/commands/dev";
import { CliError } from "../src/resolve-block";
import { EXIT_CONFIG_ERROR } from "../src/exit-codes";

const devtool = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock("@flow-state-dev/devtool", () => ({
  getAssetPath: () => {
    if (devtool.dir === undefined) throw new Error("pre-built assets not found");
    return devtool.dir;
  },
}));

const fixtures = resolve(import.meta.dirname, "fixtures-config");
const appConfig = join(fixtures, "app", "fsdev.config.ts");
const bearerConfig = join(fixtures, "devtool-bearer", "fsdev.config.ts");
const unauthConfig = join(fixtures, "serve-unauth", "fsdev.config.ts");

const PAGE = "<!doctype html><html><head><title>ops</title></head><body>ops console</body></html>";

/** A directory holding `index.html` (unless `index` is false). */
async function pagesDir(index = true, html = PAGE): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fsdev-app-pages-"));
  if (index) await writeFile(join(dir, "index.html"), html);
  return dir;
}

/** A project directory with `@acme/ops-console` installed, exporting `getAssetPath()` as `body`. */
async function projectWithAppPackage(body: string): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), "fsdev-app-project-"));
  const pkg = join(project, "node_modules", "@acme", "ops-console");
  await mkdir(join(pkg, "dist"), { recursive: true });
  await writeFile(join(pkg, "dist", "index.html"), PAGE);
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@acme/ops-console", type: "module", exports: { ".": { default: "./index.js" } } }),
  );
  await writeFile(join(pkg, "index.js"), body);
  return project;
}

const running: DevServer[] = [];
let stderr: string;
const env = ["FSDEV_DEBUG_ENDPOINTS", "FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL", "FSDEV_TRACING_LEVEL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  devtool.dir = await pagesDir(true, "<!doctype html><html><head></head><body>devtool</body></html>");
  savedEnv = Object.fromEntries(env.map((k) => [k, process.env[k]]));
  for (const k of env) delete process.env[k];
  stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(async () => {
  while (running.length > 0) await running.pop()!.close();
  vi.restoreAllMocks();
  for (const k of env) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function dev(options: Parameters<typeof executeDevCommand>[0]): Promise<DevServer> {
  const server = await executeDevCommand({ port: "0", open: false, ...options });
  running.push(server);
  return server;
}

async function refused(options: Parameters<typeof executeDevCommand>[0]): Promise<CliError> {
  const err = await executeDevCommand({ port: "0", open: false, ...options }).then(
    (server) => {
      running.push(server);
      return undefined;
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CliError);
  return err as CliError;
}

const text = async (url: string) => (await fetch(url)).text();

describe("fsdev dev --app <dir>", () => {
  it("serves the app at the root and the API beside it, with the DevTool on its own port", async () => {
    const pages = await pagesDir();
    const server = await dev({ config: appConfig, app: pages });

    expect(await text(server.url)).toContain("ops console");
    expect(await text(`${server.url}some/client/route`)).toContain("ops console");
    const flows = await fetch(`${server.url}api/flows`);
    expect(flows.status).toBe(200);

    expect(server.devtoolUrl).toBeDefined();
    expect(new URL(server.devtoolUrl!).port).not.toBe(new URL(server.url).port);
    expect(await text(server.devtoolUrl!)).toContain("devtool");
    expect((await fetch(`${server.devtoolUrl}api/flows`)).status).toBe(200);
  });

  it("hands every page the DevTool's address as the fsdev-devtool-url meta", async () => {
    const server = await dev({ config: appConfig, app: await pagesDir() });
    const tag = `<meta name="fsdev-devtool-url" content="${server.devtoolUrl}">`;
    expect(await text(server.url)).toContain(tag);
    expect(await text(`${server.url}deep/link`)).toContain(tag);
  });

  it("prints both addresses and the config path", async () => {
    const server = await dev({ config: appConfig, app: await pagesDir() });
    // The default bind prints as localhost, as `fsdev dev` always has.
    expect(stderr).toContain(`App:     http://localhost:${new URL(server.url).port}`);
    expect(stderr).toContain(`DevTool: http://localhost:${new URL(server.devtoolUrl!).port}`);
    expect(stderr).toContain("fixtures-config/app/fsdev.config.ts");
  });

  it("resolves a relative --app from the working directory", async () => {
    const project = await mkdtemp(join(tmpdir(), "fsdev-app-cwd-"));
    await mkdir(join(project, "web"));
    await writeFile(join(project, "web", "index.html"), PAGE);
    const server = await dev({ cwd: project, config: appConfig, app: "./web" });
    expect(await text(server.url)).toContain("ops console");
  });

  it("with --port 0, binds a free port and prints it", async () => {
    const server = await dev({ config: appConfig, app: await pagesDir() });
    const port = Number(new URL(server.url).port);
    expect(port).toBeGreaterThan(0);
    expect(stderr).toContain(`:${port}`);
  });

  it("writes the config's devtool user and bearer into the app's pages on loopback", async () => {
    const server = await dev({ config: bearerConfig, app: await pagesDir() });
    const html = await text(server.url);
    expect(html).toContain('window.__FSD_DEVTOOL_CONFIG__ = {"userId":"owner","bearerToken":"s3cret"}');
    expect(await text(server.devtoolUrl!)).toContain("__FSD_DEVTOOL_CONFIG__");
  });

  it("adds the meta a programmatic caller passes", async () => {
    const server = await dev({ config: appConfig, app: await pagesDir(), pageMeta: { "app-scheme": "dark" } });
    expect(await text(server.url)).toContain('<meta name="app-scheme" content="dark">');
  });

  it("starts without the DevTool's pages, says so, and hands the page no address", async () => {
    devtool.dir = undefined;
    const server = await dev({ config: appConfig, app: await pagesDir() });
    expect(server.devtoolUrl).toBeUndefined();
    const html = await text(server.url);
    expect(html).toContain("ops console");
    expect(html).not.toContain("fsdev-devtool-url");
    expect(stderr).toContain("DevTool not served beside the app");
    expect(stderr).toContain("DevTool assets not found");
  });

  it("refuses a directory with no index.html, exit 3", async () => {
    const err = await refused({ config: appConfig, app: await pagesDir(false) });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("index.html");
  });

  it("refuses a path that doesn't exist, exit 3", async () => {
    const err = await refused({ config: appConfig, app: "./no-such-dir" });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("no-such-dir");
  });

  it("close() stops both servers and removes the signal handlers it added", async () => {
    const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const server = await executeDevCommand({ port: "0", open: false, config: appConfig, app: await pagesDir() });
    expect(process.listenerCount("SIGINT")).toBe(before[0]! + 1);
    await server.close();
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
    await expect(fetch(server.url)).rejects.toThrow();
    await expect(fetch(server.devtoolUrl!)).rejects.toThrow();
  });

  it("close() keeps the shared runtime up until both servers have drained", async () => {
    const server = await executeDevCommand({ port: "0", open: false, config: appConfig, app: await pagesDir() });
    const { port } = new URL(server.url);
    // A request in flight on the app's port: headers sent, not yet finished.
    const socket = connect(Number(port), "127.0.0.1");
    await new Promise<void>((done) => socket.once("connect", () => done()));
    socket.write(`GET /api/flows HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n`);
    let reply = "";
    socket.on("data", (chunk) => (reply += String(chunk)));
    const ended = new Promise<void>((done) => socket.once("close", () => done()));

    const g = globalThis as { __fsdevDisposed?: boolean };
    g.__fsdevDisposed = false;
    const closing = server.close();
    // The DevTool's idle port closes at once; the app's waits on the request,
    // and the runtime both share must outlive it.
    await new Promise((r) => setTimeout(r, 300));
    await expect(fetch(server.devtoolUrl!)).rejects.toThrow();
    expect(g.__fsdevDisposed).toBe(false);
    socket.write("\r\n");
    await ended;
    await closing;
    expect(reply).toMatch(/^HTTP\/1\.1 200/);
    expect(g.__fsdevDisposed).toBe(true);
  });

  it.each(["12abc", "80.5", "70000", "-1"])("refuses --port %s, exit 3", async (port) => {
    const err = await refused({ config: appConfig, app: await pagesDir(), port });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain(`Invalid port: ${port}`);
  });
});

describe("fsdev dev --app <package>", () => {
  it("serves the directory the package's getAssetPath() returns, resolved from the working directory", async () => {
    const project = await projectWithAppPackage(
      `import { fileURLToPath } from "node:url";\nexport function getAssetPath() { return fileURLToPath(new URL("./dist", import.meta.url)); }\n`,
    );
    const server = await dev({ cwd: project, config: appConfig, app: "@acme/ops-console" });
    expect(await text(server.url)).toContain("ops console");
  });

  it("refuses a package that doesn't export getAssetPath()", async () => {
    const project = await projectWithAppPackage(`export const other = 1;\n`);
    const err = await refused({ cwd: project, config: appConfig, app: "@acme/ops-console" });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("getAssetPath");
  });

  it("refuses a package whose getAssetPath() throws, with its message", async () => {
    const project = await projectWithAppPackage(`export function getAssetPath() { throw new Error("pages not built"); }\n`);
    const err = await refused({ cwd: project, config: appConfig, app: "@acme/ops-console" });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("pages not built");
  });

  it("refuses a package that isn't installed", async () => {
    const project = await mkdtemp(join(tmpdir(), "fsdev-app-empty-"));
    const err = await refused({ cwd: project, config: appConfig, app: "@acme/missing" });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("@acme/missing");
  });
});

describe("fsdev dev --host", () => {
  it("refuses a network host for a Lab on the unauthenticated default, with the guard's message", async () => {
    const err = await refused({ config: unauthConfig, host: "0.0.0.0", app: await pagesDir() });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("Refusing to bind 0.0.0.0");
    expect(err.message).toContain("--allow-unauthenticated");
  });

  it("refuses a network host for a config that hands its page a bearer token", async () => {
    const err = await refused({ config: bearerConfig, host: "0.0.0.0", allowUnauthenticated: true, app: await pagesDir() });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("bearer token");
    expect(err.message).toContain("loopback");
  });

  it("refuses a network host without a config", async () => {
    const project = await mkdtemp(join(tmpdir(), "fsdev-app-noconfig-"));
    const err = await refused({ cwd: project, config: false, host: "0.0.0.0" });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("--config");
  });

  it("with --allow-unauthenticated, binds and keeps the anonymous debug surface closed", async () => {
    const server = await dev({ config: unauthConfig, host: "0.0.0.0", allowUnauthenticated: true, app: await pagesDir() });
    const port = new URL(server.url).port;
    expect(process.env.FSDEV_DEBUG_ENDPOINTS).not.toBe("1");
    expect(process.env.FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL).not.toBe("1");
    const debug = await fetch(`http://127.0.0.1:${port}/api/flows/sessions/s1/debug/resources`);
    expect(debug.status).toBe(403);
    expect(await debug.json()).toMatchObject({ error: "debug_endpoints_disabled" });
  });

  it("keeps the debug surface closed on a network host even when the environment turned it on", async () => {
    // A .env file, the shell, or an earlier loopback run in this process can
    // leave these set; a network bind must not inherit them.
    process.env.FSDEV_DEBUG_ENDPOINTS = "1";
    process.env.FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL = "1";
    const server = await dev({ config: unauthConfig, host: "0.0.0.0", allowUnauthenticated: true, app: await pagesDir() });
    const port = new URL(server.url).port;
    const debug = await fetch(`http://127.0.0.1:${port}/api/flows/sessions/s1/debug/resources`);
    expect(debug.status).toBe(403);
    expect(await debug.json()).toMatchObject({ error: "debug_endpoints_disabled" });
  });

  it("on a wildcard host, hands the page no DevTool address, since 0.0.0.0 reaches nothing from a browser", async () => {
    const server = await dev({ config: unauthConfig, host: "0.0.0.0", allowUnauthenticated: true, app: await pagesDir() });
    const port = new URL(server.url).port;
    expect(await text(`http://127.0.0.1:${port}/`)).not.toContain("fsdev-devtool-url");
    expect(server.devtoolUrl).toBeDefined();
    expect(stderr).toContain(`DevTool: ${server.devtoolUrl!.replace(/\/$/, "")}`);
  });

  it("on loopback, the anonymous debug surface stays open as today", async () => {
    const server = await dev({ config: unauthConfig, app: await pagesDir() });
    const debug = await fetch(`${server.url}api/flows/sessions/s1/debug/resources`);
    expect(await debug.text()).not.toContain("debug_endpoints_disabled");
  });
});

/** A real Vite install, for an app whose own install has one. */
const viteInstall = resolve(import.meta.dirname, "..", "..", "..", "apps", "devtool", "node_modules", "vite");

/**
 * A project with `@acme/ops-console` installed: built pages in `dist`, source in
 * `web`, and `getSourceRoot()` as `sourceRoot` returns it. With `vite`, the
 * package's own install has Vite.
 */
async function projectWithSourceApp(options: { vite: boolean; sourceRoot?: string }): Promise<string> {
  const project = await projectWithAppPackage(
    `import { fileURLToPath } from "node:url";\n` +
      `export function getAssetPath() { return fileURLToPath(new URL("./dist", import.meta.url)); }\n` +
      `export function getSourceRoot() { return ${options.sourceRoot ?? `fileURLToPath(new URL("./web", import.meta.url))`}; }\n`,
  );
  const pkg = join(project, "node_modules", "@acme", "ops-console");
  await mkdir(join(pkg, "web"));
  await writeFile(
    join(pkg, "web", "index.html"),
    '<!doctype html><html><head><title>src</title></head><body>from source<script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(join(pkg, "web", "main.js"), "document.body.dataset.ready = 'yes';\n");
  if (options.vite) {
    await mkdir(join(pkg, "node_modules"));
    await symlink(await realpath(viteInstall), join(pkg, "node_modules", "vite"), "dir");
  }
  return project;
}

describe("fsdev dev --watch --app <package with source>", () => {
  // These run as the child a --watch parent starts, which is where pages are served.
  beforeEach(() => {
    process.env.FSDEV_DEV_WATCH_CHILD = JSON.stringify({ port: 0 });
  });
  afterEach(() => {
    delete process.env.FSDEV_DEV_WATCH_CHILD;
  });

  it("serves the source through the app's Vite, its index carrying Vite's client and the page config", async () => {
    const project = await projectWithSourceApp({ vite: true });
    const server = await dev({ cwd: project, config: bearerConfig, app: "@acme/ops-console", watch: true });

    const html = await text(server.url);
    expect(html).toContain("from source");
    expect(html).toContain("/@vite/client");
    expect(html).toContain(`<meta name="fsdev-devtool-url" content="${server.devtoolUrl}">`);
    expect(html).toContain('window.__FSD_DEVTOOL_CONFIG__ = {"userId":"owner","bearerToken":"s3cret"}');
    expect(html).toMatch(/<meta name="fsdev-dev-boot" content="[^"]+">/);
    // A client route gets the same index; a module comes through Vite; the API stays beside it.
    expect(await text(`${server.url}some/client/route`)).toContain("/@vite/client");
    const mod = await fetch(`${server.url}main.js`);
    expect(mod.headers.get("content-type")).toContain("javascript");
    expect(await mod.text()).toContain("dataset.ready");
    expect((await fetch(`${server.url}api/flows`)).status).toBe(200);
    expect(stderr).toContain("through Vite");
    // Vite's live-update socket shares the port: one origin, no second server.
    const socket = new WebSocket(server.url.replace("http", "ws"), "vite-hmr");
    const opened = await new Promise<string>((r) => {
      socket.onopen = () => r("open");
      socket.onerror = () => r("error");
    });
    socket.close();
    expect(opened).toBe("open");
  });

  it("says so and serves the built pages when Vite doesn't resolve from the source", async () => {
    const project = await projectWithSourceApp({ vite: false });
    const server = await dev({ cwd: project, config: appConfig, app: "@acme/ops-console", watch: true });
    const html = await text(server.url);
    expect(html).toContain("ops console");
    expect(html).not.toContain("/@vite/client");
    expect(stderr).toContain("Vite doesn't resolve from");
  });

  it("serves the built pages when getSourceRoot() returns nothing", async () => {
    const project = await projectWithSourceApp({ vite: true, sourceRoot: "undefined" });
    const server = await dev({ cwd: project, config: appConfig, app: "@acme/ops-console", watch: true });
    expect(await text(server.url)).toContain("ops console");
  });

  it("serves the built pages without --watch, source or not", async () => {
    delete process.env.FSDEV_DEV_WATCH_CHILD;
    const project = await projectWithSourceApp({ vite: true });
    const server = await dev({ cwd: project, config: appConfig, app: "@acme/ops-console" });
    const html = await text(server.url);
    expect(html).toContain("ops console");
    expect(html).not.toContain("fsdev-dev-boot");
  });
});

describe("fsdev dev --watch, refusals", () => {
  it("refuses a non-loopback host, exit 3", async () => {
    const err = await refused({ config: unauthConfig, host: "0.0.0.0", allowUnauthenticated: true, watch: true });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("--watch");
    expect(err.message).toContain("loopback");
  });

  it("refuses bad input before it starts a child: an --app directory with no index.html", async () => {
    const err = await refused({ config: appConfig, app: await pagesDir(false), watch: true });
    expect(err.exitCode).toBe(EXIT_CONFIG_ERROR);
    expect(err.message).toContain("index.html");
  });
});

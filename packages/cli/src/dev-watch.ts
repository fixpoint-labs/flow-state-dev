/**
 * `fsdev dev --watch`: restart the dev server when the Lab changes, and reload
 * the pages open on it.
 *
 * The command runs as a parent that re-runs its own entry, with the same
 * arguments, as a child under `node --watch`, the one watch authority. The
 * parent fixes the ports once (so `--port 0` keeps one address across
 * restarts), hands them to every child, opens the browser when the first child
 * is up, and keeps running when a child fails: `node --watch` waits for the
 * next save.
 *
 * A Lab change is a module the Lab loaded, or a file under its config's
 * directory, which a child reports to `node --watch` itself. Never a module
 * under `node_modules` (see `dev-watch-preload.ts`), the app's pages, or a
 * data file.
 *
 * Each child stamps its pages with a boot id meta and serves a stream that
 * sends that id. The page script compares the two and reloads when a new child
 * answers its reconnecting stream, so built pages reload too.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { createServer } from "node:net";
import type { ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PageHandler } from "@flow-state-dev/node";

/** The environment variable a parent hands its children their ports in. */
const CHILD_ENV = "FSDEV_DEV_WATCH_CHILD";

/** The meta tag carrying the boot id of the server that rendered the page. */
const DEV_BOOT_META = "fsdev-dev-boot";

/** The path of the stream that sends the running server's boot id. */
const DEV_RELOAD_PATH = "/__fsdev/dev-reload";

/** The ports a parent fixed for its children. */
export interface WatchChild {
  readonly port: number;
  /** The DevTool's port beside an app; absent when it isn't served. */
  readonly devtoolPort?: number;
}

/**
 * The ports this process was handed as a `--watch` child, or `undefined` when
 * it is not one. Removed from the environment once read, so nothing the Lab
 * starts inherits it; `node --watch` hands it to every restart.
 */
export function takeWatchChild(): WatchChild | undefined {
  const raw = process.env[CHILD_ENV];
  if (raw === undefined) return undefined;
  delete process.env[CHILD_ENV];
  return JSON.parse(raw) as WatchChild;
}

/** Options for {@link superviseDev}. */
export interface SuperviseOptions {
  host: string;
  /** The port asked for; `0` picks one, once. */
  port: number;
  /** Fix a port for the DevTool beside an app too. */
  devtool: boolean;
  /** Called with the pages' address once, when the first child is up. */
  onFirstReady(url: string): void;
}

/** The supervising parent, as `executeDevCommand` returns it. */
export interface Supervisor {
  readonly url: string;
  readonly devtoolUrl: string | undefined;
  close(): Promise<void>;
}

/**
 * Fix the ports, then run this process's entry again under `node --watch`
 * with them. Resolves once the watcher is started; a port that can't be bound
 * rejects first.
 */
export async function superviseDev(options: SuperviseOptions): Promise<Supervisor> {
  const port = await reservePort(options.host, options.port);
  const devtoolPort = options.devtool ? await reservePort(options.host, 0) : undefined;
  const child: WatchChild = { port, ...(devtoolPort === undefined ? {} : { devtoolPort }) };
  const preload = new URL(`./dev-watch-preload${extname(fileURLToPath(import.meta.url))}`, import.meta.url);

  const watcher: ChildProcess = spawn(
    process.execPath,
    [
      ...process.execArgv,
      "--watch",
      "--watch-preserve-output",
      "--import",
      preload.href,
      process.argv[1]!,
      ...process.argv.slice(2),
    ],
    { stdio: ["inherit", "inherit", "inherit", "ipc"], env: { ...process.env, [CHILD_ENV]: JSON.stringify(child) } },
  );
  const host = options.host.includes(":") ? `[${options.host}]` : options.host;
  const url = `http://${host}:${port}/`;
  let ready = false;
  watcher.on("message", (message) => {
    if (!ready && typeof message === "object" && message !== null && "fsdevDevReady" in message) {
      ready = true;
      options.onFirstReady(url);
    }
  });
  const exited = new Promise<void>((resolve) => watcher.once("exit", () => resolve()));

  return {
    url,
    devtoolUrl: devtoolPort === undefined ? undefined : `http://${host}:${devtoolPort}/`,
    async close() {
      if (watcher.exitCode === null && watcher.signalCode === null) watcher.kill("SIGTERM");
      await exited;
    },
  };
}

/** Bind `port` on `host` and release it, to fix a free port for `0` and fail early on a taken one. */
function reservePort(host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen({ host, port, exclusive: true }, () => {
      const bound = (probe.address() as { port: number }).port;
      probe.close(() => resolve(bound));
    });
  });
}

/**
 * Report files to `node --watch` so a save restarts this child: every file
 * under `dir`, skipping dot entries, `node_modules`, data files and the `skip`
 * paths (the app's pages). A no-op outside a `node --watch` child.
 */
export function reportLabFiles(dir: string, skip: readonly string[]): void {
  if (process.send === undefined || process.env.WATCH_REPORT_DEPENDENCIES === undefined) return;
  const files: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(at, entry.name);
      if (skip.some((s) => path === s || path.startsWith(s + sep))) continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && !DATA_FILE.test(entry.name)) files.push(path);
    }
  };
  walk(dir);
  if (files.length > 0) process.send({ "watch:require": files });
}

/** A database file and its journals: the Lab writes these, so they never restart it. */
const DATA_FILE = /\.(sqlite3?|db)(-wal|-shm|-journal)?$/i;

/** Tell the supervising parent this child is serving. A no-op outside a `--watch` child. */
export function announceReady(): void {
  if (process.env.WATCH_REPORT_DEPENDENCIES === undefined) return;
  process.send?.({ fsdevDevReady: true });
}

/** One server's half of the reload signal. */
export interface ReloadSignal {
  /** The boot id meta, for `serve()`'s `pageMeta`. */
  readonly pageMeta: Record<string, string>;
  /** The page script, for `serve()`'s `pageScript`. */
  readonly pageScript: string;
  /** Serves {@link DEV_RELOAD_PATH}; passes every other request on. */
  readonly handler: PageHandler;
  /** End the open streams, so the server drains at once and the pages reconnect. */
  close(): void;
}

/**
 * The page script: open the stream, and reload when the server answering it
 * has another boot id than the one that rendered the page. On an error (the
 * server went down), it closes the stream and opens a new one shortly, rather
 * than rely on the browser's own retry, which may give up while no server
 * listens.
 */
const RELOAD_SCRIPT =
  `(function(){var m=document.querySelector('meta[name="${DEV_BOOT_META}"]');` +
  `if(!m||typeof EventSource==="undefined")return;var b=m.getAttribute("content");` +
  `function c(){var s=new EventSource("${DEV_RELOAD_PATH}");` +
  `s.addEventListener("boot",function(e){if(e.data!==b){s.close();location.reload();}});` +
  `s.onerror=function(){s.close();setTimeout(c,250);};}c();})();`;

/** A reload signal with a fresh boot id, for a server this child starts. */
export function createReloadSignal(bootId: string = randomUUID()): ReloadSignal {
  const streams = new Set<ServerResponse>();
  const handler: PageHandler = (req, res, next) => {
    if (req.url?.split("?")[0] !== DEV_RELOAD_PATH) return next();
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(`event: boot\ndata: ${bootId}\n\n`);
    streams.add(res);
    res.on("close", () => streams.delete(res));
  };
  return {
    pageMeta: { [DEV_BOOT_META]: bootId },
    pageScript: RELOAD_SCRIPT,
    handler,
    close() {
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}

/** `first`, then `second` for what `first` passes on. */
export function chainPageHandlers(first: PageHandler, second: PageHandler | undefined): PageHandler {
  if (second === undefined) return first;
  return (req, res, next) =>
    first(req, res, (err) => (err === undefined || err === null ? second(req, res, next) : next(err)));
}

/**
 * Serve an app's pages from source through Vite, in middleware mode, inside the
 * `fsdev dev --watch` process: one origin for the pages and `/api/flows`, no
 * proxy.
 *
 * Vite is imported from the app's own install (see `resolveViteEntry` in
 * `dev-app.ts`), never from fsdev's dependencies. Vite answers what it knows
 * (modules, its client, the app's public files); every other page request gets
 * the app's `index.html`, transformed by Vite and then by the same page
 * transform `serve()` applies to built pages, so both carry the same meta and
 * config.
 */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PageHandler } from "@flow-state-dev/node";

/** The part of Vite's dev server this module uses. */
interface ViteDevServer {
  middlewares: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;
  transformIndexHtml(url: string, html: string): Promise<string>;
  close(): Promise<void>;
}

/** Vite pages for one app, ready once {@link VitePages.attach} has run. */
export interface VitePages {
  /** The page handler to give `serve()`. Requests wait until Vite is up. */
  readonly handler: PageHandler;
  /** Start Vite on `server` (its HMR socket shares the port). Rejects when Vite fails to start. */
  attach(server: Server): Promise<void>;
  /** Stop Vite. Safe before {@link VitePages.attach} and more than once. */
  close(): Promise<void>;
}

/**
 * Pages for the app whose source is at `root`, through the Vite module at
 * `viteEntry`. `htmlTransform` is `createPageHtmlTransform` built with the same
 * options passed to `serve()`.
 */
export function createVitePages(options: {
  root: string;
  viteEntry: string;
  htmlTransform: ((html: string) => string) | undefined;
}): VitePages {
  const { root, viteEntry, htmlTransform } = options;
  let resolveVite!: (vite: ViteDevServer) => void;
  let rejectVite!: (err: unknown) => void;
  const ready = new Promise<ViteDevServer>((res, rej) => {
    resolveVite = res;
    rejectVite = rej;
  });
  // A Vite that never starts rejects every waiting request with its error.
  ready.catch(() => {});
  let started: ViteDevServer | undefined;
  let closed = false;

  const serveIndex = async (vite: ViteDevServer, req: IncomingMessage, res: ServerResponse) => {
    const source = await readFile(join(root, "index.html"), "utf8");
    const html = await vite.transformIndexHtml(req.url ?? "/", source);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(htmlTransform === undefined ? html : htmlTransform(html));
  };

  const handler: PageHandler = (req, res, next) => {
    ready.then(
      (vite) =>
        vite.middlewares(req, res, (err?: unknown) => {
          if (err !== undefined && err !== null) return next(err);
          serveIndex(vite, req, res).catch(next);
        }),
      next,
    );
  };

  return {
    handler,
    async attach(server) {
      try {
        const { createServer } = (await import(pathToFileURL(viteEntry).href)) as {
          createServer(config: Record<string, unknown>): Promise<ViteDevServer>;
        };
        started = await createServer({
          root,
          appType: "custom",
          clearScreen: false,
          server: { middlewareMode: true, hmr: { server } },
        });
        if (closed) await started.close();
        resolveVite(started);
      } catch (err) {
        rejectVite(err);
        throw err;
      }
    },
    async close() {
      closed = true;
      await started?.close();
    },
  };
}

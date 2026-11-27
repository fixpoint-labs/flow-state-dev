/**
 * What Next's server does for the fixture app's route (FIX-2368, journey j4),
 * in one forked process: `/api/flows/*` goes to the route file's handlers
 * (`app/next-route.ts`) with Next 15's promised `params`, everything else to
 * the built page in `STATIC_DIR`. No socket upgrade is served, as on a
 * serverless Next host. Harness, not app: the app is `app/`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { servePeer } from "../../lib/peers.mts";
import { app } from "./app/flowstate.ts";
import * as route from "./app/next-route.ts";

const STATIC_DIR = process.env.STATIC_DIR ?? "";
const BASE = "/api/flows/";
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };

async function toRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  const body = chunks.length === 0 || req.method === "GET" ? undefined : Buffer.concat(chunks);
  return new Request(url, { method: req.method, headers, body });
}

async function answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname.startsWith(BASE)) {
    const handler = route[req.method as "GET" | "POST" | "PATCH" | "DELETE"];
    if (handler === undefined) return void res.writeHead(405).end();
    const path = url.pathname.slice(BASE.length).split("/").filter(Boolean).map(decodeURIComponent);
    const response = await handler(await toRequest(req, url), { params: Promise.resolve({ path }) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body === null) return void res.end();
    const body = Readable.fromWeb(response.body as never);
    req.on("close", () => body.destroy());
    body.pipe(res);
    return;
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  try {
    const bytes = await readFile(join(STATIC_DIR, file));
    res.writeHead(200, { "content-type": TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream" }).end(bytes);
  } catch {
    res.writeHead(200, { "content-type": "text/html" }).end(await readFile(join(STATIC_DIR, "index.html")));
  }
}

const server = createServer((req, res) => {
  answer(req, res).catch((error: unknown) => {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(error));
  });
});
await new Promise<void>((resolve) => server.listen(Number(process.env.PORT), "127.0.0.1", resolve));
const address = server.address();

servePeer({
  port: () => (typeof address === "object" && address !== null ? address.port : 0),
  stop: async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.dispose();
  }
});

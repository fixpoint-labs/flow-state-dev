/**
 * Local preview for the flow-state.build landing page: serves `public/` on
 * http://localhost:3002 with no dependencies. Production hosting serves the
 * same folder as static files.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const PORT = Number(process.env.PORT ?? 3002);

createServer(async (req, res) => {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname)).replace(/^([/\\])+/, "");
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const file = join(ROOT, path === "" ? "index.html" : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(PORT, () => console.log(`flow-state.build preview on http://localhost:${PORT}`));

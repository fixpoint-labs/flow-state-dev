/**
 * The super app's front door: one HTTP listener that serves a landing page at
 * `/` and forwards each app's sub-route to the app's loopback port.
 *
 * - Responses stream through untouched (SSE included), except an `spa` app's
 *   HTML, which is buffered to rewrite its `<base href="/">` to the app's prefix.
 * - WebSocket upgrades (Next's dev HMR) are piped through raw.
 * - An app's redirect to a root path, or to its own loopback address, is put
 *   back under its prefix on this server.
 * - A request target that isn't an origin-form path (`/…`) gets 400, before
 *   anything parses it.
 * - With `auth` (`auth.mjs`), nothing but the login routes gets through
 *   without a signed session cookie: pages, API calls, streams and upgrades
 *   alike. The cookie never reaches an app.
 * - Without `auth` (loopback `dev` only), a request must be addressed to a
 *   loopback name: a page on another site that rebinds its own domain to
 *   127.0.0.1 is refused, so it can't drive the apps from the user's browser.
 */
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { escapeHtml, PAGE_STYLE } from "./page.mjs";

/**
 * @param {object} options
 * @param {import("./apps.mjs").HostedApp[]} options.apps
 * @param {ReturnType<import("./auth.mjs").createAuth>} [options.auth]  Unset, no sign-in is asked for.
 * @param {(id: string) => string} options.status  A word for an app's state on the landing page.
 */
export function createProxy({ apps, auth, status }) {
  /** Whether a request target is a path this server can parse; anything else is refused before it is read. */
  const validTarget = (target) => {
    if (typeof target !== "string" || !target.startsWith("/")) return false;
    try {
      new URL(target, "http://local");
      return true;
    } catch {
      return false;
    }
  };

  /** The app a path belongs to, and the path its server is asked for. */
  const route = (url) => {
    const path = url.split("?")[0];
    const app = apps.find((a) => path === a.prefix || path.startsWith(`${a.prefix}/`));
    if (app === undefined) return undefined;
    if (app.kind === "next") return { app, upstreamPath: url };
    const rest = url.slice(app.prefix.length);
    return { app, upstreamPath: rest.startsWith("/") ? rest : `/${rest}` };
  };

  const server = createServer((req, res) => {
    if (!validTarget(req.url)) {
      res.writeHead(400, { "content-type": "text/plain", connection: "close" });
      res.end("Bad request target.\n");
      return;
    }
    if (auth === undefined && !loopbackHost(req.headers.host)) {
      res.writeHead(421, { "content-type": "text/plain" });
      res.end("Without a sign-in configured, this server only answers on localhost.\n");
      return;
    }
    if (auth?.handle(req, res)) return;
    const url = req.url ?? "/";
    if (url === "/" || url.startsWith("/?")) return landing(res, apps, status, auth !== undefined);

    const target = route(url);
    if (target === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`Nothing is served at ${url.split("?")[0]}. The apps are listed at /.\n`);
      return;
    }
    const { app, upstreamPath } = target;
    // An SPA's pages resolve against `<prefix>/`: the bare prefix would read them against `/`.
    if (app.kind === "spa" && url.split("?")[0] === app.prefix) {
      res.writeHead(308, { location: `${app.prefix}/${url.slice(app.prefix.length)}` });
      res.end();
      return;
    }

    const headers = forwardedHeaders(req, auth);
    // An SPA's HTML is rewritten as text, and a response's type isn't known until it arrives, so no SPA
    // request asks for compression. The hop it saves is loopback; the browser hop was never compressed here.
    if (app.kind === "spa") delete headers["accept-encoding"];

    const upstream = httpRequest(
      { host: "127.0.0.1", port: app.port, method: req.method, path: upstreamPath, headers },
      (up) => {
        // An app that dies or resets mid-response must end the browser's response too: a live
        // stream's client only reconnects once its read fails, so a response left open freezes it.
        up.on("close", () => {
          if (up.complete) return;
          // A page still being buffered for its rewrite has sent nothing yet: say why, rather than reset.
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "text/plain" });
            res.end(`${app.title} stopped before it finished answering. Its log lines are prefixed [${app.id}].\n`);
            return;
          }
          res.destroy();
        });
        const out = withoutHopHeaders(up.headers);
        if (typeof out.location === "string") out.location = publicLocation(out.location, app);
        const html = app.kind === "spa" && String(out["content-type"] ?? "").includes("text/html");
        if (!html) {
          res.writeHead(up.statusCode ?? 502, out);
          up.pipe(res);
          return;
        }
        const chunks = [];
        up.on("data", (c) => chunks.push(c));
        up.on("end", () => {
          const body = Buffer.from(
            Buffer.concat(chunks).toString("utf8").replace(/<base href="\/"\s*\/?>/i, `<base href="${app.prefix}/">`),
          );
          delete out["content-length"];
          delete out["transfer-encoding"];
          res.writeHead(up.statusCode ?? 200, { ...out, "content-length": body.length });
          res.end(body);
        });
      },
    );
    upstream.on("error", () => {
      if (res.headersSent) return void res.destroy();
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`${app.title} isn't answering on port ${app.port}: it may still be starting, or it stopped. Its log lines are prefixed [${app.id}].\n`);
    });
    // A closed tab ends the upstream request, so a live stream doesn't outlive its reader.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket, head) => {
    if (!validTarget(req.url)) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const allowed = auth === undefined ? loopbackHost(req.headers.host) : auth.signedIn(req);
    const target = allowed ? route(req.url ?? "/") : undefined;
    if (target === undefined) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const up = connect(target.app.port, "127.0.0.1", () => {
      const lines = [`${req.method} ${target.upstreamPath} HTTP/${req.httpVersion}`];
      // An upgrade keeps its `connection` and `upgrade` headers: they are what it asks for.
      for (const [name, value] of Object.entries(forwardedHeaders(req, auth, { upgrade: true }))) {
        for (const v of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${v}`);
      }
      up.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) up.write(head);
      up.pipe(socket).pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });

  // Live streams stay open for as long as a page reads them.
  server.requestTimeout = 0;
  return server;
}

/** Whether a `Host` header names this machine's loopback: `localhost`, `127.0.0.1` or `[::1]`, any port. */
export function loopbackHost(host) {
  const name = String(host ?? "").toLowerCase().replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

/** Headers that describe one connection, not the message (RFC 9110 §7.6.1): never passed on to the next hop. */
const HOP_HEADERS = ["connection", "keep-alive", "proxy-connection", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

/** `headers` without the hop-by-hop ones, including any a `Connection` header names. */
function withoutHopHeaders(headers, keep = []) {
  const named = String(headers.connection ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const drop = new Set([...HOP_HEADERS, ...named].filter((h) => !keep.includes(h)));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !drop.has(name)));
}

/**
 * A redirect's `Location` as the browser must follow it on this server: a root
 * path, or an absolute URL on the app's own loopback port, under the app's
 * prefix. Any other absolute URL is left alone. A Next app already writes its
 * `basePath`, so only its loopback origin is removed.
 */
export function publicLocation(location, app) {
  let path = location;
  const own = location.match(/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)(\/.*)?$/i);
  if (own !== null) {
    if (Number(own[1]) !== app.port) return location;
    path = own[2] ?? "/";
  } else if (!location.startsWith("/") || location.startsWith("//")) {
    return location;
  }
  if (app.kind === "next") return path;
  return path === app.prefix || path.startsWith(`${app.prefix}/`) ? path : `${app.prefix}${path}`;
}

/**
 * The request's headers for the app's server: the session cookie and hop-by-hop
 * headers out, where it was really addressed in. `x-forwarded-host` is always
 * this request's `Host`, never a value the client sent.
 */
function forwardedHeaders(req, auth, { upgrade = false } = {}) {
  const base = auth === undefined ? { ...req.headers } : auth.strip(req.headers);
  const headers = withoutHopHeaders(base, upgrade ? ["connection", "upgrade"] : []);
  const prior = headers["x-forwarded-for"];
  const ip = req.socket.remoteAddress ?? "";
  headers["x-forwarded-for"] = prior ? `${prior}, ${ip}` : ip;
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] ??= "http";
  return headers;
}

function landing(res, apps, status, signOut) {
  const cards = apps
    .map((a) => {
      const state = status(a.id);
      return `<a class="card" href="${a.prefix}/"><span class="state ${state}">${state}</span><h2>${escapeHtml(a.title)}</h2><p>${escapeHtml(a.blurb)}</p><code>${a.prefix}/</code></a>`;
    })
    .join("");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>flow-state-dev apps</title><style>${PAGE_STYLE}
header{display:flex;justify-content:space-between;align-items:start;gap:12px}
.out button{font:inherit;font-size:13px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--muted);cursor:pointer}
main{max-width:880px;margin:0 auto;padding:48px 16px}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{display:block;padding:18px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:inherit;text-decoration:none}
.card:hover{border-color:var(--muted)}.card h2{font-size:16px;margin:8px 0 4px}.card p{margin:0 0 10px;color:var(--muted)}
code{font-size:12px;color:var(--muted)}.state{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.state.running{color:#16a34a}.state.stopped{color:#dc2626}
</style></head><body><main><header><div><h1>flow-state-dev</h1><p class="sub">Every app on this server, one route each.</p></div>${signOut ? '<form class="out" method="post" action="/logout"><button type="submit">Sign out</button></form>' : ""}</header><div class="grid">${cards}</div></main></body></html>`);
}

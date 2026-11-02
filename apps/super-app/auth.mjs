/**
 * The super app's sign-in: one user name and password from the environment, a
 * login page, and a signed session cookie every other request must carry.
 *
 * - `GET /login` is the page; `POST /login` checks the form and, on a match,
 *   sets the cookie and sends the browser on to the address it first asked for.
 *   `POST /logout` clears it. Those are the only routes open without the cookie.
 * - The cookie is `<expiry>.<HMAC-SHA256(secret, user + expiry)>`: stateless, so
 *   nothing is stored, and it can't be forged or extended without the secret.
 *   The secret is `SUPER_APP_SECRET`, or random per process (a restart signs
 *   everyone out).
 * - It is `HttpOnly` and `SameSite=Lax`, and `Secure` when the request came in
 *   over HTTPS (`x-forwarded-proto`, set by a TLS terminator in front) or
 *   `SUPER_APP_SECURE_COOKIE=1`.
 * - The cookie is removed from requests before they reach an app, so no app
 *   ever sees the session token.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const COOKIE = "fsd_super_app";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
/** Every failed sign-in answers after at least this long. */
const FAILURE_DELAY_MS = 750;
/** Consecutive failures from one address before it must wait; the wait doubles per further failure, up to the cap. */
const FREE_FAILURES = 5;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;
/** Sign-in attempts checked at once, across every address; more are turned away. */
const MAX_PENDING = 4;

/** Constant-time equality that leaks neither contents nor length: both sides are hashed to a fixed size first. */
const equal = (a, b) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** The cookies a request carries, by name. */
function cookies(header) {
  const out = new Map();
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

/** An address on this server to go to after signing in: a local path only, never another origin. */
export function safeNext(value) {
  // Control characters and backslashes first: a browser drops a tab or newline from a URL and reads `\` as `/`,
  // so `/\t/evil.example` would pass a prefix check and land on `//evil.example`.
  if (typeof value !== "string" || /[\x00-\x1f\x7f\\]/.test(value) || !value.startsWith("/") || value.startsWith("//")) return "/";
  let url;
  try {
    url = new URL(value, "http://local");
  } catch {
    return "/";
  }
  // The parsed path is what the browser follows: `/a/..//evil.example` normalizes to `//evil.example`.
  const result = url.pathname + url.search + url.hash;
  if (url.origin !== "http://local" || url.pathname.startsWith("//") || url.pathname.startsWith("/login")) return "/";
  return result;
}

/**
 * @param {{ username: string, password: string, secret?: string }} options
 */
export function createAuth({ username, password, secret = randomBytes(32).toString("hex") }) {
  /**
   * Failures by the connecting address: the socket's, never a forwarded header a client could set.
   * Behind a load balancer every attempt shares its address, so a guessing loop slows sign-in for everyone: by design.
   */
  const failures = new Map();
  let pending = 0;
  const lockedFor = (ip) => {
    const record = failures.get(ip);
    if (record === undefined || record.count < FREE_FAILURES) return 0;
    const wait = Math.min(MAX_LOCKOUT_MS, 1000 * 2 ** (record.count - FREE_FAILURES));
    return Math.max(0, record.at + wait - Date.now());
  };

  const sign = (expiry) => createHmac("sha256", secret).update(`${username}\n${expiry}`).digest("base64url");

  /** Whether the request carries a session cookie this process signed and that hasn't expired. */
  const signedIn = (req) => {
    const value = cookies(req.headers.cookie).get(COOKIE);
    if (value === undefined) return false;
    const [expiry, mac] = value.split(".");
    return expiry !== undefined && mac !== undefined && Number(expiry) > Date.now() / 1000 && equal(mac, sign(expiry));
  };

  const secure = (req) =>
    process.env.SUPER_APP_SECURE_COOKIE === "1" || String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";

  const cookie = (req, value, maxAge) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? "; Secure" : ""}`;

  /**
   * Answers the login routes and turns away anything not signed in.
   * @returns {boolean} `true` when the request was answered here and must not go on.
   */
  const handle = (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname === "/login" && req.method === "GET") {
      if (signedIn(req)) return redirect(res, safeNext(url.searchParams.get("next"))), true;
      return page(res, 200, { next: safeNext(url.searchParams.get("next")) }), true;
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress ?? "";
      const wait = lockedFor(ip);
      if (wait > 0 || pending >= MAX_PENDING) {
        const seconds = Math.max(1, Math.ceil(wait / 1000));
        res.setHeader("retry-after", String(seconds));
        page(res, 429, { next: "/", error: `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.` });
        req.resume();
        return true;
      }
      pending += 1;
      readForm(req, (form) => {
        const next = safeNext(form.get("next"));
        // Both compared every time, so a wrong user name answers no faster than a wrong password.
        const userOk = equal(form.get("username") ?? "", username);
        const passOk = equal(form.get("password") ?? "", password);
        if (userOk && passOk) {
          pending -= 1;
          failures.delete(ip);
          const expiry = String(Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS);
          res.setHeader("set-cookie", cookie(req, `${expiry}.${sign(expiry)}`, MAX_AGE_SECONDS));
          return redirect(res, next, 303);
        }
        const record = failures.get(ip) ?? { count: 0, at: 0 };
        failures.set(ip, { count: record.count + 1, at: Date.now() });
        setTimeout(() => {
          pending -= 1;
          page(res, 401, { next, error: "That user name and password don't match." });
        }, FAILURE_DELAY_MS);
      });
      return true;
    }
    if (url.pathname === "/logout" && req.method === "POST") {
      res.setHeader("set-cookie", cookie(req, "", 0));
      return redirect(res, "/login", 303), true;
    }
    if (signedIn(req)) return false;

    // A page load goes to the login page and comes back after; anything else (API, assets, streams) is refused.
    const wantsPage = req.method === "GET" && String(req.headers.accept ?? "").includes("text/html");
    if (wantsPage) return redirect(res, `/login?next=${encodeURIComponent(req.url ?? "/")}`), true;
    res.writeHead(401, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end("Sign in at /login first.\n");
    return true;
  };

  /** The request's headers with the session cookie taken out, for the app behind. */
  const strip = (headers) => {
    const rest = [...cookies(headers.cookie)].filter(([name]) => name !== COOKIE);
    const out = { ...headers };
    if (rest.length === 0) delete out.cookie;
    else out.cookie = rest.map(([k, v]) => `${k}=${v}`).join("; ");
    return out;
  };

  return { handle, signedIn, strip };
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { location, "cache-control": "no-store" });
  res.end();
}

/**
 * Reads a small urlencoded form, calling `done` exactly once: with the form, or
 * with an empty one when the body is over 8 KiB or the upload breaks off.
 */
function readForm(req, done) {
  let body = "";
  let finished = false;
  const finish = (form) => {
    if (finished) return;
    finished = true;
    done(form);
  };
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 8192) {
      finish(new URLSearchParams());
      req.destroy();
    }
  });
  req.on("end", () => finish(new URLSearchParams(body)));
  req.on("error", () => finish(new URLSearchParams()));
  req.on("close", () => finish(new URLSearchParams()));
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The shared look of the super app's own pages (landing and login). */
export const PAGE_STYLE = `:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#1c1917;--on-accent:#fafaf9;--bad:#dc2626}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--accent:#f5f5f4;--on-accent:#0c0a09;--bad:#f87171}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}`;

function page(res, status, { next, error }) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title><style>${PAGE_STYLE}
main{max-width:340px;margin:12vh auto 0;padding:0 16px}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 24px}
form{display:grid;gap:12px;padding:20px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
input{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{font:inherit;padding:9px;border:0;border-radius:6px;background:var(--accent);color:var(--on-accent);cursor:pointer}
.error{color:var(--bad);font-size:13px;margin:0}
</style></head><body><main><h1>flow-state-dev</h1><p class="sub">Sign in to reach the apps on this server.</p>
<form method="post" action="/login">${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
<input type="hidden" name="next" value="${escape(next)}">
<label>User name<input name="username" autocomplete="username" required autofocus></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button></form></main></body></html>`);
}

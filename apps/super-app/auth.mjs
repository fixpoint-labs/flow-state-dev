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
import { escapeHtml, PAGE_STYLE } from "./page.mjs";

const COOKIE = "fsd_super_app";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
/** Every failed sign-in answers after at least this long. */
const FAILURE_DELAY_MS = 750;
/** Consecutive failures from one address before it must wait; the wait doubles per further failure, up to the cap. */
const FREE_FAILURES = 5;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;
/**
 * How long an address's failures are remembered with no new one. Far longer
 * than the longest lockout, so waiting a lockout out never earns fresh free
 * attempts; only a correct sign-in clears the record sooner.
 */
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
/** Sign-in attempts being checked at once: per address, and across every address. More are turned away. */
const MAX_PENDING_PER_ADDRESS = 2;
const MAX_PENDING = 32;
/** A sign-in form that hasn't fully arrived by then is dropped, freeing its slot. */
const FORM_TIMEOUT_MS = 5000;
/**
 * Failed sign-ins allowed per minute across every address. Past it, an address
 * that has failed recently waits out the minute, so a guesser spread over many
 * addresses can't keep each one busy. An address with no recent failure is not
 * held back by it, so a guessing loop elsewhere can't lock a real user out.
 */
const GLOBAL_FAILURES_PER_MINUTE = 60;
/**
 * Addresses remembered at most. Only records past FORGET_AFTER_MS are ever
 * dropped to make room: a full record of live ones means many addresses are
 * failing at once, and every address not in it is held to the global limit.
 */
const MAX_TRACKED = 10_000;

/**
 * Who a sign-in attempt counts against: an IPv4 address, or an IPv6 address's
 * /64 network, since one IPv6 host is typically handed a whole /64 and could
 * otherwise take a fresh address per guess.
 */
export function addressKey(ip) {
  const address = String(ip ?? "").toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  if (!address.includes(":")) return address;
  const [head, tail = ""] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === "" ? [] : tail.split(":");
  const groups = address.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

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
 * @param {object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {string} [options.secret]  Signs the session cookie; random per process when unset.
 * @param {() => number} [options.now]  The clock, in ms. Tests pass their own.
 * @param {number} [options.globalFailuresPerMinute]  Default {@link GLOBAL_FAILURES_PER_MINUTE}.
 * @param {number} [options.maxTracked]  Default {@link MAX_TRACKED}.
 */
export function createAuth({
  username,
  password,
  secret = randomBytes(32).toString("hex"),
  now: clock = Date.now,
  globalFailuresPerMinute = GLOBAL_FAILURES_PER_MINUTE,
  maxTracked = MAX_TRACKED,
}) {
  /**
   * Failures by the connecting address: the socket's, never a forwarded header a client could set.
   * Behind a load balancer every attempt shares its address, so a guessing loop slows sign-in for everyone: by design.
   */
  const failures = new Map();
  /** Attempts being checked, by address. */
  const pendingBy = new Map();
  let pending = 0;
  /** When each failure of the last minute happened, across every address. */
  let recentFailures = [];

  const lockedFor = (key) => {
    const now = clock();
    recentFailures = recentFailures.filter((at) => now - at < 60_000);
    const global = recentFailures.length >= globalFailuresPerMinute ? recentFailures[0] + 60_000 - now : 0;
    const record = failures.get(key);
    if (record === undefined || now - record.at >= FORGET_AFTER_MS) return failures.size >= maxTracked ? global : 0;
    if (record.count < FREE_FAILURES) return global;
    const wait = Math.min(MAX_LOCKOUT_MS, 1000 * 2 ** (record.count - FREE_FAILURES));
    return Math.max(global, record.at + wait - now);
  };

  const recordFailure = (key) => {
    const now = clock();
    recentFailures.push(now);
    const record = failures.get(key);
    const count = record !== undefined && now - record.at < FORGET_AFTER_MS ? record.count + 1 : 1;
    failures.delete(key);
    // Map order is insertion order, so the first key is the one that failed longest ago: drop it only once it has expired.
    if (failures.size >= maxTracked) {
      const [oldest, last] = failures.entries().next().value;
      if (now - last.at < FORGET_AFTER_MS) return;
      failures.delete(oldest);
    }
    failures.set(key, { count, at: now });
  };

  const release = (key) => {
    pending -= 1;
    const left = (pendingBy.get(key) ?? 1) - 1;
    if (left <= 0) pendingBy.delete(key);
    else pendingBy.set(key, left);
  };

  const sign = (expiry) => createHmac("sha256", secret).update(`${username}\n${expiry}`).digest("base64url");

  /** Whether the request carries a session cookie this process signed and that hasn't expired. */
  const signedIn = (req) => {
    const value = cookies(req.headers.cookie).get(COOKIE);
    if (value === undefined) return false;
    const [expiry, mac] = value.split(".");
    return expiry !== undefined && mac !== undefined && Number(expiry) > clock() / 1000 && equal(mac, sign(expiry));
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
    let url;
    try {
      url = new URL(req.url ?? "/", "http://local");
    } catch {
      url = null;
    }
    // The proxy turns away a target that doesn't parse before it gets here; this refuses one that slips by.
    if (url === null) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("Bad request target.\n");
      return true;
    }
    if (url.pathname === "/login" && req.method === "GET") {
      if (signedIn(req)) return redirect(res, safeNext(url.searchParams.get("next"))), true;
      return page(res, 200, { next: safeNext(url.searchParams.get("next")) }), true;
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const key = addressKey(req.socket.remoteAddress);
      const wait = lockedFor(key);
      if (wait > 0 || pending >= MAX_PENDING || (pendingBy.get(key) ?? 0) >= MAX_PENDING_PER_ADDRESS) {
        const seconds = Math.max(1, Math.ceil(wait / 1000));
        res.setHeader("retry-after", String(seconds));
        page(res, 429, { next: "/", error: `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.` });
        req.resume();
        return true;
      }
      pending += 1;
      pendingBy.set(key, (pendingBy.get(key) ?? 0) + 1);
      readForm(req, (form) => {
        const next = safeNext(form.get("next"));
        // Both compared every time, so a wrong user name answers no faster than a wrong password.
        const userOk = equal(form.get("username") ?? "", username);
        const passOk = equal(form.get("password") ?? "", password);
        if (userOk && passOk) {
          release(key);
          failures.delete(key);
          const expiry = String(Math.floor(clock() / 1000) + MAX_AGE_SECONDS);
          res.setHeader("set-cookie", cookie(req, `${expiry}.${sign(expiry)}`, MAX_AGE_SECONDS));
          return redirect(res, next, 303);
        }
        recordFailure(key);
        setTimeout(() => {
          release(key);
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
 * with an empty one when the body is over 8 KiB, the upload breaks off, or it
 * hasn't arrived within FORM_TIMEOUT_MS.
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
  // A form trickled in slowly would hold its slot for as long as the connection lasts.
  const timer = setTimeout(() => {
    finish(new URLSearchParams());
    req.destroy();
  }, FORM_TIMEOUT_MS);
  req.on("close", () => clearTimeout(timer));
  req.on("end", () => clearTimeout(timer));
}



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
<form method="post" action="/login">${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<input type="hidden" name="next" value="${escapeHtml(next)}">
<label>User name<input name="username" autocomplete="username" required autofocus></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button></form></main></body></html>`);
}

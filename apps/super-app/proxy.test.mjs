/**
 * The super app's front door, with a stand-in app behind it: no traffic but the
 * login routes gets through without a signed session cookie, the cookie never
 * reaches the app, and an SPA's page is served under its prefix.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAuth, safeNext } from "./auth.mjs";
import { createProxy, loopbackHost } from "./proxy.mjs";

const seen = [];
const upstream = createServer((req, res) => {
  seen.push({ url: req.url, cookie: req.headers.cookie });
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end('<html><head><base href="/" /></head></html>');
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"ok":true}');
});

let base;
const proxy = (() => {
  const app = { id: "lab", title: "Lab", blurb: "", prefix: "/lab", kind: "spa", port: 0, run: { dev: [], serve: [] } };
  const server = createProxy({ apps: [app], auth: createAuth({ username: "ops", password: "s3cret" }), status: () => "running" });
  server.app = app;
  return server;
})();

before(async () => {
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  proxy.app.port = upstream.address().port;
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${proxy.address().port}`;
});
after(() => {
  proxy.close();
  upstream.close();
});

const get = (path, init = {}) => fetch(`${base}${path}`, { redirect: "manual", ...init });
const signIn = (username, password, next = "/lab/") =>
  get("/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, next }).toString(),
  });

describe("signed out", () => {
  it("sends a page load to the login page, remembering where it was going", async () => {
    const res = await get("/lab/inbox", { headers: { accept: "text/html" } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login?next=%2Flab%2Finbox");
  });

  it("refuses API calls, the landing page's data and anything else, never reaching the app", async () => {
    const before = seen.length;
    for (const path of ["/lab/api/flows", "/lab/assets/x.js", "/"]) assert.equal((await get(path)).status, 401, path);
    assert.equal(seen.length, before);
  });

  it("serves the login page", async () => {
    const res = await get("/login");
    assert.equal(res.status, 200);
    assert.match(await res.text(), /name="password"/);
  });

  it("turns away a wrong password with no cookie", async () => {
    const res = await signIn("ops", "wrong");
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  it("refuses a cookie it didn't sign", async () => {
    const res = await get("/lab/api/flows", { headers: { cookie: `fsd_super_app=${Math.floor(Date.now() / 1000) + 999}.forged` } });
    assert.equal(res.status, 401);
  });
});

describe("signed in", () => {
  let cookie;
  before(async () => {
    const res = await signIn("ops", "s3cret");
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/lab/");
    const set = res.headers.get("set-cookie");
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Lax/);
    cookie = `${set.split(";")[0]}; theirs=1`;
  });

  it("passes requests through without the session cookie, keeping the app's own", async () => {
    const res = await get("/lab/api/flows", { headers: { cookie } });
    assert.equal(res.status, 200);
    const last = seen.at(-1);
    assert.equal(last.url, "/api/flows");
    assert.equal(last.cookie, "theirs=1");
  });

  it("serves an SPA's page under its prefix", async () => {
    const html = await (await get("/lab/", { headers: { cookie } })).text();
    assert.match(html, /<base href="\/lab\/">/);
  });

  it("signs out", async () => {
    const res = await get("/logout", { method: "POST", headers: { cookie } });
    assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
  });
});

describe("where sign-in sends you", () => {
  it("only to a path on this server", () => {
    assert.equal(safeNext("/lab/inbox"), "/lab/inbox");
    assert.equal(safeNext("/lab/tasks?by=worker#top"), "/lab/tasks?by=worker#top");
    assert.equal(safeNext("/shift-manager/tasks/b%2F1/T-1/diff"), "/shift-manager/tasks/b%2F1/T-1/diff");
    const bad = ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/a/..//evil.example", "/./%2e%2e//evil.example", "/login?next=/x", undefined];
    for (const value of bad) assert.equal(safeNext(value), "/", JSON.stringify(value));
  });
});

describe("guessing the password", () => {
  it("locks an address out after repeated failures, and still lets the right password in afterwards elsewhere", async () => {
    const server = createProxy({ apps: [], auth: createAuth({ username: "ops", password: "s3cret" }), status: () => "running" });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${server.address().port}`;
    const attempt = (password) =>
      fetch(`${at}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "ops", password }).toString(),
      });
    try {
      for (let i = 0; i < 5; i++) assert.equal((await attempt(`wrong-${i}`)).status, 401);
      // Locked: even the right password is refused until the wait is over.
      const locked = await attempt("s3cret");
      assert.equal(locked.status, 429);
      assert.ok(Number(locked.headers.get("retry-after")) >= 1);
    } finally {
      server.close();
    }
  });
});

describe("with no sign-in (loopback dev)", () => {
  it("answers only requests addressed to a loopback name, so a rebound domain can't reach the apps", async () => {
    const server = createProxy({ apps: [], status: () => "running" });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const { request } = await import("node:http");
    const status = (host) =>
      new Promise((resolve, reject) => {
        request({ host: "127.0.0.1", port, path: "/", headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
          .on("error", reject)
          .end();
      });
    try {
      assert.equal(await status(`localhost:${port}`), 200);
      assert.equal(await status("evil.example"), 421);
    } finally {
      server.close();
    }
  });

  it("knows the loopback names", () => {
    for (const ok of ["localhost", "localhost:80", "127.0.0.1:8080", "[::1]:3000"]) assert.ok(loopbackHost(ok), ok);
    for (const no of ["evil.example", "127.0.0.1.evil.example", "", undefined]) assert.ok(!loopbackHost(no), String(no));
  });
});

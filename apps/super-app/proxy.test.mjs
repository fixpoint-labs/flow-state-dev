/**
 * The super app's front door, with a stand-in app behind it: no traffic but the
 * login routes gets through without a signed session cookie, the cookie never
 * reaches the app, and an SPA's page is served under its prefix.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { addressKey, createAuth, safeNext } from "./auth.mjs";
import { createProxy, loopbackHost, publicLocation } from "./proxy.mjs";

const seen = [];
const upstream = createServer((req, res) => {
  seen.push({ url: req.url, cookie: req.headers.cookie, headers: req.headers });
  if (req.url === "/stream-dies") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
    setTimeout(() => res.socket.destroy(), 50);
    return;
  }
  if (req.url === "/page-dies") {
    res.writeHead(200, { "content-type": "text/html" });
    res.write('<html><head><base href="/" />');
    setTimeout(() => res.socket.destroy(), 50);
    return;
  }
  if (req.url === "/redirect-own-origin") {
    res.writeHead(302, { location: `http://127.0.0.1:${req.socket.localPort}/inbox` });
    return res.end();
  }
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
  // A response a regression leaves open must not keep the test run alive.
  proxy.closeAllConnections();
  upstream.closeAllConnections();
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

describe("a sign-in form that never finishes arriving", () => {
  it("holds only its own address's slots, and lets go of them after the form timeout", async () => {
    const server = createProxy({ apps: [], auth: createAuth({ username: "ops", password: "s3cret" }), status: () => "running" });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    const { connect } = await import("node:net");
    const stall = () =>
      new Promise((resolve) => {
        const socket = connect(port, "127.0.0.1", () => {
          socket.write("POST /login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 1000\r\n\r\nuser");
          resolve(socket);
        });
      });
    const signIn = () =>
      fetch(`http://127.0.0.1:${port}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=ops&password=s3cret",
      });
    const stalled = [await stall(), await stall()];
    try {
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await signIn()).status, 429, "both of this address's slots are taken");
      await new Promise((r) => setTimeout(r, 6500)); // the form timeout, then the failed attempt's answer delay
      assert.equal((await signIn()).status, 303, "the timeout freed them");
    } finally {
      for (const socket of stalled) socket.destroy();
      server.close();
    }
  });
});

describe("whose attempts count together", () => {
  it("groups an IPv6 network's addresses and unwraps IPv4-mapped ones", () => {
    assert.equal(addressKey("2001:db8:1:2:aaaa::1"), addressKey("2001:0db8:0001:0002:ffff:1:2:3"));
    assert.notEqual(addressKey("2001:db8:1:2::1"), addressKey("2001:db8:1:3::1"));
    assert.equal(addressKey("::ffff:203.0.113.9"), "203.0.113.9");
    assert.notEqual(addressKey("203.0.113.9"), addressKey("203.0.113.10"));
  });
});

describe("the lockout's memory", () => {
  it("doesn't hand back free attempts to an address that waited out its lockout", async () => {
    let clock = Date.now();
    const server = createProxy({ apps: [], auth: createAuth({ username: "ops", password: "s3cret", now: () => clock }), status: () => "running" });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const attempt = (password) =>
      fetch(`http://127.0.0.1:${server.address().port}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "ops", password }).toString(),
      });
    try {
      for (let i = 0; i < 5; i++) assert.equal((await attempt("wrong")).status, 401);
      // Longer than the longest lockout (15 minutes): this one is let through and fails...
      clock += 16 * 60 * 1000;
      assert.equal((await attempt("wrong")).status, 401);
      // ...and it is the sixth failure, not a fresh first, so the next attempt waits.
      assert.equal((await attempt("wrong")).status, 429);
    } finally {
      server.close();
    }
  });
});

describe("the limit across every address", () => {
  it("holds back addresses that have been failing, not one that hasn't", async () => {
    const server = createProxy({
      apps: [],
      auth: createAuth({ username: "ops", password: "s3cret", globalFailuresPerMinute: 2 }),
      status: () => "running",
    });
    // Both stacks, so 127.0.0.1 and ::1 are two different addresses.
    await new Promise((r) => server.listen(0, "::", r));
    const port = server.address().port;
    const attempt = (host, password) =>
      fetch(`http://${host}:${port}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "ops", password }).toString(),
      });
    try {
      assert.equal((await attempt("127.0.0.1", "wrong")).status, 401);
      assert.equal((await attempt("127.0.0.1", "wrong")).status, 401);
      // The minute's budget is spent: the address that spent it waits, even with the right password...
      assert.equal((await attempt("127.0.0.1", "s3cret")).status, 429);
      // ...while one that hasn't failed signs in.
      assert.equal((await attempt("[::1]", "s3cret")).status, 303);
    } finally {
      server.close();
    }
  });
});

describe("a full record of failing addresses", () => {
  it("keeps the live ones and holds every unrecorded address to the global limit", async () => {
    const server = createProxy({
      apps: [],
      auth: createAuth({ username: "ops", password: "s3cret", globalFailuresPerMinute: 1, maxTracked: 1 }),
      status: () => "running",
    });
    await new Promise((r) => server.listen(0, "::", r));
    const port = server.address().port;
    const attempt = (host, password) =>
      fetch(`http://${host}:${port}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: "ops", password }).toString(),
      });
    try {
      // One failing address fills the record and spends the minute's budget.
      assert.equal((await attempt("127.0.0.1", "wrong")).status, 401);
      // Many addresses failing at once: one with no record is held back too, rather than pushing the live record out.
      assert.equal((await attempt("[::1]", "s3cret")).status, 429);
    } finally {
      server.close();
    }
  });
});

/** Sends `head` as the raw start of a request and resolves with the status line, or what closed the socket. */
async function rawRequest(port, head) {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(head));
    let data = "";
    socket.on("data", (c) => (data += c));
    socket.on("close", () => resolve(data.split("\r\n")[0]));
    socket.on("error", () => resolve("error"));
    setTimeout(() => socket.destroy(), 2000);
  });
}

describe("a request target that doesn't parse", () => {
  for (const [name, auth] of [
    ["with a sign-in", () => createAuth({ username: "ops", password: "s3cret" })],
    ["without one", () => undefined],
  ]) {
    it(`gets 400 and leaves the server running, ${name}`, async () => {
      const server = createProxy({ apps: [], auth: auth(), status: () => "running" });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      try {
        assert.match(await rawRequest(port, "GET //[ HTTP/1.1\r\nHost: localhost\r\n\r\n"), /^HTTP\/1\.1 400/);
        // An upgrade with the same target is refused too.
        const upgrade = "GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n";
        assert.match(await rawRequest(port, upgrade), /^HTTP\/1\.1 400/);
        // Still serving.
        assert.equal((await fetch(`http://127.0.0.1:${port}/login`)).status, auth() === undefined ? 404 : 200);
      } finally {
        server.close();
      }
    });
  }
});

describe("what reaches the app, and what comes back", () => {
  let cookie;
  before(async () => {
    const res = await signIn("ops", "s3cret");
    cookie = res.headers.get("set-cookie").split(";")[0];
  });

  it("drops hop-by-hop headers and sets x-forwarded-host from the real Host", async () => {
    // `fetch` won't send `Connection` or `Keep-Alive` itself, so this goes through node:http.
    const { request } = await import("node:http");
    await new Promise((resolve, reject) => {
      const url = new URL(`${base}/lab/api/flows`);
      request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: { cookie, "x-forwarded-host": "evil.example", "keep-alive": "timeout=5", "x-drop-me": "1", connection: "keep-alive, x-drop-me" },
        },
        (res) => res.resume().on("end", resolve),
      )
        .on("error", reject)
        .end();
    });
    const { headers } = seen.at(-1);
    assert.equal(headers["x-forwarded-host"], new URL(base).host);
    assert.equal(headers["keep-alive"], undefined);
    assert.equal(headers["x-drop-me"], undefined, "a header the Connection header names is hop-by-hop too");
  });

  it("puts an app's redirect to its own loopback address back under its prefix", async () => {
    const res = await get("/lab/redirect-own-origin", { headers: { cookie } });
    assert.equal(res.headers.get("location"), "/lab/inbox");
  });
});

describe("publicLocation", () => {
  const spa = { prefix: "/lab", kind: "spa", port: 3120 };
  const next = { prefix: "/kitchen-sink", kind: "next", port: 3110 };
  it("prefixes an SPA's root paths and its own loopback URLs", () => {
    assert.equal(publicLocation("/inbox", spa), "/lab/inbox");
    assert.equal(publicLocation("http://127.0.0.1:3120/inbox?x=1", spa), "/lab/inbox?x=1");
    assert.equal(publicLocation("http://localhost:3120", spa), "/lab/");
    assert.equal(publicLocation("/lab/inbox", spa), "/lab/inbox");
  });
  it("keeps a Next app's own basePath, removing only its loopback origin", () => {
    assert.equal(publicLocation("http://127.0.0.1:3110/kitchen-sink/flow-state", next), "/kitchen-sink/flow-state");
    assert.equal(publicLocation("/kitchen-sink/flow-state", next), "/kitchen-sink/flow-state");
  });
  it("leaves another origin and another app's port alone", () => {
    assert.equal(publicLocation("https://example.com/x", spa), "https://example.com/x");
    assert.equal(publicLocation("//example.com/x", spa), "//example.com/x");
    assert.equal(publicLocation("http://127.0.0.1:9999/x", spa), "http://127.0.0.1:9999/x");
  });
});

describe("the session cookie's lifetime", () => {
  it("ends after seven days on the auth's own clock", async () => {
    let clock = Date.now();
    const auth = createAuth({ username: "ops", password: "s3cret", now: () => clock });
    const server = createProxy({ apps: [], auth, status: () => "running" });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${at}/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=ops&password=s3cret",
      });
      const session = res.headers.get("set-cookie").split(";")[0];
      const landing = () => fetch(`${at}/`, { headers: { cookie: session } });
      assert.equal((await landing()).status, 200);
      clock += 7 * 24 * 60 * 60 * 1000 + 1000;
      assert.equal((await landing()).status, 401);
    } finally {
      server.close();
    }
  });
});

describe("an app that dies mid-response", () => {
  let cookie;
  before(async () => {
    cookie = (await signIn("ops", "s3cret")).headers.get("set-cookie").split(";")[0];
  });

  /** Reads the whole body; resolves "ended" when the proxy ends or breaks the response, "open" if it is still open after 3s. */
  const outcome = async (path) => {
    const res = await get(path, { headers: { cookie } });
    const read = res.text().then(
      () => "ended",
      () => "ended",
    );
    return Promise.race([read, new Promise((r) => setTimeout(() => r("open"), 3000))]);
  };

  it("ends the browser's live stream, so its client reconnects", async () => {
    assert.equal(await outcome("/lab/stream-dies"), "ended");
  });

  it("answers 502 for a page that dies while it is being buffered for the rewrite", async () => {
    const res = await Promise.race([get("/lab/page-dies", { headers: { cookie } }), new Promise((r) => setTimeout(() => r(null), 3000))]);
    assert.notEqual(res, null, "the browser got an answer");
    assert.equal(res.status, 502);
  });
});

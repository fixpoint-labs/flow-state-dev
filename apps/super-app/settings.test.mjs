/**
 * When the super app refuses to start, and the defaults it starts with: the
 * rules that keep the shared password off an open, unencrypted network.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSettings } from "./settings.mjs";

const creds = { SUPER_APP_USERNAME: "ops", SUPER_APP_PASSWORD: "s3cret" };

describe("where it listens by default", () => {
  it("serves on port 80, on every interface", () => {
    const s = resolveSettings("serve", { ...creds, SUPER_APP_SECURE_COOKIE: "1" });
    assert.equal(s.port, 80);
    assert.equal(s.host, "0.0.0.0");
  });

  it("runs dev on 8080, on loopback, so it needs neither root nor a sign-in", () => {
    const s = resolveSettings("dev", {});
    assert.equal(s.error, undefined);
    assert.equal(s.port, 8080);
    assert.equal(s.host, "127.0.0.1");
    assert.equal(s.credentials, undefined);
  });

  it("takes PORT and HOST when they are set", () => {
    const s = resolveSettings("dev", { PORT: "9000", HOST: "localhost" });
    assert.equal(s.port, 9000);
    assert.equal(s.host, "localhost");
  });
});

describe("PORT", () => {
  // A bad PORT used to reach listen() as NaN or 99999 and fail there, far from the cause.
  it("accepts the ends of the valid range", () => {
    assert.equal(resolveSettings("dev", { PORT: "1" }).port, 1);
    assert.equal(resolveSettings("dev", { PORT: "65535" }).port, 65535);
  });

  for (const PORT of ["abc", "", "0", "65536", "99999", "-1", "80.5", "1e3", "0x50"]) {
    it(`refuses PORT=${JSON.stringify(PORT)} with a message that names it`, () => {
      const s = resolveSettings("dev", { PORT });
      assert.equal(s.exitCode, 2);
      assert.match(s.error, /PORT must be an integer from 1 to 65535/);
      assert.ok(s.error.includes(JSON.stringify(PORT).slice(1, -1)));
      assert.equal(s.port, undefined);
    });
  }
});

describe("the sign-in", () => {
  it("is required to serve", () => {
    assert.equal(resolveSettings("serve", { SUPER_APP_SECURE_COOKIE: "1" }).exitCode, 3);
  });

  it("is required for dev off loopback", () => {
    assert.equal(resolveSettings("dev", { HOST: "0.0.0.0", SUPER_APP_ALLOW_HTTP: "1" }).exitCode, 3);
  });

  it("needs both halves", () => {
    assert.match(resolveSettings("dev", { SUPER_APP_USERNAME: "ops" }).error, /both/);
  });
});

describe("plain HTTP off loopback", () => {
  it("is refused unless HTTPS is in front, so the password never crosses the network in the clear", () => {
    const s = resolveSettings("serve", creds);
    assert.equal(s.exitCode, 3);
    assert.match(s.error, /plain HTTP/);
    assert.match(s.error, /SUPER_APP_SECURE_COOKIE=1/);
  });

  it("starts with HTTPS stated in front", () => {
    assert.equal(resolveSettings("serve", { ...creds, SUPER_APP_SECURE_COOKIE: "1" }).error, undefined);
  });

  it("starts when the operator allows plain HTTP on purpose", () => {
    assert.equal(resolveSettings("serve", { ...creds, SUPER_APP_ALLOW_HTTP: "1" }).error, undefined);
  });

  it("is not asked about on loopback, where nothing crosses a network", () => {
    assert.equal(resolveSettings("serve", { ...creds, HOST: "127.0.0.1" }).error, undefined);
  });
});

describe("SUPER_APP_ONLY", () => {
  it("starts only the apps it names", () => {
    assert.deepEqual(resolveSettings("dev", { SUPER_APP_ONLY: "teammates, shift-manager" }).apps.map((a) => a.id), ["shift-manager", "teammates"]);
  });

  it("refuses a name that isn't hosted", () => {
    assert.equal(resolveSettings("dev", { SUPER_APP_ONLY: "nope" }).exitCode, 2);
  });
});

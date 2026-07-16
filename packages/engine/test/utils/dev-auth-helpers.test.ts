/**
 * Shared helpers behind dev-auth / debug env-flag resolution and loopback
 * detection (FIX-894 review consolidation).
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveEnvFlag } from "../../src/utils/resolve-env-flag";
import { pickOrigin, isLoopbackOrigin } from "../../src/utils/loopback-origin";

describe("resolveEnvFlag", () => {
  const KEY = "FSDEV_TEST_FLAG_XYZ";
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the explicit value when defined, ignoring the env", () => {
    process.env[KEY] = "1";
    expect(resolveEnvFlag(false, KEY)).toBe(false);
    expect(resolveEnvFlag(true, KEY)).toBe(true);
  });

  it("falls back to env === \"1\" when explicit is undefined", () => {
    process.env[KEY] = "1";
    expect(resolveEnvFlag(undefined, KEY)).toBe(true);
  });

  it("treats any value other than \"1\" (or unset) as false", () => {
    expect(resolveEnvFlag(undefined, KEY)).toBe(false); // unset
    process.env[KEY] = "0";
    expect(resolveEnvFlag(undefined, KEY)).toBe(false);
    process.env[KEY] = "true";
    expect(resolveEnvFlag(undefined, KEY)).toBe(false);
  });
});

describe("isLoopbackOrigin", () => {
  it("is true for loopback URLs (any port, ipv4/ipv6/localhost)", () => {
    for (const url of [
      "http://localhost:4200",
      "http://127.0.0.1:4200/api/flows/x",
      "http://127.5.6.7:80",
      "http://[::1]:4200"
    ]) {
      expect(isLoopbackOrigin(url)).toBe(true);
    }
  });

  it("is false for network hosts and unparseable strings", () => {
    for (const url of [
      "https://api.example.com",
      "http://0.0.0.0:4200",
      "http://192.168.1.10",
      "not a url"
    ]) {
      expect(isLoopbackOrigin(url)).toBe(false);
    }
  });
});

describe("pickOrigin", () => {
  const req = (origin: string | null): Request =>
    ({ headers: { get: (n: string) => (n.toLowerCase() === "origin" ? origin : null) } }) as unknown as Request;

  it("returns the Origin header when present", () => {
    expect(pickOrigin(req("https://evil.example.com"))).toBe("https://evil.example.com");
  });

  it("returns null for a missing or literal-null origin", () => {
    expect(pickOrigin(req(null))).toBeNull();
    expect(pickOrigin(req("null"))).toBeNull();
  });
});

/** Regression tests for the server-side fetch/crawl network boundary. */
import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpUrl,
  isPublicIp,
  type AddressLookup,
} from "../../src/_internal/public-url";


/** A lookup that must never be reached — literals are classified without DNS. */
const noLookup: AddressLookup = () => {
  throw new Error("lookup should not be called");
};

const lookupReturning = (...addresses: string[]): AddressLookup =>
  vi.fn().mockResolvedValue(addresses.map((address) => ({ address })));

describe("assertPublicHttpUrl", () => {
  it("accepts a hostname whose every resolved address is public", async () => {
    await expect(
      assertPublicHttpUrl(
        "https://example.com/page",
        lookupReturning("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"),
      ),
    ).resolves.toMatchObject({ hostname: "example.com" });
  });

  it("rejects a hostname when any single resolved address is private", async () => {
    // Mixed A/AAAA: the connect path may pick either, so one bad answer is fatal.
    await expect(
      assertPublicHttpUrl(
        "https://attacker.example",
        lookupReturning("93.184.216.34", "10.0.0.8"),
      ),
    ).rejects.toThrow("public IP addresses");
  });

  it("rejects a hostname that resolves to nothing", async () => {
    await expect(
      assertPublicHttpUrl("https://void.example", lookupReturning()),
    ).rejects.toThrow("public IP addresses");
  });

  it.each([
    ["a non-HTTP scheme", "file:///etc/passwd"],
    ["a non-HTTP scheme", "gopher://example.com/"],
    ["localhost", "http://localhost/admin"],
    ["a localhost subdomain", "http://foo.localhost/admin"],
    ["loopback v4", "http://127.0.0.1/admin"],
    ["loopback v6", "http://[::1]/admin"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data"],
    ["RFC1918", "http://192.168.1.1/"],
    ["CGNAT", "http://100.64.0.1/"],
    ["a trailing-dot loopback", "http://127.0.0.1./"],
  ])("rejects %s (%s)", async (_label, url) => {
    await expect(assertPublicHttpUrl(url, noLookup)).rejects.toThrow();
  });

  it("rejects embedded credentials", async () => {
    await expect(
      assertPublicHttpUrl("http://user:pw@example.com/", noLookup),
    ).rejects.toThrow("credentials");
  });
});

describe("isPublicIp — IPv6 forms that bypass a naive prefix check", () => {
  it.each([
    // WHATWG canonicalizes `[::ffff:127.0.0.1]` to this hex form, so a
    // dotted-decimal-only regex lets loopback through.
    ["IPv4-mapped loopback, hex form", "::ffff:7f00:1"],
    ["IPv4-mapped metadata, hex form", "::ffff:a9fe:a9fe"],
    ["IPv4-mapped RFC1918, hex form", "::ffff:c0a8:1"],
    ["IPv4-mapped loopback, dotted form", "::ffff:127.0.0.1"],
    ["IPv4-compatible loopback", "::127.0.0.1"],
    // Deprecated but still routed on some networks; `fe[89ab]` misses it.
    ["site-local", "fec0::1"],
    ["unique local", "fd00::1"],
    ["link-local", "fe80::1"],
    ["multicast", "ff02::1"],
    ["unspecified", "::"],
    ["NAT64 loopback", "64:ff9b::7f00:1"],
    ["6to4 RFC1918", "2002:c0a8:0101::1"],
  ])("rejects %s (%s)", (_label, address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each([
    ["2606:2800:220:1:248:1893:25c8:1946"],
    ["2001:4860:4860::8888"],
    ["::ffff:93.184.216.34"],
  ])("accepts public %s", (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it.each([
    // Only 2000::/3 is allocated as global unicast. An unrecognized prefix must
    // not default to public just because it matches no denylist entry.
    ["discard-only (RFC6666)", "100::1"],
    ["unassigned", "4000::1"],
    ["SRv6 (RFC9602)", "5f00::1"],
    ["documentation (RFC9637)", "3fff::1"],
    ["2001:db8 documentation", "2001:db8::1"],
    ["protocol assignments", "2001:1::1"],
  ])("rejects out-of-global-range %s (%s)", (_label, address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it("rejects a malformed literal rather than defaulting to public", () => {
    expect(isPublicIp("not-an-ip")).toBe(false);
    expect(isPublicIp("::ffff::1")).toBe(false);
  });
});

describe("isPublicIp — IPv4 ranges", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("rejects %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.255.255"])(
    "accepts %s",
    (address) => {
      expect(isPublicIp(address)).toBe(true);
    },
  );
});

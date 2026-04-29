/**
 * Tests for the HMAC verifier helper. Covers GitHub-style raw signatures,
 * Stripe-style versioned/timestamped signatures, custom parsers, and
 * timing-safe failure paths.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { createHmacVerifier } from "../../src";

const SECRET = "shhh-it-is-a-secret";
const BODY = new TextEncoder().encode('{"event":"charge.succeeded","amount":499}');

function sign(payload: Uint8Array | string, secret = SECRET): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("hex");
}

describe("createHmacVerifier — GitHub-style raw signature", () => {
  it("verifies a valid signature with sha256= prefix", () => {
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "raw",
      prefix: "sha256="
    });
    const header = `sha256=${sign(BODY)}`;
    expect(verify(BODY, header)).toBe(true);
  });

  it("rejects a tampered body even with a previously valid signature", () => {
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "raw",
      prefix: "sha256="
    });
    const validHeader = `sha256=${sign(BODY)}`;
    const tamperedBody = new TextEncoder().encode('{"event":"charge.refunded"}');
    expect(verify(tamperedBody, validHeader)).toBe(false);
  });

  it("rejects a header that is missing the configured prefix", () => {
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "raw",
      prefix: "sha256="
    });
    expect(verify(BODY, sign(BODY))).toBe(false);
  });

  it("returns false for a missing or empty header", () => {
    const verify = createHmacVerifier({ secret: SECRET, format: "raw", prefix: "sha256=" });
    expect(verify(BODY, undefined)).toBe(false);
    expect(verify(BODY, null)).toBe(false);
    expect(verify(BODY, "")).toBe(false);
  });

  it("rejects when the secret has been rotated", () => {
    const verify = createHmacVerifier({ secret: "new-secret", format: "raw", prefix: "sha256=" });
    const header = `sha256=${sign(BODY, "old-secret")}`;
    expect(verify(BODY, header)).toBe(false);
  });
});

describe("createHmacVerifier — Stripe-style versioned signature", () => {
  it("verifies a valid t=<ts>,v1=<sig> signature within the tolerance window", () => {
    const ts = 1_700_000_000;
    const signed = `${ts}.${new TextDecoder().decode(BODY)}`;
    const v1 = sign(signed);
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "stripe",
      now: () => ts + 30
    });
    expect(verify(BODY, `t=${ts},v1=${v1}`)).toBe(true);
  });

  it("rejects a stale timestamp outside the default 5-minute window", () => {
    const ts = 1_700_000_000;
    const signed = `${ts}.${new TextDecoder().decode(BODY)}`;
    const v1 = sign(signed);
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "stripe",
      now: () => ts + 10_000
    });
    expect(verify(BODY, `t=${ts},v1=${v1}`)).toBe(false);
  });

  it("accepts when at least one of multiple v versions matches", () => {
    const ts = 1_700_000_000;
    const v1 = sign(`${ts}.${new TextDecoder().decode(BODY)}`);
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "stripe",
      now: () => ts
    });
    const header = `t=${ts},v1=invalid_legacy_value,v1=${v1}`;
    expect(verify(BODY, header)).toBe(true);
  });

  it("rejects when no timestamp is present", () => {
    const verify = createHmacVerifier({ secret: SECRET, format: "stripe" });
    expect(verify(BODY, `v1=${sign(BODY)}`)).toBe(false);
  });

  it("disables tolerance when toleranceSeconds is Infinity", () => {
    const ts = 1;
    const signed = `${ts}.${new TextDecoder().decode(BODY)}`;
    const v1 = sign(signed);
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "stripe",
      toleranceSeconds: Number.POSITIVE_INFINITY,
      now: () => 9_999_999_999
    });
    expect(verify(BODY, `t=${ts},v1=${v1}`)).toBe(true);
  });
});

describe("createHmacVerifier — custom parser", () => {
  it("uses the supplied parseSignature for non-standard headers", () => {
    const verify = createHmacVerifier({
      secret: SECRET,
      format: "custom",
      parseSignature: (header) => {
        const m = header.match(/^X-Sig\s+(?<sig>[A-Fa-f0-9]+)$/);
        return m && m.groups ? { signatures: [m.groups.sig as string] } : null;
      }
    });
    expect(verify(BODY, `X-Sig ${sign(BODY)}`)).toBe(true);
    expect(verify(BODY, "garbage")).toBe(false);
  });

  it("throws at construction when format=custom is missing parseSignature", () => {
    expect(() =>
      createHmacVerifier({ secret: SECRET, format: "custom" })
    ).toThrow(/parseSignature/);
  });
});

describe("createHmacVerifier — algorithms and encodings", () => {
  it("supports sha512 with base64 encoding", () => {
    const hmac = createHmac("sha512", SECRET);
    hmac.update(BODY);
    const expected = hmac.digest("base64");
    const verify = createHmacVerifier({
      secret: SECRET,
      algorithm: "sha512",
      encoding: "base64",
      format: "raw"
    });
    expect(verify(BODY, expected)).toBe(true);
  });
});

/**
 * Tests for the bearer token / HS256 JWT verifier helpers.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  createHs256JwtVerifier,
  extractBearerToken
} from "../../src";

const SECRET = "jwt-secret-do-not-share";

function base64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeJwt(
  payload: Record<string, unknown>,
  options: { alg?: string; secret?: string } = {}
): string {
  const alg = options.alg ?? "HS256";
  const secret = options.secret ?? SECRET;
  const header = base64Url(JSON.stringify({ alg, typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const sig = base64Url(
    createHmac("sha256", secret).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

describe("extractBearerToken", () => {
  it("extracts the token from a valid Authorization header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme", () => {
    expect(extractBearerToken("bearer xyz")).toBe("xyz");
    expect(extractBearerToken("BEARER xyz")).toBe("xyz");
    expect(extractBearerToken("BeArEr xyz")).toBe("xyz");
  });

  it("returns null for non-bearer schemes", () => {
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerToken("Token abc")).toBeNull();
  });

  it("returns null for missing or empty headers", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Bearer ")).toBeNull();
  });
});

describe("createHs256JwtVerifier", () => {
  it("verifies a valid HS256 JWT and returns the payload", () => {
    const verify = createHs256JwtVerifier({ secret: SECRET });
    const token = makeJwt({ sub: "user_42", iat: 1_700_000_000 });
    const payload = verify(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user_42");
  });

  it("rejects when the signature is forged with a different secret", () => {
    const verify = createHs256JwtVerifier({ secret: SECRET });
    const forged = makeJwt({ sub: "user_42" }, { secret: "wrong" });
    expect(verify(forged)).toBeNull();
  });

  it("rejects tokens whose alg is not HS256", () => {
    const verify = createHs256JwtVerifier({ secret: SECRET });
    const noneToken = `${base64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64Url(
      JSON.stringify({ sub: "user_42" })
    )}.`;
    expect(verify(noneToken)).toBeNull();
  });

  it("rejects expired tokens (with default zero clock skew)", () => {
    const now = 2_000_000_000;
    const verify = createHs256JwtVerifier({ secret: SECRET, now: () => now });
    const expired = makeJwt({ sub: "user", exp: now - 10 });
    expect(verify(expired)).toBeNull();
  });

  it("accepts not-yet-valid tokens within the configured clock skew", () => {
    const now = 1_700_000_000;
    const verify = createHs256JwtVerifier({
      secret: SECRET,
      now: () => now,
      clockSkewSeconds: 30
    });
    const token = makeJwt({ sub: "user", nbf: now + 20 });
    expect(verify(token)).not.toBeNull();
  });

  it("enforces the configured issuer when present", () => {
    const verify = createHs256JwtVerifier({ secret: SECRET, issuer: "https://example.com" });
    expect(verify(makeJwt({ sub: "u", iss: "https://example.com" }))).not.toBeNull();
    expect(verify(makeJwt({ sub: "u", iss: "https://evil.com" }))).toBeNull();
    expect(verify(makeJwt({ sub: "u" }))).toBeNull();
  });

  it("enforces the configured audience and accepts string-array aud", () => {
    const verify = createHs256JwtVerifier({ secret: SECRET, audience: ["api.example.com"] });
    expect(verify(makeJwt({ sub: "u", aud: "api.example.com" }))).not.toBeNull();
    expect(
      verify(makeJwt({ sub: "u", aud: ["other.example.com", "api.example.com"] }))
    ).not.toBeNull();
    expect(verify(makeJwt({ sub: "u", aud: "other.example.com" }))).toBeNull();
    expect(verify(makeJwt({ sub: "u" }))).toBeNull();
  });

  it("returns null for malformed tokens without throwing", () => {
    const verify = createHs256JwtVerifier({ secret: SECRET });
    expect(verify("not.a.token")).toBeNull();
    expect(verify("only-one-part")).toBeNull();
    expect(verify(undefined)).toBeNull();
    expect(verify(null)).toBeNull();
    expect(verify("")).toBeNull();
  });
});

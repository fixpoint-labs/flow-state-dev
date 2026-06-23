/**
 * Tests for the bearer-secret principal resolver.
 */
import { describe, it, expect } from "vitest";
import {
  createBearerSecretPrincipalResolver,
  PrincipalResolutionError
} from "../../src";
import type { PrincipalResolutionContext } from "../../src";

const SECRET = "scheduler-secret-do-not-share";
const SYSTEM_PRINCIPAL = { userId: "system" };

function buildContext(headerValue?: string | null): PrincipalResolutionContext {
  const headers = new Headers();
  if (typeof headerValue === "string") {
    headers.set("authorization", headerValue);
  }
  return {
    source: "scheduled",
    request: new Request("https://example.com/dispatch", { headers }),
    envelope: {
      flowKind: "demo",
      action: "doThing",
      input: {}
    }
  };
}

describe("createBearerSecretPrincipalResolver", () => {
  it("returns the configured principal when the bearer secret matches", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    const ctx = buildContext(`Bearer ${SECRET}`);
    await expect(Promise.resolve(resolve(ctx))).resolves.toEqual(SYSTEM_PRINCIPAL);
  });

  it("accepts case-insensitive Bearer scheme", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    const ctx = buildContext(`bearer ${SECRET}`);
    await expect(Promise.resolve(resolve(ctx))).resolves.toEqual(SYSTEM_PRINCIPAL);
  });

  it("returns null when the Authorization header is missing", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    const ctx = buildContext();
    await expect(Promise.resolve(resolve(ctx))).resolves.toBeNull();
  });

  it("returns null when the scheme is not Bearer", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    const ctx = buildContext(`Basic ${SECRET}`);
    await expect(Promise.resolve(resolve(ctx))).resolves.toBeNull();
  });

  it("throws PrincipalResolutionError(401) when the secret does not match", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    const ctx = buildContext("Bearer wrong-secret");
    await expect(async () => Promise.resolve(resolve(ctx))).rejects.toBeInstanceOf(
      PrincipalResolutionError
    );
    try {
      await Promise.resolve(resolve(ctx));
    } catch (err) {
      expect(err).toBeInstanceOf(PrincipalResolutionError);
      expect((err as PrincipalResolutionError).status).toBe(401);
    }
  });

  it("rejects mismatched-length tokens without timing leakage", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    // A token of a different length must still throw 401 (not return null).
    const ctx = buildContext("Bearer short");
    await expect(async () => Promise.resolve(resolve(ctx))).rejects.toBeInstanceOf(
      PrincipalResolutionError
    );
  });

  it("supports a custom header name", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL,
      headerName: "x-scheduler-auth"
    });
    const headers = new Headers();
    headers.set("x-scheduler-auth", `Bearer ${SECRET}`);
    const ctx: PrincipalResolutionContext = {
      source: "scheduled",
      request: new Request("https://example.com/dispatch", { headers }),
      envelope: { flowKind: "demo", action: "doThing", input: {} }
    };
    await expect(Promise.resolve(resolve(ctx))).resolves.toEqual(SYSTEM_PRINCIPAL);
  });

  it("falls back to envelope.metadata.headers when no Request is present", async () => {
    const resolve = createBearerSecretPrincipalResolver({
      secret: SECRET,
      principal: SYSTEM_PRINCIPAL
    });
    const ctx: PrincipalResolutionContext = {
      source: "scheduled",
      envelope: {
        flowKind: "demo",
        action: "doThing",
        input: {},
        metadata: { headers: { Authorization: `Bearer ${SECRET}` } }
      }
    };
    await expect(Promise.resolve(resolve(ctx))).resolves.toEqual(SYSTEM_PRINCIPAL);
  });

  it("rejects construction when the secret is empty", () => {
    expect(() =>
      createBearerSecretPrincipalResolver({
        secret: "",
        principal: SYSTEM_PRINCIPAL
      })
    ).toThrow(/non-empty string/);
  });

  it("rejects construction when the principal has no userId", () => {
    expect(() =>
      createBearerSecretPrincipalResolver({
        secret: SECRET,
        principal: { userId: "" }
      })
    ).toThrow(/principal\.userId/);
  });
});

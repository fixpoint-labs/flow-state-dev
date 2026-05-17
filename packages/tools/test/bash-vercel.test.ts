/**
 * Tests for the Vercel Sandbox adapter — specifically `resolveVercelSandbox`'s
 * error enrichment for the failure modes called out in FIX-587:
 *
 *   - The SDK's `APIError` (has `.response.status`) — existing 400/401/403
 *     credentials-hint enrichment, preserved.
 *   - `VercelOidcContextError` / `LocalOidcContextError` — thrown before any
 *     HTTP call when no OIDC token can be resolved. Without this enrichment
 *     the chat UI shows a bare `Status code 400 is not ok` from a different
 *     code path, leaving the user with no actionable guidance.
 *
 * `enrichVercelError` itself isn't exported. We drive it through
 * `resolveVercelSandbox` by injecting a fake `Sandbox` class whose
 * `create` / `get` throw the synthetic errors.
 */
import { describe, it, expect } from "vitest";
import { resolveVercelSandbox } from "../src/bash/adapters/vercel";
import { defaultDestinationFor } from "../src/bash/blocks";
import type {
  VercelSandboxClassLike,
  VercelSandboxInstance,
} from "../src/bash/types";

function fakeSandboxClass(throws: unknown): VercelSandboxClassLike {
  return {
    async create(): Promise<VercelSandboxInstance> {
      throw throws;
    },
    async get(): Promise<VercelSandboxInstance> {
      throw throws;
    },
  } as unknown as VercelSandboxClassLike;
}

// Synthetic SDK error shapes — built without importing @vercel/sandbox so
// the test stays decoupled from the SDK's class hierarchy.
function apiError(status: number, body?: unknown): Error {
  const err = new Error("Status code " + status + " is not ok");
  Object.assign(err, {
    response: { status, statusText: "Status text " + status },
    json: body,
  });
  return err;
}

function namedError(name: string, message = "OIDC token error"): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("resolveVercelSandbox: APIError enrichment (existing behavior)", () => {
  it("400 → credentials hint, status + detail in message", async () => {
    await expect(
      resolveVercelSandbox({
        Sandbox: fakeSandboxClass(apiError(400, { error: "bad creds" })),
      }),
    ).rejects.toThrowError(/failed with status 400/);
    await expect(
      resolveVercelSandbox({
        Sandbox: fakeSandboxClass(apiError(400, { error: "bad creds" })),
      }),
    ).rejects.toThrowError(/OIDC \/ credentials problem/);
  });

  it("401 and 403 also receive the credentials hint", async () => {
    for (const status of [401, 403]) {
      await expect(
        resolveVercelSandbox({ Sandbox: fakeSandboxClass(apiError(status)) }),
      ).rejects.toThrowError(/OIDC \/ credentials problem/);
    }
  });

  it("500 surfaces status + detail but no credentials hint", async () => {
    const p = resolveVercelSandbox({
      Sandbox: fakeSandboxClass(apiError(500, { err: "boom" })),
    });
    await expect(p).rejects.toThrowError(/failed with status 500/);
    await expect(p).rejects.not.toThrowError(/credentials problem/);
  });

  it("uses get(sandboxId=...) wording when reconnecting", async () => {
    await expect(
      resolveVercelSandbox({
        Sandbox: fakeSandboxClass(apiError(400)),
        sandboxId: "sbx_abc",
      }),
    ).rejects.toThrowError(/get\(sandboxId="sbx_abc"\)/);
  });
});

describe("resolveVercelSandbox: OIDC context error enrichment (FIX-587)", () => {
  it("VercelOidcContextError → actionable three-path message", async () => {
    const p = resolveVercelSandbox({
      Sandbox: fakeSandboxClass(namedError("VercelOidcContextError")),
    });
    await expect(p).rejects.toThrowError(/no OIDC token available/);
    await expect(p).rejects.toThrowError(/Enable OIDC Federation/i);
    await expect(p).rejects.toThrowError(/VERCEL_TOKEN \+ VERCEL_TEAM_ID/);
    await expect(p).rejects.toThrowError(/BASH_PROVIDER=just-bash/);
  });

  it("LocalOidcContextError → same actionable message", async () => {
    const p = resolveVercelSandbox({
      Sandbox: fakeSandboxClass(namedError("LocalOidcContextError")),
    });
    await expect(p).rejects.toThrowError(/no OIDC token available/);
    await expect(p).rejects.toThrowError(/BASH_PROVIDER=just-bash/);
  });

  it("unnamed subclass (Error.name not set on the class) is detected via constructor.name", async () => {
    // `class VercelOidcContextError extends Error {}` without an explicit
    // `this.name = ...` inherits Error.prototype.name === "Error". The
    // adapter must still find the class identity via constructor.name.
    class VercelOidcContextError extends Error {}
    const err = new VercelOidcContextError("no token");
    expect(err.name).toBe("Error"); // sanity: subclass didn't set name
    await expect(
      resolveVercelSandbox({ Sandbox: fakeSandboxClass(err) }),
    ).rejects.toThrowError(/no OIDC token available/);
  });

  it("regex fallback: unknown-name error with OIDC-token wording still detected", async () => {
    // Future SDK renames or non-English variants — match on message shape.
    const err = new Error("Cannot resolve the Vercel OIDC token at runtime");
    // err.name is the default ("Error"), no match by class name.
    await expect(
      resolveVercelSandbox({ Sandbox: fakeSandboxClass(err) }),
    ).rejects.toThrowError(/no OIDC token available/);
  });
});

describe("defaultDestinationFor", () => {
  it("vercel provider anchors the workspace under /vercel/sandbox", () => {
    // Vercel Sandbox's writeFiles extracts tarballs at / and the runtime
    // user can only mkdir under its home (/vercel/sandbox). A destination
    // outside the home fails with `tar: <dir>: Cannot mkdir: Permission
    // denied`. Verify the default keeps the workspace inside the home.
    expect(
      defaultDestinationFor({ type: "vercel", Sandbox: {} as never }),
    ).toBe("/vercel/sandbox/workspace");
  });

  it("non-vercel providers keep the conventional /workspace", () => {
    expect(defaultDestinationFor({ type: "local" })).toBe("/workspace");
    expect(defaultDestinationFor({ type: "just-bash" })).toBe("/workspace");
    expect(defaultDestinationFor(undefined)).toBe("/workspace");
  });
});

describe("resolveVercelSandbox: pass-through and non-Error throwables", () => {
  it("generic Error without status or OIDC shape is returned as-is", async () => {
    const original = new Error("something else broke");
    await expect(
      resolveVercelSandbox({ Sandbox: fakeSandboxClass(original) }),
    ).rejects.toBe(original);
  });

  it("non-Error throwable (string) is wrapped in new Error(String(...))", async () => {
    await expect(
      resolveVercelSandbox({ Sandbox: fakeSandboxClass("just a string") }),
    ).rejects.toThrowError(/just a string/);
  });
});

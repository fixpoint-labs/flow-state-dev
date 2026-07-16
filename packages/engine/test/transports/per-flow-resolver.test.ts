/**
 * Tests for per-flow `authentication.resolvePrincipal` routing on
 * `InboundTransportHost`. The host should:
 *
 *   - Use the flow's resolver when present, ignoring the host fallback
 *   - Fall back to `authentication.defaultUserId` when the resolver
 *     returns no userId
 *   - Enforce `authentication.requireUser` (401 when true, 500 when false
 *     and no userId could be produced)
 *   - Use the host fallback resolver when a flow has no `authentication`
 */
import { describe, it, expect, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  PrincipalResolutionError
} from "../../src";

function buildFlow(
  kind: string,
  authentication?: Parameters<typeof defineFlow>[0]["authentication"],
  extras?: { requireUser?: boolean }
) {
  return defineFlow({
    kind,
    requireUser: extras?.requireUser,
    authentication,
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: true }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  })({ id: kind });
}

function buildHost(flows: ReturnType<typeof buildFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) {
    registry.register(flow);
  }
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });
  return { host, registry, stores };
}

/**
 * A minimal stand-in for the inbound `Request`. The dev-auth guard only reads
 * `request.url` (loopback-host check) and the `origin` header (cross-origin
 * check); a real `Request` forbids setting the `Host` header, so we fake the
 * surface the resolver actually touches.
 */
const fakeReq = (url: string, origin?: string): Request =>
  ({
    url,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "origin" ? (origin ?? null) : null
    }
  }) as unknown as Request;

const LOOPBACK_URL = "http://localhost:4200/api/flows/x/actions/run";

const mkContext = (
  flowKind: string,
  body: Record<string, unknown>,
  source = "http",
  request?: Request
) => ({
  source,
  request,
  envelope: {
    flowKind,
    action: "run",
    input: body,
    metadata: { body }
  }
});

/** A bearer-gated flow: fixed principal on the wire, throws otherwise. */
function buildBearerFlow(kind: string) {
  return buildFlow(kind, {
    resolvePrincipal: () => ({ userId: "owner" })
  });
}

function buildDevAuthHost(flows: ReturnType<typeof buildFlow>[]) {
  const registry = createFlowRegistry();
  for (const flow of flows) {
    registry.register(flow);
  }
  const stores = createInMemoryStores();
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    devAuth: true
  });
  return { host, registry, stores };
}

describe("InboundTransportHost — per-flow authentication", () => {
  it("uses the flow's resolvePrincipal over the host fallback", async () => {
    const flowResolver = vi.fn(() => ({ userId: "flow_user", orgId: "flow_org" }));
    const flow = buildFlow("with-resolver", { resolvePrincipal: flowResolver });
    const { host } = buildHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("with-resolver", { userId: "ignored_body_user" })
    );
    expect(principal).toEqual({ userId: "flow_user", orgId: "flow_org" });
    expect(flowResolver).toHaveBeenCalledTimes(1);
  });

  it("falls through to defaultUserId when the resolver returns null", async () => {
    const flow = buildFlow("default-only", {
      resolvePrincipal: () => null,
      defaultUserId: "system"
    });
    const { host } = buildHost([flow]);
    const principal = await host.resolvePrincipal(mkContext("default-only", {}));
    expect(principal).toEqual({ userId: "system" });
  });

  it("falls through to defaultUserId when the resolver returns no userId", async () => {
    const flow = buildFlow("partial-resolver", {
      resolvePrincipal: () => ({ orgId: "acme" }),
      defaultUserId: "system"
    });
    const { host } = buildHost([flow]);
    const principal = await host.resolvePrincipal(mkContext("partial-resolver", {}));
    expect(principal).toEqual({ userId: "system", orgId: "acme" });
  });

  it("throws 401 when no userId is resolvable on a requireUser flow", async () => {
    const flow = buildFlow("require-user-default", { resolvePrincipal: () => null });
    const { host } = buildHost([flow]);
    await expect(
      host.resolvePrincipal(mkContext("require-user-default", {}))
    ).rejects.toMatchObject({
      name: "PrincipalResolutionError",
      status: 401
    });
  });

  it("throws 500 when requireUser:false flow produces no userId at all", async () => {
    const flow = buildFlow(
      "no-user-no-default",
      { requireUser: false, resolvePrincipal: () => null },
      { requireUser: false }
    );
    const { host } = buildHost([flow]);
    await expect(
      host.resolvePrincipal(mkContext("no-user-no-default", {}))
    ).rejects.toMatchObject({
      name: "PrincipalResolutionError",
      status: 500
    });
  });

  it("uses defaultUserId on requireUser:false flows without invoking the host fallback", async () => {
    const fallback = vi.fn(defaultBodyUserIdPrincipalResolver);
    const flow = buildFlow(
      "system-flow",
      { requireUser: false, defaultUserId: "system" }
    );
    const registry = createFlowRegistry();
    registry.register(flow);
    const stores = createInMemoryStores();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: fallback,
      runtimeConfig: {}
    });

    const principal = await host.resolvePrincipal(mkContext("system-flow", {}));
    expect(principal).toEqual({ userId: "system" });
    // Host fallback was called because the flow declares no resolver, but
    // its null return triggers defaultUserId — that's the expected path.
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("uses host fallback when the flow has no authentication config", async () => {
    const flow = buildFlow("no-auth-config");
    const { host } = buildHost([flow]);
    const principal = await host.resolvePrincipal(
      mkContext("no-auth-config", { userId: "body_u", orgId: "body_o" })
    );
    expect(principal).toEqual({ userId: "body_u", orgId: "body_o" });
  });

  it("propagates PrincipalResolutionError thrown by the flow's resolver", async () => {
    const flow = buildFlow("bad-sig", {
      resolvePrincipal: () => {
        throw new PrincipalResolutionError("Invalid HMAC signature", { status: 401 });
      }
    });
    const { host } = buildHost([flow]);
    await expect(
      host.resolvePrincipal(mkContext("bad-sig", {}))
    ).rejects.toMatchObject({
      name: "PrincipalResolutionError",
      status: 401,
      message: "Invalid HMAC signature"
    });
  });

  it("supports async resolvers", async () => {
    const flow = buildFlow("async-resolver", {
      resolvePrincipal: async () => ({ userId: "async_user" })
    });
    const { host } = buildHost([flow]);
    const principal = await host.resolvePrincipal(mkContext("async-resolver", {}));
    expect(principal).toEqual({ userId: "async_user" });
  });
});

describe("InboundTransportHost — dev auth", () => {
  // Loopback-served, same-origin/originless request — the intended DevTool path.
  const devReq = (origin?: string) => fakeReq(LOOPBACK_URL, origin);

  it("overrides a per-flow bearer resolver with the body userId for loopback HTTP actions", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("kh", { userId: "devuser" }, "http", devReq())
    );
    // Body identity wins; the bearer resolver is never consulted for HTTP.
    expect(principal).toEqual({ userId: "devuser" });
    expect(bearer).not.toHaveBeenCalled();
  });

  it("applies for a same-origin (loopback) browser request", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("kh", { userId: "devuser" }, "http", devReq("http://localhost:4200"))
    );
    expect(principal).toEqual({ userId: "devuser" });
    expect(bearer).not.toHaveBeenCalled();
  });

  it("trusts the body orgId under dev auth (single local identity source)", async () => {
    // Documented behavior: dev-auth trusts the whole body-supplied identity,
    // so an org-scoped flow is satisfied by a body orgId locally. There is no
    // entitlement check — acceptable only under the local-only, opt-in model.
    const flow = buildBearerFlow("kh-org");
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("kh-org", { userId: "devuser", orgId: "acme" }, "http", devReq())
    );
    expect(principal).toEqual({ userId: "devuser", orgId: "acme" });
  });

  it("does NOT apply on a non-loopback host — a leaked FSDEV_DEV_AUTH can't bypass prod auth", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    // Same origin as the (network) host, so it's not a cross-origin case — the
    // loopback-host guard alone must keep dev-auth off for a network deployment.
    const principal = await host.resolvePrincipal(
      mkContext(
        "kh",
        { userId: "devuser" },
        "http",
        fakeReq("https://api.example.com/api/flows/x/actions/run", "https://api.example.com")
      )
    );
    expect(principal).toEqual({ userId: "owner" });
    expect(bearer).toHaveBeenCalledTimes(1);
  });

  it("does NOT apply to a cross-origin browser request (CSRF from a malicious page)", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("kh", { userId: "attacker" }, "http", devReq("https://evil.example.com"))
    );
    // Cross-origin → falls through to the bearer resolver.
    expect(principal).toEqual({ userId: "owner" });
    expect(bearer).toHaveBeenCalledTimes(1);
  });

  it("does NOT apply when the context carries no request", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(mkContext("kh", { userId: "devuser" }));
    expect(principal).toEqual({ userId: "owner" });
    expect(bearer).toHaveBeenCalledTimes(1);
  });

  it("does NOT apply to MCP-sourced requests — the flow resolver still runs", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("kh", { userId: "devuser" }, "mcp", devReq())
    );
    // Non-HTTP source keeps the real per-flow resolver.
    expect(principal).toEqual({ userId: "owner" });
    expect(bearer).toHaveBeenCalledTimes(1);
  });

  it("does NOT apply to scheduled-sourced requests", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildDevAuthHost([flow]);

    const principal = await host.resolvePrincipal(
      mkContext("kh", { userId: "devuser" }, "scheduled", devReq())
    );
    expect(principal).toEqual({ userId: "owner" });
    expect(bearer).toHaveBeenCalledTimes(1);
  });

  it("still enforces requireUser — a body with no userId rejects (401)", async () => {
    const flow = buildBearerFlow("kh");
    const { host } = buildDevAuthHost([flow]);
    await expect(
      host.resolvePrincipal(mkContext("kh", {}, "http", devReq()))
    ).rejects.toMatchObject({ name: "PrincipalResolutionError", status: 401 });
  });

  it("still honors a flow's defaultUserId when the body omits userId", async () => {
    // Post-resolution checks are unchanged: dev-auth swaps the resolver, not
    // the defaultUserId fallback. A flow that configures defaultUserId still
    // gets it even under dev-auth (documented, not a rejection).
    const flow = buildFlow("kh-default", {
      resolvePrincipal: () => ({ userId: "owner" }),
      defaultUserId: "system"
    });
    const { host } = buildDevAuthHost([flow]);
    const principal = await host.resolvePrincipal(
      mkContext("kh-default", {}, "http", devReq())
    );
    expect(principal).toEqual({ userId: "system" });
  });

  it("when devAuth is unset, the per-flow bearer resolver wins as usual", async () => {
    const bearer = vi.fn(() => ({ userId: "owner" }));
    const flow = buildFlow("kh", { resolvePrincipal: bearer });
    const { host } = buildHost([flow]);
    const principal = await host.resolvePrincipal(
      mkContext("kh", { userId: "devuser" }, "http", devReq())
    );
    expect(principal).toEqual({ userId: "owner" });
    expect(bearer).toHaveBeenCalledTimes(1);
  });
});

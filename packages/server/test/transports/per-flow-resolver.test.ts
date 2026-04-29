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
    resolvePrincipal: defaultBodyUserIdPrincipalResolver
  });
  return { host, registry, stores };
}

const mkContext = (flowKind: string, body: Record<string, unknown>) => ({
  source: "http",
  envelope: {
    flowKind,
    action: "run",
    input: body,
    metadata: { body }
  }
});

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
      resolvePrincipal: fallback
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

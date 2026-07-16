import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFlowState,
  inMemoryStores,
  defaultBodyUserIdPrincipalResolver,
} from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { isLoopbackHost, assertNetworkBindIsAuthenticated } from "../src/bind-guard";

function pingFlow(kind: string, authenticated: boolean) {
  return defineFlow({
    kind,
    ...(authenticated
      ? {
          authentication: {
            // Any non-default resolver reads as "authenticated" to the rail.
            resolvePrincipal: () => ({ userId: "owner" }),
          },
        }
      : {}),
    actions: {
      ping: {
        inputSchema: z.object({}).passthrough(),
        block: handler({
          name: "ping",
          inputSchema: z.object({}).passthrough(),
          execute: () => undefined,
        }),
      },
    },
  })();
}

function flowState(flows: Record<string, ReturnType<typeof pingFlow>>) {
  return createFlowState({
    flows,
    modelResolver: createMockModelResolver({}),
    stores: { default: { primary: inMemoryStores() } },
  });
}

describe("isLoopbackHost", () => {
  it("is true for loopback hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "127.5.6.7", "::1"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it("is false for network-exposed hosts", () => {
    for (const host of ["0.0.0.0", "192.168.1.10", "::", "example.com"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe("assertNetworkBindIsAuthenticated", () => {
  it("allows a loopback host regardless of auth", async () => {
    const fs = flowState({ open: pingFlow("open", false) });
    await expect(
      assertNetworkBindIsAuthenticated(fs, { host: "127.0.0.1" }),
    ).resolves.toBeUndefined();
    await fs.dispose();
  });

  it("refuses a network host when a flow has no resolver, naming the kind", async () => {
    const fs = flowState({ open: pingFlow("open", false) });
    await expect(
      assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0" }),
    ).rejects.toThrow(/Refusing to bind 0\.0\.0\.0.*"open"/s);
    await fs.dispose();
  });

  it("allows a network host when every flow has a non-default resolver", async () => {
    const fs = flowState({ secure: pingFlow("secure", true) });
    await expect(
      assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0" }),
    ).resolves.toBeUndefined();
    await fs.dispose();
  });

  it("refuses when any served flow is unauthenticated, listing only the offenders", async () => {
    const fs = flowState({
      secure: pingFlow("secure", true),
      open: pingFlow("open", false),
    });
    const err = await assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('"open"');
    expect(err.message).not.toContain('"secure"');
    await fs.dispose();
  });

  it("skips the guard when allowUnauthenticated is set", async () => {
    const fs = flowState({ open: pingFlow("open", false) });
    await expect(
      assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0", allowUnauthenticated: true }),
    ).resolves.toBeUndefined();
    await fs.dispose();
  });

  describe("with development auth (FSDEV_DEV_AUTH=1)", () => {
    let savedDevAuth: string | undefined;
    beforeEach(() => {
      savedDevAuth = process.env.FSDEV_DEV_AUTH;
      process.env.FSDEV_DEV_AUTH = "1";
    });
    afterEach(() => {
      if (savedDevAuth === undefined) delete process.env.FSDEV_DEV_AUTH;
      else process.env.FSDEV_DEV_AUTH = savedDevAuth;
    });

    it("refuses a network host even when every flow has a real resolver", async () => {
      // Dev-auth overrides per-flow auth at request time, so the static check
      // would wrongly pass this bearer flow. The dev-auth guard catches it.
      const fs = flowState({ secure: pingFlow("secure", true) });
      await expect(
        assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0" }),
      ).rejects.toThrow(/FSDEV_DEV_AUTH/);
      await fs.dispose();
    });

    it("still allows a loopback bind under dev-auth", async () => {
      const fs = flowState({ secure: pingFlow("secure", true) });
      await expect(
        assertNetworkBindIsAuthenticated(fs, { host: "127.0.0.1" }),
      ).resolves.toBeUndefined();
      await fs.dispose();
    });

    it("allowUnauthenticated overrides the dev-auth network refusal", async () => {
      const fs = flowState({ secure: pingFlow("secure", true) });
      await expect(
        assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0", allowUnauthenticated: true }),
      ).resolves.toBeUndefined();
      await fs.dispose();
    });
  });

  it("treats an explicit default resolver the same as an unset one", async () => {
    // A flow that explicitly wires the framework default is still unauthenticated.
    const flow = defineFlow({
      kind: "explicit-default",
      authentication: { resolvePrincipal: defaultBodyUserIdPrincipalResolver },
      actions: {
        ping: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "ping",
            inputSchema: z.object({}).passthrough(),
            execute: () => undefined,
          }),
        },
      },
    })();
    const fs = createFlowState({
      flows: { explicitDefault: flow },
      modelResolver: createMockModelResolver({}),
      stores: { default: { primary: inMemoryStores() } },
    });
    await expect(
      assertNetworkBindIsAuthenticated(fs, { host: "0.0.0.0" }),
    ).rejects.toThrow(/"explicit-default"/);
    await fs.dispose();
  });
});

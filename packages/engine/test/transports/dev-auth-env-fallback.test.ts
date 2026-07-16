/**
 * `devAuth` env fallback on the route-handler boundary (FIX-894).
 *
 * The config-based `fsdev dev --dev-auth` serves a pre-built `FlowState` it
 * cannot pass options into, so the flag is picked up from `FSDEV_DEV_AUTH=1`
 * (mirroring `FSDEV_DEBUG_ENDPOINTS`). Explicit `devAuth` always wins over the
 * env flag. These tests assert that resolution at `createFlowRouteHandlers`.
 */
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowRegistry, createInMemoryStores } from "../../src";
import { createFlowRouteHandlers } from "../../src/routes/http-handlers";

function bearerFlow(kind: string) {
  return defineFlow({
    kind,
    authentication: { resolvePrincipal: () => ({ userId: "owner" }) },
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

function hostFor(devAuth: boolean | undefined) {
  const registry = createFlowRegistry();
  registry.register(bearerFlow("kh"));
  const { host } = createFlowRouteHandlers({
    registry,
    stores: createInMemoryStores(),
    runtimeConfig: {},
    detectInterruptedOnStartup: false,
    devAuth
  });
  return host;
}

const httpCtx = (body: Record<string, unknown>) => ({
  source: "http",
  envelope: { flowKind: "kh", action: "run", input: body, metadata: { body } }
});

describe("createFlowRouteHandlers — devAuth env fallback", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.FSDEV_DEV_AUTH;
    delete process.env.FSDEV_DEV_AUTH;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FSDEV_DEV_AUTH;
    else process.env.FSDEV_DEV_AUTH = saved;
  });

  it("enables dev-auth from FSDEV_DEV_AUTH=1 when devAuth is unset", async () => {
    process.env.FSDEV_DEV_AUTH = "1";
    const principal = await hostFor(undefined).resolvePrincipal(
      httpCtx({ userId: "devuser" })
    );
    expect(principal).toEqual({ userId: "devuser" });
  });

  it("leaves dev-auth off when the env flag is absent", async () => {
    const principal = await hostFor(undefined).resolvePrincipal(
      httpCtx({ userId: "devuser" })
    );
    // Bearer resolver wins — env flag not set.
    expect(principal).toEqual({ userId: "owner" });
  });

  it("explicit devAuth:false overrides FSDEV_DEV_AUTH=1", async () => {
    process.env.FSDEV_DEV_AUTH = "1";
    const principal = await hostFor(false).resolvePrincipal(
      httpCtx({ userId: "devuser" })
    );
    expect(principal).toEqual({ userId: "owner" });
  });

  it("treats any value other than \"1\" as off", async () => {
    process.env.FSDEV_DEV_AUTH = "true";
    const principal = await hostFor(undefined).resolvePrincipal(
      httpCtx({ userId: "devuser" })
    );
    expect(principal).toEqual({ userId: "owner" });
  });
});

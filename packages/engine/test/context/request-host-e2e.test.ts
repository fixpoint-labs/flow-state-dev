/**
 * End-to-end proof of the request-host seam (FIX-999).
 *
 * Every other test in this area exercises a unit — the gate, the derivation, the
 * read — with its collaborators handed in. This file proves the thing the issue
 * is actually about: that a **block** reaches the runtime through
 * `ctx.requestHost`, with no cast, on the real path (`runAction` →
 * `createExecutionContext` → the block), and that what it gets back reflects
 * real store state rather than a fixture.
 *
 * It also pins the *off* state (BP-035), which is the shipped default and the
 * one most likely to be discovered in production rather than here: on a registry
 * that is not shared across processes the liveness capability is **absent from
 * the bundle**, and a block that reaches for it must be refused rather than
 * receiving a plausible-looking wrong answer.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { requireRequestHost } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "../../src";
import type { StoreRegistry } from "../../src/stores/types";

/** Construction inputs that satisfy all three arms of the liveness gate. */
const HEALTHY_LIVENESS = { staleThresholdMs: 60_000, staleSweepIntervalMs: 30_000 };

/**
 * The in-memory registry declares itself per-process, which is correct and is
 * exactly why the gate refuses on it. To exercise the *enabled* path we need a
 * registry that declares itself shared — the deployment shape a real Postgres
 * pool provides.
 */
function withSharedRegistry(stores: StoreRegistry): StoreRegistry {
  return {
    ...stores,
    activeRequests: Object.assign(Object.create(Object.getPrototypeOf(stores.activeRequests)), stores.activeRequests, {
      sharedAcrossProcesses: true
    })
  };
}

describe("request-host seam, end to end", () => {
  it("a block reaches the runtime through ctx.requestHost and reads REAL registry state", async () => {
    const seen: Record<string, boolean>[] = [];

    const probe = handler({
      name: "probe",
      inputSchema: z.object({ ask: z.array(z.string()) }),
      outputSchema: z.boolean(),
      // No cast anywhere in this block — that is the compile-time half of the
      // deliverable, and this file would not compile if it were still needed.
      execute: async ({ ask }, ctx) => {
        const host = requireRequestHost(ctx);
        const answers = await host.livenessOf!(ask);
        seen.push(answers);
        return true;
      }
    });

    const flow = defineFlow({
      kind: "seam-e2e",
      actions: { run: { block: probe } },
      request: { heartbeatIntervalMs: 10_000 }
    })();

    const stores = withSharedRegistry(createInMemoryStores());

    // A real sibling request, registered in the real registry, in the session
    // this request runs in — so it is genuinely a descendant the caller owns.
    const ts = Date.now();
    await stores.session.set(
      "s_e2e",
      {
        id: "s_e2e",
        state: {},
        version: 0,
        createdAt: ts,
        updatedAt: ts,
        flowKind: "seam-e2e",
        userId: "u_alice",
        journal: []
      },
      "any"
    );
    await stores.activeRequests.register({
      requestId: "req_sibling",
      flowKind: "seam-e2e",
      actionName: "run",
      sessionId: "s_e2e",
      userId: "u_alice",
      source: "http",
      startedAt: ts,
      lastHeartbeatAt: ts
    });

    const result = await runAction({
      flow,
      actionName: "run",
      input: { ask: ["req_sibling", "req_never_existed"] },
      userId: "u_alice",
      sessionId: "s_e2e",
      stores,
      runtimeConfig: { requestHost: HEALTHY_LIVENESS }
    });

    expect(result.error).toBeUndefined();
    expect(seen).toHaveLength(1);
    // The live one is live because it is really registered; the other is not
    // because it really is not. Deleting the register() call above flips the
    // first assertion, which is what makes this a real read.
    expect(seen[0]).toEqual({ req_sibling: true, req_never_existed: false });
  });

  it("OFF STATE: on a per-process registry the liveness capability is absent and the block is refused", async () => {
    // The shipped default. The block asks for a capability the deployment
    // cannot support, and must fail loudly rather than get a wrong answer.
    let sawCapability: unknown = "unset";

    const probe = handler({
      name: "probe-off",
      inputSchema: z.object({}),
      outputSchema: z.boolean(),
      execute: async (_input, ctx) => {
        const host = requireRequestHost(ctx);
        sawCapability = host.livenessOf;
        // Deliberately unguarded: a deployment that cannot answer must not let
        // this look like it worked.
        await host.livenessOf!(["req_x"]);
        return true;
      }
    });

    const flow = defineFlow({
      kind: "seam-e2e-off",
      actions: { run: { block: probe } },
      request: { heartbeatIntervalMs: 10_000 }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u_alice",
      sessionId: "s_off",
      // In-memory registry: declares itself NOT shared.
      stores: createInMemoryStores(),
      runtimeConfig: { requestHost: HEALTHY_LIVENESS }
    });

    expect(sawCapability).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it("OFF STATE: a host that wired no seam at all makes the accessor throw BY NAME", async () => {
    let message = "";

    const probe = handler({
      name: "probe-none",
      inputSchema: z.object({}),
      outputSchema: z.boolean(),
      execute: async (_input, ctx) => {
        try {
          requireRequestHost(ctx);
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
          throw err;
        }
        return true;
      }
    });

    const flow = defineFlow({
      kind: "seam-e2e-none",
      actions: { run: { block: probe } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u_alice",
      sessionId: "s_none",
      stores: createInMemoryStores(),
      // No `requestHost` construction inputs at all.
      runtimeConfig: {}
    });

    expect(result.error).toBeDefined();
    // Not "undefined is not a function" — the whole point of the accessor.
    expect(message).toMatch(/runtime host/i);
    expect(message).not.toMatch(/undefined is not a function/i);
  });

  it("start-or-adopt refuses BY NAME when the flow declares no workstream core", async () => {
    let refusal: unknown;

    const probe = handler({
      name: "probe-spawn",
      inputSchema: z.object({}),
      outputSchema: z.boolean(),
      execute: async (_input, ctx) => {
        const host = requireRequestHost(ctx);
        refusal = await host.startDetached({ seed: { topic: "review" }, input: {} });
        return true;
      }
    });

    const flow = defineFlow({
      kind: "seam-e2e-spawn",
      actions: { run: { block: probe } }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u_alice",
      sessionId: "s_spawn",
      stores: createInMemoryStores(),
      runtimeConfig: { requestHost: HEALTHY_LIVENESS }
    });

    expect(result.error).toBeUndefined();
    // The *off* state of admission: no core, so a named refusal — and crucially
    // NOT a dispatch that fell through to the flow's own `run` action.
    expect(refusal).toMatchObject({ ok: false, refused: "no-workstream-core" });
  });
});

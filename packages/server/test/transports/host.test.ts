/**
 * Direct tests for the `InboundTransportHost`. These do not stand up an
 * HTTP server — they call `host.dispatch` and `host.resolvePrincipal`
 * directly with synthetic envelopes.
 */
import { describe, it, expect, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  createResponseEmitter,
  defaultBodyUserIdPrincipalResolver,
  OrgRequiredError,
  PrincipalResolutionError
} from "../../src";
import type { FlowDispatcher } from "../../src/transports/dispatcher";

function buildHost(opts?: { withOrgFlow?: boolean; dispatcher?: FlowDispatcher }) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(
    defineFlow({
      kind: "host-test",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler<{ value: string }, { ok: true }>({
            name: "host-test-run",
            execute: () => ({ ok: true })
          })
        }
      }
    })({ id: "host-test" })
  );

  if (opts?.withOrgFlow) {
    registry.register(
      defineFlow({
        kind: "org-required",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler<{ value: string }, { ok: true }>({
              name: "org-required-run",
              requireOrg: true,
              execute: () => ({ ok: true })
            })
          }
        }
      })({ id: "org-required" })
    );
  }

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    dispatcher: opts?.dispatcher
  });
  return { host, stores, registry };
}

describe("createInboundTransportHost", () => {
  it("dispatch propagates source onto the RequestRecord", async () => {
    const { host, stores } = buildHost();

    const handle = host.dispatch({
      source: "webhook",
      flowKind: "host-test",
      action: "run",
      input: { value: "hello" },
      principal: { userId: "u_host" }
    });

    expect(handle.requestId).toBeTypeOf("string");
    await handle.finished;

    const record = await stores.request.get(handle.requestId);
    expect(record?.source).toBe("webhook");
    expect(record?.userId).toBe("u_host");
  });

  it("dispatch returns a usable liveStream by default", async () => {
    const { host } = buildHost();
    const handle = host.dispatch({
      source: "test",
      flowKind: "host-test",
      action: "run",
      input: { value: "live" },
      principal: { userId: "u_live" }
    });
    expect(handle.liveStream).not.toBeNull();
    await handle.finished;
  });

  it("dispatch with responseEmitter:null skips the live stream", async () => {
    const { host } = buildHost();
    const handle = host.dispatch({
      source: "scheduled",
      flowKind: "host-test",
      action: "run",
      input: { value: "fire-and-forget" },
      principal: { userId: "u_sched" },
      responseEmitter: null
    });
    expect(handle.liveStream).toBeNull();
    await handle.finished;
  });

  it("dispatch with a caller-provided responseEmitter does not create a live stream", async () => {
    const { host } = buildHost();
    const customEmitter = createResponseEmitter({ requestId: "req_custom" });
    const handle = host.dispatch({
      source: "mcp",
      flowKind: "host-test",
      action: "run",
      input: { value: "byo-emitter" },
      principal: { userId: "u_byo" },
      responseEmitter: customEmitter
    });
    expect(handle.liveStream).toBeNull();
    expect(handle.responseEmitter).toBe(customEmitter);
    await handle.finished;
  });

  it("dispatch throws synchronously for unknown flowKind", () => {
    const { host } = buildHost();
    expect(() =>
      host.dispatch({
        source: "test",
        flowKind: "no-such-flow",
        action: "run",
        input: {},
        principal: { userId: "u" }
      })
    ).toThrow(/Unknown flow/);
  });

  it("resolvePrincipal raises PrincipalResolutionError when userId is missing", async () => {
    const { host } = buildHost();
    await expect(
      host.resolvePrincipal({
        source: "http",
        envelope: {
          flowKind: "host-test",
          action: "run",
          input: {},
          metadata: { body: {} }
        }
      })
    ).rejects.toBeInstanceOf(PrincipalResolutionError);
  });

  it("resolvePrincipal returns userId from body metadata", async () => {
    const { host } = buildHost();
    const principal = await host.resolvePrincipal({
      source: "http",
      envelope: {
        flowKind: "host-test",
        action: "run",
        input: {},
        metadata: { body: { userId: "u_body", orgId: "o_1" } }
      }
    });
    expect(principal).toEqual({ userId: "u_body", orgId: "o_1" });
  });

  describe("validateDispatch — requiresOrg", () => {
    it("resolves for flows without requiresOrg", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: {},
          principal: { userId: "u" }
        })
      ).resolves.toBeUndefined();
    });

    it("resolves when envelope.orgId is present", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "org-required",
          action: "run",
          input: {},
          orgId: "o_1",
          principal: { userId: "u" }
        })
      ).resolves.toBeUndefined();
    });

    it("resolves when principal.orgId is present", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "org-required",
          action: "run",
          input: {},
          principal: { userId: "u", orgId: "o_principal" }
        })
      ).resolves.toBeUndefined();
    });

    it("resolves when stored session has orgId", async () => {
      const { host, stores } = buildHost({ withOrgFlow: true });
      const now = Date.now();
      await stores.session.set(
        "s_org",
        {
          id: "s_org",
          userId: "u",
          flowKind: "org-required",
          orgId: "o_stored",
          state: {},
          version: 1,
          createdAt: now,
          updatedAt: now,
          journal: []
        },
        0
      );
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "org-required",
          action: "run",
          input: {},
          sessionId: "s_org",
          principal: { userId: "u" }
        })
      ).resolves.toBeUndefined();
    });

    it("throws OrgRequiredError when no org and no session", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "org-required",
          action: "run",
          input: {},
          principal: { userId: "u" }
        })
      ).rejects.toThrow(OrgRequiredError);
    });

    it("throws OrgRequiredError when session lacks orgId", async () => {
      const { host, stores } = buildHost({ withOrgFlow: true });
      const now = Date.now();
      await stores.session.set(
        "s_no_org",
        {
          id: "s_no_org",
          userId: "u",
          flowKind: "org-required",
          state: {},
          version: 1,
          createdAt: now,
          updatedAt: now,
          journal: []
        },
        0
      );
      await expect(
        host.validateDispatch({
          source: "scheduled",
          flowKind: "org-required",
          action: "run",
          input: {},
          sessionId: "s_no_org",
          principal: { userId: "u" }
        })
      ).rejects.toThrow(OrgRequiredError);
    });

    it("carries flowKind on the error", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      try {
        await host.validateDispatch({
          source: "http",
          flowKind: "org-required",
          action: "run",
          input: {},
          principal: { userId: "u" }
        });
        expect.unreachable("should throw");
      } catch (e) {
        expect(e).toBeInstanceOf(OrgRequiredError);
        expect((e as OrgRequiredError).flowKind).toBe("org-required");
      }
    });

    it("throws for unknown flow", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "nonexistent",
          action: "run",
          input: {},
          principal: { userId: "u" }
        })
      ).rejects.toThrow(/Unknown flow/);
    });

    it("throws OrgRequiredError for org-required flow when non-HTTP source provides no org", async () => {
      const { host } = buildHost({ withOrgFlow: true });
      await expect(
        host.validateDispatch({
          source: "scheduled",
          flowKind: "org-required",
          action: "run",
          input: {},
          principal: { userId: "u" }
        })
      ).rejects.toThrow(OrgRequiredError);
    });
  });

  describe("external dispatch — enqueue-time materialization (FIX-828)", () => {
    it("registers activeRequests + an in_progress record before handing off to the dispatcher", async () => {
      let storesAtDispatch: { active: boolean; status?: string } | undefined;
      // The fake worker never starts: it reads the stores at the instant it is
      // handed the job, then leaves `finished` pending forever.
      const dispatch = vi.fn(async (env: { requestId: string }) => {
        const active = await stores.activeRequests.get(env.requestId);
        const record = await stores.request.get(env.requestId);
        storesAtDispatch = { active: active !== undefined, status: record?.status };
        return {
          requestId: env.requestId,
          finished: new Promise<never>(() => {}),
          abort: () => {}
        };
      });
      const dispatcher: FlowDispatcher = { dispatch, close: vi.fn(async () => {}) };
      const { host, stores } = buildHost({ dispatcher });

      const handle = host.dispatch({
        source: "http",
        flowKind: "host-test",
        action: "run",
        input: { value: "x" },
        sessionId: "s_ext",
        principal: { userId: "u_ext" }
      });

      // The record + registry entry are present immediately after dispatch
      // returns — the GET stream route can resolve them without waiting.
      const record = await stores.request.get(handle.requestId);
      expect(record?.status).toBe("in_progress");
      expect(record?.sessionId).toBe("s_ext");
      expect(record?.userId).toBe("u_ext");
      expect(await stores.activeRequests.get(handle.requestId)).toBeDefined();

      // And the writes landed before the dispatcher was handed the job: the
      // fake reads both stores at the instant it is invoked.
      await vi.waitFor(() => expect(storesAtDispatch).toBeDefined());
      expect(storesAtDispatch).toEqual({ active: true, status: "in_progress" });
    });

    it("does not pre-materialize for in-process dispatch — runAction owns the record", async () => {
      const { host, stores } = buildHost();
      const setSpy = vi.spyOn(stores.request, "set");

      const handle = host.dispatch({
        source: "http",
        flowKind: "host-test",
        action: "run",
        input: { value: "x" },
        sessionId: "s_inproc",
        principal: { userId: "u_inproc" }
      });

      // The host did not write the record synchronously; in-process dispatch
      // defers record creation to runAction/createExecutionContext.
      expect(setSpy).not.toHaveBeenCalled();

      await handle.finished;
      // After execution the record exists — written by the runtime, not the host.
      expect(await stores.request.get(handle.requestId)).toBeDefined();
    });
  });
});

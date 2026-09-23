/**
 * Direct tests for the `InboundTransportHost`. These do not stand up an
 * HTTP server — they call `host.dispatch` and `host.resolvePrincipal`
 * directly with synthetic envelopes.
 */
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  createResponseEmitter,
  defaultBodyUserIdPrincipalResolver,
  OrgRequiredError,
  PrincipalResolutionError
} from "../../src";
import type { FlowDispatcher } from "../../src/transports/dispatcher";
import type { ResumeContext } from "@flow-state-dev/core/types";

function buildHost(opts?: { dispatcher?: FlowDispatcher }) {
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

    // A caller-addressed custom transport source — not one of the framework's
    // reserved event sources (`webhook`/`chat`/`scheduled`), which resolution
    // now reads by coordinate rather than falling back to `flow.actions[name]`
    // when the caller supplies none.
    const handle = host.dispatch({
      source: "custom-transport",
      flowKind: "host-test",
      action: "run",
      input: { value: "hello" },
      principal: { userId: "u_host", orgId: "org_test" }
    });

    expect(handle.requestId).toBeTypeOf("string");
    await handle.finished;

    const record = await stores.request.get(handle.requestId);
    expect(record?.source).toBe("custom-transport");
    expect(record?.userId).toBe("u_host");
  });

  it("continueRequest registers background work so the resumed run is kept alive (Vercel waitUntil)", async () => {
    // Regression: the resume route returns 202 without awaiting the inline
    // continuation. On a freeze-after-response platform (Vercel, no BullMQ) the
    // run only survives if its `finished` promise is handed to `onBackgroundWork`
    // (→ Next `after()` / waitUntil). `dispatch` did this; `continueRequest`
    // didn't, so resumes appeared to hang until a later invocation thawed the
    // container. Assert continueRequest now registers its background work too.
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

    const gate = handler<{ value: string }, unknown>({
      name: "gate",
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "approve?" })
    });
    registry.register(
      defineFlow({
        kind: "durable-host-test",
        actions: {
          run: {
            durable: true,
            inputSchema: z.object({ value: z.string() }),
            block: sequencer({
              name: "seq",
              durable: true,
              inputSchema: z.object({ value: z.string() })
            }).step(gate)
          }
        }
      })({ id: "durable-host-test" })
    );

    const onBackgroundWork = vi.fn();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      // onBackgroundWork lives on runtimeConfig (→ Next `after()` / waitUntil).
      runtimeConfig: { durabilityProvider: provider, onBackgroundWork }
    });

    // Dispatch → suspends at the gate. (dispatch registers its own background work.)
    const handle = host.dispatch({
      source: "http",
      flowKind: "durable-host-test",
      action: "run",
      input: { value: "x" },
      principal: { userId: "u1", orgId: "org_test" },
      sessionId: "s1"
    });
    await handle.finished;
    const callsAfterDispatch = onBackgroundWork.mock.calls.length;
    expect(callsAfterDispatch).toBeGreaterThanOrEqual(1);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    expect(suspension).toBeDefined();
    await provider.suspend({ ...suspension, status: "approved", resolvedAt: Date.now() });
    const resumeContext: ResumeContext = {
      suspensionId: suspension.suspensionId,
      action: "approve"
    };

    const resumed = await host.continueRequest({
      requestId: handle.requestId,
      resumeContext
    });
    await resumed.finished;

    // The fix: continueRequest registered its `finished` with onBackgroundWork.
    expect(onBackgroundWork.mock.calls.length).toBeGreaterThan(callsAfterDispatch);
    const lastArg = onBackgroundWork.mock.calls.at(-1)?.[0];
    expect(typeof (lastArg as { then?: unknown })?.then).toBe("function");
  });

  it("dispatch does not throw when onBackgroundWork throws, because the run has already started", async () => {
    // `onBackgroundWork` is adapter-supplied and is called after the in-process
    // run is under way — Next's `after()` and `waitUntil` both throw
    // synchronously when called outside a request scope. Letting that escape
    // would make a synchronous throw from `dispatch` ambiguous, and
    // `createDetachedStartOperation` and `createDispatchOperation` read it as "nothing was
    // dispatched" before its caller settles the row it handed over (FIX-982).
    const registry = createFlowRegistry();
    const stores = createInMemoryStores();
    registry.register(
      defineFlow({
        kind: "keepalive-test",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler<{ value: string }, { ok: true }>({
              name: "keepalive-run",
              execute: () => ({ ok: true })
            })
          }
        }
      })({ id: "keepalive-test" })
    );

    const error = vi.fn();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {
        logger: { error },
        onBackgroundWork: () => {
          throw new Error("after() was called outside a request scope");
        }
      }
    });

    const handle = host.dispatch({
      source: "http",
      flowKind: "keepalive-test",
      action: "run",
      input: { value: "hello" },
      principal: { userId: "u_keepalive", orgId: "org_test" }
    });

    // The run the hook failed to register still ran, and the handle is usable.
    await expect(handle.finished).resolves.toBeDefined();
    expect(await stores.request.get(handle.requestId)).toBeDefined();

    // Swallowed, not hidden: the keep-alive failure is real on a
    // freeze-after-response platform, so it is reported at the seam that saw it.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/onBackgroundWork threw/);
  });

  it("dispatch returns a usable liveStream by default", async () => {
    const { host } = buildHost();
    const handle = host.dispatch({
      source: "test",
      flowKind: "host-test",
      action: "run",
      input: { value: "live" },
      principal: { userId: "u_live", orgId: "org_test" }
    });
    expect(handle.liveStream).not.toBeNull();
    await handle.finished;
  });

  it("dispatch with responseEmitter:null skips the live stream", async () => {
    const { host } = buildHost();
    // A caller-addressed custom scheduler source — not the framework's
    // reserved `scheduled` event source, which needs a `metadata.schedule`
    // coordinate to resolve at all now that there is no name fallback.
    const handle = host.dispatch({
      source: "custom-scheduler",
      flowKind: "host-test",
      action: "run",
      input: { value: "fire-and-forget" },
      principal: { userId: "u_sched", orgId: "org_test" },
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
      principal: { userId: "u_byo", orgId: "org_test" },
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
        principal: { userId: "u", orgId: "org_test" }
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

  it("resolvePrincipal returns userId from body metadata, and ignores a body orgId", async () => {
    // The default resolver used to read `body.orgId` too, so an app with no
    // authentication let its callers name their own organization. That is the
    // one thing organization identity must never come from (FIX-1442): the
    // body is written by whoever is calling. The userId still comes from it —
    // that is what this resolver IS, and such an app was already trusting it —
    // but the organization is the framework's to supply.
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
    expect(principal).toEqual({ userId: "u_body", orgId: DEFAULT_ORG_ID });
  });

  describe("validateDispatch — the envelope carries an organization (FIX-1442)", () => {
    // The `requiresOrg` matrix this replaces asked whether THIS FLOW had opted
    // into needing an organization, and then went looking for one on the
    // envelope, the principal, or the stored session. All three of those
    // questions are gone: organization is unconditional, and principal
    // resolution cannot produce a principal without one. What is left for this
    // gate to catch is a call site that assembled an envelope and never went
    // through resolution — which is a framework-integration bug, not a caller
    // error, and must not reach a store.
    it("resolves an envelope whose principal carries an organization", async () => {
      const { host } = buildHost();
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: { value: "x" },
          principal: { userId: "u", orgId: "acme" }
        })
      ).resolves.toBeUndefined();
    });

    it("resolves when the envelope overrides the organization explicitly", async () => {
      const { host } = buildHost();
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: { value: "x" },
          orgId: "acme",
          principal: { userId: "u", orgId: "acme" }
        })
      ).resolves.toBeUndefined();
    });

    it("refuses an envelope that reached dispatch with no organization at all", async () => {
      const { host } = buildHost();
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: { value: "x" },
          principal: { userId: "u" } as never
        })
      ).rejects.toThrow(OrgRequiredError);
    });

    it("refuses a whitespace-only organization rather than accepting it as present", async () => {
      const { host } = buildHost();
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: { value: "x" },
          principal: { userId: "u", orgId: "   " }
        })
      ).rejects.toThrow(OrgRequiredError);
    });

    it("does not borrow an organization from the stored session to repair the envelope", async () => {
      const { host, stores } = buildHost();
      await stores.session.set(
        "s1",
        {
          id: "s1",
          flowKind: "host-test",
          flowId: "host-test",
          userId: "u",
          orgId: "acme",
          state: {},
          version: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          journal: []
        },
        "any"
      );

      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: { value: "x" },
          sessionId: "s1",
          principal: { userId: "u" } as never
        })
      ).rejects.toThrow(OrgRequiredError);
    });

    it("carries flowKind on the error", async () => {
      const { host } = buildHost();
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "host-test",
          action: "run",
          input: { value: "x" },
          principal: { userId: "u" } as never
        })
      ).rejects.toMatchObject({ flowKind: "host-test" });
    });

    it("throws for unknown flow", async () => {
      const { host } = buildHost();
      await expect(
        host.validateDispatch({
          source: "http",
          flowKind: "nope",
          action: "run",
          input: {},
          principal: { userId: "u", orgId: "acme" }
        })
      ).rejects.toThrow(/Unknown flow/);
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
        principal: { userId: "u_ext", orgId: "org_test" }
      });

      // The record + registry entry are present once the request is accepted
      // — the same signal the 202 path acks on; admission reads the addressed
      // session's owner before either write lands.
      await handle.accepted;
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

    it("rejects `accepted` only after the dispatcher accepts the job", async () => {
      // `accepted` must cover the enqueue, not just the store writes — the
      // response path acks the 202 on it, so the enqueue has to be inside.
      let dispatchCalled = false;
      const dispatcher: FlowDispatcher = {
        dispatch: vi.fn(async (env: { requestId: string }) => {
          dispatchCalled = true;
          return {
            requestId: env.requestId,
            finished: new Promise<never>(() => {}),
            abort: () => {}
          };
        }),
        close: vi.fn(async () => {})
      };
      const { host } = buildHost({ dispatcher });

      const handle = host.dispatch({
        source: "http",
        flowKind: "host-test",
        action: "run",
        input: { value: "x" },
        sessionId: "s_acc",
        principal: { userId: "u_acc", orgId: "org_test" }
      });

      await handle.accepted;
      expect(dispatchCalled).toBe(true);
    });

    it("terminates the in_progress record when the enqueue fails, leaving no orphan", async () => {
      // The writes succeed, then the dispatcher hand-off rejects. `accepted`
      // covers the enqueue, so it rejects — and the record must not linger
      // in_progress: the dispatch teardown deregisters the activeRequests entry,
      // so without cleanup the stale-request sweeper would have nothing to reap.
      const dispatcher: FlowDispatcher = {
        dispatch: vi.fn(async () => {
          throw new Error("enqueue failed");
        }),
        close: vi.fn(async () => {})
      };
      const { host, stores } = buildHost({ dispatcher });

      const handle = host.dispatch({
        source: "http",
        flowKind: "host-test",
        action: "run",
        input: { value: "x" },
        sessionId: "s_fail",
        principal: { userId: "u_fail", orgId: "org_test" }
      });

      await expect(handle.accepted).rejects.toThrow("enqueue failed");
      await expect(handle.finished).rejects.toThrow("enqueue failed");

      expect((await stores.request.get(handle.requestId))?.status).toBe("failed");
      expect(await stores.activeRequests.get(handle.requestId)).toBeUndefined();
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
        principal: { userId: "u_inproc", orgId: "org_test" }
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

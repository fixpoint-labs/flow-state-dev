/**
 * Direct tests for the `InboundTransportHost`. These do not stand up an
 * HTTP server — they call `host.dispatch` and `host.resolvePrincipal`
 * directly with synthetic envelopes.
 */
import { describe, it, expect } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  createResponseEmitter,
  defaultBodyUserIdPrincipalResolver,
  PrincipalResolutionError
} from "../../src";

function buildHost(extras?: { source?: string }) {
  void extras;
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
    runtimeConfig: {}
  });
  return { host, stores };
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
});

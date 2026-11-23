/**
 * The inbound host refuses an envelope that names no session, by name and
 * before it writes anything: no queued stub, no active-request entry, and no
 * job handed to an external runner. A transport that starts a run belonging
 * to no conversation makes the id itself (`oneOffSessionId()`).
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowRegistry, defaultBodyUserIdPrincipalResolver } from "../../src";
import { createInboundTransportHost, createInMemoryStores, SessionRequiredError } from "../../src/host";
import type { FlowRunner } from "../../src/transports/runner";
import type { InboundRequestEnvelope } from "../../src/transports/types";

function buildHost(runner?: FlowRunner) {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(
    defineFlow({
      kind: "host-session",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({ name: "host-session-run", execute: () => ({ ok: true }) })
        }
      }
    })({ id: "host-session" })
  );
  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {},
    ...(runner !== undefined ? { runner } : {})
  });
  return { host, stores };
}

const noSession = {
  source: "custom-transport",
  flowKind: "host-session",
  action: "run",
  input: {},
  requestId: "req_no_session",
  principal: { userId: "u", orgId: "org_test" }
} as unknown as InboundRequestEnvelope;

describe("host.dispatch with no session id", () => {
  it.each([
    ["the in-process runner", undefined],
    ["an external runner", { dispatch: vi.fn(), close: vi.fn(async () => {}) } as unknown as FlowRunner]
  ])("refuses by name on %s, before the queued stub", async (_name, runner) => {
    const { host, stores } = buildHost(runner);
    expect(() => host.dispatch(noSession)).toThrow(SessionRequiredError);
    expect(await stores.request.get("req_no_session")).toBeUndefined();
    expect(await stores.activeRequests.listAll()).toEqual([]);
    expect(await stores.session.list()).toEqual([]);
    if (runner !== undefined) expect(runner.dispatch).not.toHaveBeenCalled();
  });
});

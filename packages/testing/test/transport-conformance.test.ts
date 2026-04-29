/**
 * Smoke test for the inbound transport conformance harness. Wires the
 * harness against a minimal synthetic adapter and confirms the suite
 * runs end-to-end.
 */
import {
  createHttpTransportAdapter,
  HTTP_TRANSPORT_SOURCE
} from "@flow-state-dev/server";
import {
  createInboundTransportConformanceTests
} from "../src";

createInboundTransportConformanceTests({
  name: "createHttpTransportAdapter",
  factory: () =>
    createHttpTransportAdapter({
      handle: async () => new Response(null, { status: 204 })
    }),
  helpers: {
    buildEnvelope: async (adapter, host) => {
      const principal = await host.resolvePrincipal({
        source: adapter.source,
        envelope: {
          flowKind: "demo",
          action: "run",
          input: {},
          metadata: { body: { userId: "u_conform" } }
        }
      });
      return {
        source: adapter.source,
        flowKind: "demo",
        action: "run",
        input: { value: "x" },
        principal
      };
    }
  }
});

import { describe, it, expect } from "vitest";
describe("HTTP_TRANSPORT_SOURCE", () => {
  it('is the documented value "http"', () => {
    expect(HTTP_TRANSPORT_SOURCE).toBe("http");
  });
});

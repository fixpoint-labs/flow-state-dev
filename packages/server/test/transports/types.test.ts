/**
 * Type-level smoke tests for the inbound transport adapter contract.
 * These compile-only assertions confirm the surface is implementable.
 */
import { describe, it, expect } from "vitest";
import type {
  InboundTransportAdapter,
  InboundTransportHost,
  InboundRequestEnvelope,
  TransportBindings,
  ResolvedPrincipal,
  PrincipalResolutionContext
} from "../../src";

describe("inbound transport contract types", () => {
  it("a minimal adapter is implementable", () => {
    const adapter: InboundTransportAdapter = {
      source: "test",
      createBindings(_host: InboundTransportHost): TransportBindings {
        return {
          routes: [
            {
              method: "POST",
              path: "/api/flows/test/echo",
              handler: async () => new Response("ok")
            }
          ]
        };
      }
    };
    expect(adapter.source).toBe("test");
  });

  it("envelope and principal types compose", () => {
    const principal: ResolvedPrincipal = { userId: "u1" };
    const envelope: InboundRequestEnvelope = {
      source: "test",
      flowKind: "demo",
      action: "run",
      input: { value: "x" },
      principal,
      metadata: { foo: "bar" }
    };
    expect(envelope.source).toBe("test");
  });

  it("principal-resolution context is constructable", () => {
    const ctx: PrincipalResolutionContext = {
      source: "test",
      envelope: {
        flowKind: "demo",
        action: "run",
        input: undefined
      }
    };
    expect(ctx.source).toBe("test");
  });
});

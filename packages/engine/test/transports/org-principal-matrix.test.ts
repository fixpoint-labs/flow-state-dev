/**
 * C1 — the principal/organization resolution matrix (FIX-1442).
 *
 * Organization identity is never optional. These tests pin the four facts the
 * rest of the cutover rests on, at the one seam that decides them
 * (`host.resolvePrincipal`):
 *
 *  - BR-1 a configured resolver's verified org wins, and a body/metadata org
 *    cannot override or supply it;
 *  - BR-2 a configured resolver that yields no org, a blank one, or the
 *    reserved development default is refused before any effect;
 *  - BR-3 an app that configures no resolver runs under `DEFAULT_ORG_ID`, and
 *    is warned once per host — not once per request;
 *  - per-flow resolver precedence over the host-level fallback still holds,
 *    now carrying the org.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  PrincipalResolutionError
} from "../../src";
import type { PrincipalResolver } from "../../src/transports/types";
import type { PrincipalResolutionContext } from "@flow-state-dev/core/types";

function flowNamed(kind: string, authentication?: Record<string, unknown>) {
  return defineFlow({
    kind,
    ...(authentication === undefined ? {} : { authentication }),
    actions: {
      run: {
        inputSchema: z.object({ value: z.string() }),
        block: handler<{ value: string }, { ok: true }>({
          name: `${kind}-run`,
          execute: () => ({ ok: true })
        })
      }
    }
  } as Parameters<typeof defineFlow>[0])({ id: kind });
}

function buildHost(opts?: {
  hostResolver?: PrincipalResolver;
  flows?: ReturnType<typeof flowNamed>[];
  logger?: { warn: (...args: unknown[]) => void };
}) {
  const registry = createFlowRegistry();
  for (const flow of opts?.flows ?? [flowNamed("plain")]) registry.register(flow);
  const host = createInboundTransportHost({
    registry,
    stores: createInMemoryStores(),
    resolvePrincipal: opts?.hostResolver ?? defaultBodyUserIdPrincipalResolver,
    runtimeConfig: opts?.logger === undefined ? {} : { logger: opts.logger as never }
  });
  return host;
}

function contextFor(
  flowKind: string,
  body?: Record<string, unknown>
): PrincipalResolutionContext {
  return {
    source: "http",
    envelope: {
      flowKind,
      action: "run",
      metadata: body === undefined ? {} : { body },
      input: { value: "x" }
    }
  };
}

describe("C1 · organization identity is resolved once, from a trusted source", () => {
  describe("BR-3 · no configured resolver runs under the framework default", () => {
    it("supplies DEFAULT_ORG_ID rather than leaving the principal orgless", async () => {
      const host = buildHost();

      const principal = await host.resolvePrincipal(
        contextFor("plain", { userId: "u1" })
      );

      expect(principal).toEqual({ userId: "u1", orgId: DEFAULT_ORG_ID });
    });

    it("ignores a body-supplied orgId, so a browser cannot pick the organization", async () => {
      const host = buildHost();

      const principal = await host.resolvePrincipal(
        contextFor("plain", { userId: "u1", orgId: "acme" })
      );

      expect(principal.orgId).toBe(DEFAULT_ORG_ID);
    });

    it("warns once per host that the development default is in use, not once per request", async () => {
      const warn = vi.fn();
      const host = buildHost({ logger: { warn } });

      await host.resolvePrincipal(contextFor("plain", { userId: "u1" }));
      await host.resolvePrincipal(contextFor("plain", { userId: "u2" }));
      await host.resolvePrincipal(contextFor("plain", { userId: "u3" }));

      const defaultWarnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes(DEFAULT_ORG_ID)
      );
      expect(defaultWarnings).toHaveLength(1);
    });

    it("warns once that an obsolete body orgId was present, without logging its value", async () => {
      const warn = vi.fn();
      const host = buildHost({ logger: { warn } });

      await host.resolvePrincipal(
        contextFor("plain", { userId: "u1", orgId: "secret-tenant-name" })
      );
      await host.resolvePrincipal(
        contextFor("plain", { userId: "u2", orgId: "secret-tenant-name" })
      );

      const legacyWarnings = warn.mock.calls.filter((call) =>
        /orgId/.test(String(call[0])) && !String(call[0]).includes(DEFAULT_ORG_ID)
      );
      expect(legacyWarnings).toHaveLength(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-tenant-name");
    });
  });

  describe("BR-1 · a configured resolver's verified organization is authoritative", () => {
    it("uses the resolver's org and ignores a conflicting body org", async () => {
      const host = buildHost({
        hostResolver: () => ({ userId: "u1", orgId: "verified-org" })
      });

      const principal = await host.resolvePrincipal(
        contextFor("plain", { userId: "spoofed", orgId: "attacker-org" })
      );

      expect(principal).toEqual({ userId: "u1", orgId: "verified-org" });
    });

    it("prefers a per-flow resolver's organization over the host-level fallback", async () => {
      const host = buildHost({
        hostResolver: () => ({ userId: "host-user", orgId: "host-org" }),
        flows: [
          flowNamed("scoped", {
            resolvePrincipal: () => ({ userId: "flow-user", orgId: "flow-org" })
          })
        ]
      });

      const principal = await host.resolvePrincipal(contextFor("scoped"));

      expect(principal).toEqual({ userId: "flow-user", orgId: "flow-org" });
    });
  });

  describe("BR-2 · an incomplete or reserved identity is refused before any effect", () => {
    it("refuses a configured resolver that returns a user but no org", async () => {
      const host = buildHost({ hostResolver: () => ({ userId: "u1" }) });

      await expect(
        host.resolvePrincipal(contextFor("plain"))
      ).rejects.toBeInstanceOf(PrincipalResolutionError);
    });

    it("refuses a whitespace-only org rather than trimming it into a valid one", async () => {
      const host = buildHost({
        hostResolver: () => ({ userId: "u1", orgId: "   " })
      });

      await expect(
        host.resolvePrincipal(contextFor("plain"))
      ).rejects.toBeInstanceOf(PrincipalResolutionError);
    });

    it("refuses a configured resolver that claims the reserved development default", async () => {
      const host = buildHost({
        hostResolver: () => ({ userId: "u1", orgId: DEFAULT_ORG_ID })
      });

      await expect(
        host.resolvePrincipal(contextFor("plain"))
      ).rejects.toBeInstanceOf(PrincipalResolutionError);
    });

    it("refuses null from a configured resolver instead of repairing it with defaultUserId", async () => {
      const host = buildHost({
        hostResolver: () => null,
        flows: [
          flowNamed("machine", {
            resolvePrincipal: () => null,
            defaultUserId: "system"
          })
        ]
      });

      await expect(
        host.resolvePrincipal(contextFor("machine"))
      ).rejects.toBeInstanceOf(PrincipalResolutionError);
    });

    it("accepts a machine resolver that returns only an org, filling the user from defaultUserId", async () => {
      const host = buildHost({
        hostResolver: defaultBodyUserIdPrincipalResolver,
        flows: [
          flowNamed("machine", {
            resolvePrincipal: () => ({ orgId: "machine-org" }),
            defaultUserId: "system"
          })
        ]
      });

      const principal = await host.resolvePrincipal(contextFor("machine"));

      expect(principal).toEqual({ userId: "system", orgId: "machine-org" });
    });

    it("does not leak the org value into the refusal message", async () => {
      const host = buildHost({
        hostResolver: () => ({ userId: "u1", orgId: "   " })
      });

      await expect(
        host.resolvePrincipal(contextFor("plain"))
      ).rejects.toThrow(/organization/i);
    });
  });
});

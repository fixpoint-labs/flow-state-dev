/**
 * Host-level opt-in for public re-entry (FIX-999).
 *
 * Re-entry is an allow-list: `retry`, `continue` and `resume` admit `http`,
 * `mcp`, `chat` and `scheduled`, and refuse everything else with the same
 * not-found shape a missing request produces. That is the right default — a
 * deny-list admits every source nobody thought to name.
 *
 * But `InboundTransportAdapter.source` is an open string on purpose, so an
 * out-of-tree transport (the documented `echo` adapter, a vendor integration)
 * lands on a source the framework cannot know about, and its requests lose
 * retry, continue and resume with no way to get them back. The allow-list has
 * to be extensible by the deployment that owns the transport.
 *
 * Two things are pinned here, and the second is why the first is safe:
 *
 * - A host can name its own sources, and only those become re-enterable.
 * - The framework's two deliberately-excluded sources are NOT openable. A
 *   deployment reading "add it to the allow-list" would reasonably try
 *   `webhook`, and `workstream` is the detached-dispatch source whose entire
 *   security argument is that it has no caller-facing entry at all. Re-opening
 *   either hands an HTTP caller `inputOverride` on a handler that was never
 *   caller-addressed, which is the vulnerability the allow-list closed.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores } from "../src";
import { assertPublicReentrySources, isPublicReentryAllowed } from "../src/routes/public-reentry";
import { RELAY_SOURCE, WORKSTREAM_SOURCE } from "../src/execution/transport-sources";
import type { StoreRegistry } from "../src/stores/types";

/** The source an out-of-tree `InboundTransportAdapter` stamps on its requests. */
const CUSTOM_SOURCE = "echo";

function makeFlow() {
  return defineFlow({
    kind: "custom-transport",
    actions: {
      run: {
        inputSchema: z.object({ value: z.string().optional() }),
        block: handler({
          name: "run",
          inputSchema: z.object({ value: z.string().optional() }),
          execute: () => undefined
        })
      }
    }
  })({ id: "custom-transport" });
}

/** Seed a failed request that arrived on `source`, ready to be retried. */
async function seedFailedRequest(
  stores: StoreRegistry,
  requestId: string,
  source: string
): Promise<void> {
  const now = Date.now();
  await stores.request.set(
    requestId,
    {
      id: requestId,
      flowKind: "custom-transport",
      actionName: "run",
      sessionId: "sess_1",
      userId: "u_alice",
      source,
      status: "failed",
      startedAtMs: now,
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now
    },
    "any"
  );
}

async function retry(
  router: ReturnType<typeof createFlowApiRouter>,
  requestId: string
): Promise<Response> {
  return router.POST(
    new Request(
      `http://localhost/api/flows/custom-transport/sessions/sess_1/requests/${requestId}/retry`,
      { method: "POST", body: JSON.stringify({}) }
    ),
    {
      params: {
        path: ["custom-transport", "sessions", "sess_1", "requests", requestId, "retry"]
      }
    }
  );
}

describe("isPublicReentryAllowed — host-declared sources", () => {
  it("admits a source the host declared", () => {
    expect(isPublicReentryAllowed(CUSTOM_SOURCE, [CUSTOM_SOURCE])).toBe(true);
  });

  it("still refuses it when the host declared nothing — the default is unchanged", () => {
    expect(isPublicReentryAllowed(CUSTOM_SOURCE)).toBe(false);
    expect(isPublicReentryAllowed(CUSTOM_SOURCE, [])).toBe(false);
    expect(isPublicReentryAllowed(CUSTOM_SOURCE, ["other-transport"])).toBe(false);
  });

  it("keeps the built-ins admitted alongside the declared ones", () => {
    expect(isPublicReentryAllowed("http", [CUSTOM_SOURCE])).toBe(true);
    expect(isPublicReentryAllowed("mcp", [CUSTOM_SOURCE])).toBe(true);
  });

  it("refuses to re-open the framework's excluded sources, however they are declared", () => {
    // `webhook`'s handler is reachable only behind signature verification;
    // `workstream` has no caller-facing entry by construction. Neither is a
    // deployment's own transport, so neither is a deployment's to re-open.
    expect(isPublicReentryAllowed("webhook", ["webhook"])).toBe(false);
    expect(isPublicReentryAllowed(WORKSTREAM_SOURCE, [WORKSTREAM_SOURCE])).toBe(false);
  });
});

describe("createFlowApiRouter — publicReentrySources", () => {
  it("lets a declared source be retried", async () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow());
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({
      registry,
      stores,
      publicReentrySources: [CUSTOM_SOURCE]
    });

    await seedFailedRequest(stores, "req_custom", CUSTOM_SOURCE);

    expect((await retry(router, "req_custom")).status).toBe(202);
  });

  it("OTHER DIRECTION: the same request is refused when the host declares nothing", async () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow());
    const stores = createInMemoryStores();
    const router = createFlowApiRouter({ registry, stores });

    await seedFailedRequest(stores, "req_custom", CUSTOM_SOURCE);

    expect((await retry(router, "req_custom")).status).toBe(404);
  });

  it("refuses at construction when a host names an excluded source", () => {
    const registry = createFlowRegistry();
    registry.register(makeFlow());

    expect(() =>
      createFlowApiRouter({
        registry,
        stores: createInMemoryStores(),
        publicReentrySources: ["webhook", CUSTOM_SOURCE]
      })
    ).toThrow(/webhook/);
  });
});

describe("relay is never publicly re-enterable (FIX-1230)", () => {
  it("refuses a relay request by default", () => {
    expect(isPublicReentryAllowed(RELAY_SOURCE)).toBe(false);
  });

  // The half a default-configuration test cannot reach: relay is on the NEVER
  // list, not merely absent from the allow-list, so a deployment cannot opt in.
  // Retry's `inputOverride` feeds handler input, so opting in would hand a
  // caller control of the input to a request nobody outside the system
  // originated, which is the bypass the allow-list exists to close.
  it("stays refused even when a deployment names it in publicReentrySources", () => {
    expect(isPublicReentryAllowed(RELAY_SOURCE, [RELAY_SOURCE])).toBe(false);
  });

  it("refuses such a host at construction rather than silently dropping it", () => {
    expect(() => assertPublicReentrySources([RELAY_SOURCE])).toThrow(/relay/);
  });

  // Guards against blanket-deny: an ordinary caller-facing source must still be
  // re-enterable, or these tests would pass with the predicate broken.
  it("still admits an ordinary caller-facing source", () => {
    expect(isPublicReentryAllowed("http")).toBe(true);
  });
});

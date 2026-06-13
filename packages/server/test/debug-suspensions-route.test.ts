/**
 * Route-level tests for the FIX-141 operator-UI debug endpoint
 * (`GET /api/flows/sessions/:id/debug/suspensions`). Seeds the in-memory
 * suspensions store and invokes `handleDebugListSuspensions` directly, without
 * spinning up an HTTP server. Covers the gate, the `status` filter, the
 * session binding, and the empty-store case.
 */
import { describe, expect, it } from "vitest";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "../src";
import { createFlowRegistry } from "../src";
import type { StoreRegistry } from "../src/stores/types";
import type { FlowRegistry } from "../src/registry/flow-registry";
import {
  handleDebugListSuspensions,
  resolveDebugConfig,
  type ResolvedDebugConfig
} from "../src/routes/debug-routes";

const SESSION_ID = "sess_1";
const BASE = `http://localhost/api/flows/sessions/${SESSION_ID}/debug/suspensions`;

function makeRecord(overrides: Partial<SuspensionRecord>): SuspensionRecord {
  return {
    suspensionId: "sus_1",
    requestId: "req_1",
    flowKind: "chat",
    actionName: "ask",
    sessionId: SESSION_ID,
    userId: "user_1",
    reason: "human_approval",
    message: "Approve?",
    status: "pending",
    blockInstanceId: "block_1",
    stepIndex: 0,
    createdAt: 1000,
    ...overrides
  };
}

interface Ctx {
  registry: FlowRegistry;
  stores: StoreRegistry;
  debug: ResolvedDebugConfig;
}

async function setupCtx(
  records: SuspensionRecord[] = [],
  debugConfig?: Parameters<typeof resolveDebugConfig>[0]
): Promise<Ctx> {
  const stores = createInMemoryStores();
  const registry = createFlowRegistry();
  for (const record of records) {
    await stores.suspensions.set(record);
  }
  const debug = resolveDebugConfig(
    debugConfig ?? { debugEndpointsEnabled: true }
  );
  return { registry, stores, debug };
}

function makeReq(
  url: string,
  init?: { method?: string; headers?: Record<string, string> }
): Request {
  return new Request(url, {
    method: init?.method ?? "GET",
    headers: init?.headers
  });
}

describe("handleDebugListSuspensions (FIX-141)", () => {
  it("403s when debug endpoints are disabled", async () => {
    const ctx = await setupCtx([], { debugEndpointsEnabled: false });
    const res = await handleDebugListSuspensions(
      makeReq(BASE),
      { kind: "debug_list_suspensions", sessionId: SESSION_ID },
      ctx
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "debug_endpoints_disabled" });
  });

  it("403s for an off-host origin", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListSuspensions(
      makeReq(BASE, { headers: { origin: "https://evil.example" } }),
      { kind: "debug_list_suspensions", sessionId: SESSION_ID },
      ctx
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("debug_endpoints_origin_rejected");
  });

  it("returns [] when the suspensions store is empty", async () => {
    const ctx = await setupCtx();
    const res = await handleDebugListSuspensions(
      makeReq(BASE),
      { kind: "debug_list_suspensions", sessionId: SESSION_ID },
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suspensions: [] });
  });

  it("returns suspensions bound to the route's sessionId", async () => {
    const ctx = await setupCtx([
      makeRecord({ suspensionId: "a", requestId: "r1" }),
      makeRecord({
        suspensionId: "b",
        requestId: "r2",
        sessionId: "other_session"
      })
    ]);
    const res = await handleDebugListSuspensions(
      makeReq(BASE),
      { kind: "debug_list_suspensions", sessionId: SESSION_ID },
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspensions.map((s: SuspensionRecord) => s.suspensionId)).toEqual([
      "a"
    ]);
  });

  it("filters by status when ?status= is provided", async () => {
    const ctx = await setupCtx([
      makeRecord({ suspensionId: "pend", requestId: "r1", status: "pending" }),
      makeRecord({
        suspensionId: "appr",
        requestId: "r2",
        status: "approved",
        resolvedAt: 2000
      })
    ]);
    const res = await handleDebugListSuspensions(
      makeReq(`${BASE}?status=approved`),
      { kind: "debug_list_suspensions", sessionId: SESSION_ID },
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspensions.map((s: SuspensionRecord) => s.suspensionId)).toEqual([
      "appr"
    ]);
  });

  it("ignores an unrecognized status filter (returns all)", async () => {
    const ctx = await setupCtx([
      makeRecord({ suspensionId: "pend", requestId: "r1", status: "pending" }),
      makeRecord({
        suspensionId: "appr",
        requestId: "r2",
        status: "approved",
        resolvedAt: 2000
      })
    ]);
    const res = await handleDebugListSuspensions(
      makeReq(`${BASE}?status=bogus`),
      { kind: "debug_list_suspensions", sessionId: SESSION_ID },
      ctx
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspensions).toHaveLength(2);
  });
});

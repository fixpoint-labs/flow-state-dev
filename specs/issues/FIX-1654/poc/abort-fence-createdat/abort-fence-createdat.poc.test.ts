/**
 * FIX-1654 POC · does an abort fenced on `createdAt` stay on the request its
 * owner check read?
 *
 * Retained design evidence, not production code and not the regression case.
 * `run.sh` copies it into `packages/engine/test/` for the run and removes it.
 *
 * `POST …/requests/:id/abort` reads the record, checks the caller may reach it,
 * then writes `abortRequested` with `setFieldsIfStatus(…, record.createdAt)`.
 * Both cases change the record at the id between that read and that write,
 * through the real memory store and, for the second, the engine's real
 * same-owner hand-off. Each pins what `main` does today.
 *
 *  1. SAME MILLISECOND — another tenant's request takes the freed id in the
 *     same millisecond. Two requests, one `createdAt`: the fence cannot tell
 *     them apart, so the abort lands on the other tenant's run.
 *  2. SAME-OWNER HAND-OFF — the caller's own retry hands the record off,
 *     which rewrites `createdAt` and keeps the incarnation. One request, two
 *     `createdAt`s: the fence misses, and the owner is told the request does
 *     not exist while it keeps running.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createInMemoryStores } from "../src";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import { claimRequestRecord } from "../src/context/request-principal";
import { handleAbortRequest } from "../src/routes/abort-routes";
import { resolveRequestIncarnation } from "../src/stores/scope-keys";
import type { RequestRecord, StoreRegistry } from "../src/stores/types";

const ID = "req_reused";
const flow = defineFlow({
  kind: "chat",
  actions: {
    run: {
      inputSchema: z.unknown(),
      block: handler({ name: "noop", inputSchema: z.unknown(), execute: () => ({}) })
    }
  }
})({ id: "chat" });

const record = (tenantId: string | undefined, at: number): RequestRecord =>
  createInitialRequestRecord(
    { requestId: ID, flowKind: "chat", flowId: "chat", actionName: "run", userId: "user_1", tenantId },
    at
  );

/** Run the abort route, doing `between` after its owner-check read and before its write. */
async function abortWithInterleave(
  stores: StoreRegistry,
  tenantId: string | undefined,
  between: () => Promise<void>
): Promise<number> {
  const read = stores.request.get.bind(stores.request);
  stores.request.get = async (id: string) => {
    const seen = await read(id);
    await between();
    return seen;
  };
  try {
    const response = await handleAbortRequest(
      new Request(`http://localhost/api/flows/chat/requests/${ID}/abort`, { method: "POST" }),
      { kind: "abort_request", flowKind: "chat", requestId: ID },
      { stores, tenantId }
    );
    return response.status;
  } finally {
    stores.request.get = read;
  }
}

describe("FIX-1654 POC · the abort fence on createdAt, on main today", () => {
  it("SAME MILLISECOND: lands on another tenant's request that took the id", async () => {
    const stores = createInMemoryStores();
    const alice = record("tenant_a", 1_000);
    await stores.request.set(ID, alice, "absent");
    const bob = record("tenant_b", 1_000);

    const status = await abortWithInterleave(stores, "tenant_a", async () => {
      await stores.request.delete(ID);
      await stores.request.set(ID, bob, "absent");
    });

    const stored = (await stores.request.get(ID))!;
    const leaked = status === 202 && stored.abortRequested === true;
    console.log(
      `[SAME-MS] status=${status} stored-tenant=${stored.tenantId} ` +
        `same-createdAt=${alice.createdAt === bob.createdAt} ` +
        `same-incarnation=${alice.incarnation === bob.incarnation} other-tenant-aborted=${leaked}`
    );
    // Pins today's defect. After FIX-1654 this is a 404 and nothing is written.
    expect(leaked).toBe(true);
  });

  it("SAME-OWNER HAND-OFF: misses the owner's own running request", async () => {
    const stores = createInMemoryStores();
    await claimRequestRecord(stores, flow, record(undefined, 1_000));
    const before = (await stores.request.get(ID))!;

    const status = await abortWithInterleave(stores, undefined, async () => {
      await claimRequestRecord(stores, flow, record(undefined, 2_000));
    });

    const stored = (await stores.request.get(ID))!;
    console.log(
      `[HAND-OFF] status=${status} running=${stored.status} ` +
        `createdAt ${before.createdAt}->${stored.createdAt} ` +
        `incarnation-kept=${resolveRequestIncarnation(stored) === resolveRequestIncarnation(before)} ` +
        `abort-recorded=${stored.abortRequested === true}`
    );
    // Pins today's defect. After FIX-1654 this is a 202 and the intent is recorded.
    expect(status).toBe(404);
    expect(stored.status).toBe("in_progress");
    expect(stored.abortRequested).not.toBe(true);
  });
});

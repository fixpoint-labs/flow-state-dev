/**
 * The id a caller-supplied request id resolves to, and who owns a record.
 *
 * A supplied id is kept when it is free or already the caller's (a retry),
 * and replaced by the caller's own id when another principal holds it. That
 * replacement must be stable, so the caller's retries land on one request,
 * and distinct per caller, so two callers reusing one id never meet.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/host";
import { createInitialRequestRecord } from "../src/context/initial-request-record";
import { resolveCallerRequestId } from "../src/context/request-principal";
import { principalOwns, type Principal } from "../src/context/principal";

type Caller = Pick<Principal, "userId" | "orgId" | "tenantId">;

const ID = "req_client_chosen";
const alice: Caller = { userId: "alice", orgId: "org_1", tenantId: "t_1" };
const bob: Caller = { userId: "bob", orgId: "org_1", tenantId: "t_1" };

function recordFor(principal: Caller) {
  return createInitialRequestRecord(
    { requestId: ID, flowKind: "f", flowId: "f", actionName: "run", ...principal },
    Date.now()
  );
}

describe("resolveCallerRequestId", () => {
  it("keeps an id nobody holds", async () => {
    expect(await resolveCallerRequestId(createInMemoryStores(), ID, bob)).toBe(ID);
  });

  it("keeps an id the caller already holds, so a retry reaches its request", async () => {
    const stores = createInMemoryStores();
    await stores.request.set(ID, recordFor(alice), "absent");
    expect(await resolveCallerRequestId(stores, ID, alice)).toBe(ID);
  });

  it("gives the caller its own stable id when another principal holds the record", async () => {
    const stores = createInMemoryStores();
    await stores.request.set(ID, recordFor(alice), "absent");

    const first = await resolveCallerRequestId(stores, ID, bob);
    expect(first).not.toBe(ID);
    expect(first).toMatch(/^req_[0-9a-f]{32}$/);
    expect(await resolveCallerRequestId(stores, ID, bob)).toBe(first);
    const carol = await resolveCallerRequestId(stores, ID, { ...bob, userId: "carol" });
    expect(carol).not.toBe(first);
  });

  it("treats an in-flight entry with no record yet as held", async () => {
    const stores = createInMemoryStores();
    await stores.activeRequests.register({
      requestId: ID,
      flowKind: "f",
      flowId: "f",
      actionName: "run",
      ...alice,
      source: "http",
      startedAt: Date.now(),
      lastHeartbeatAt: Date.now()
    });
    expect(await resolveCallerRequestId(stores, ID, bob)).not.toBe(ID);
    expect(await resolveCallerRequestId(stores, ID, alice)).toBe(ID);
  });
});

describe("principalOwns", () => {
  it("needs the same user, tenant and organization", () => {
    const record = recordFor(alice);
    expect(principalOwns(record, alice)).toBe(true);
    expect(principalOwns(record, bob)).toBe(false);
    expect(principalOwns(record, { ...alice, tenantId: "t_2" })).toBe(false);
    expect(principalOwns(record, { ...alice, orgId: "org_2" })).toBe(false);
  });

  it("owns no record written before organizations: the claim normalises one before asking", () => {
    // One exact comparison for every door. A legacy record's tolerance lives
    // in the request-id claim (`withRequestOrg`), never in the comparison.
    const legacy = { ...recordFor(alice), orgId: undefined };
    expect(principalOwns(legacy, alice)).toBe(false);
    expect(principalOwns(legacy, bob)).toBe(false);
  });
});

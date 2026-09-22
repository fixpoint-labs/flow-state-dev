/**
 * Liveness for a dispatch run of your own, on your own flow (FIX-1440).
 *
 * The seam answers "is this request still running" only for a session it
 * accepts. Two arms decide that, and the pair is the point:
 *
 * - the descendant walk, unchanged — work beneath the asking session;
 * - a dispatch run of the same principal, tenant and flow instance, which the
 *   walk does not reach when the run does not hang beneath the caller.
 *
 * So the cases below come in pairs: what the new arm now answers, and what it
 * must still refuse. An arm that widened past dispatch runs — to any session
 * the same principal owns on this flow — would pass the first half of this file
 * and fail the second, which is exactly the failure worth catching. Removing the
 * walk would pass both, so `liveness-read.test.ts`'s refusal cases run unedited
 * beside this file; they are the half that notices.
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "../../src";
import type {
  ActiveRequestEntry,
  SessionRecord,
  StoreRegistry
} from "../../src/stores/types";
import { createRequestHost } from "../../src/context/create-request-host";
import { readLiveness } from "../../src/context/liveness-read";
import { dispatchableFlow } from "./seam-harness";

const CALLER = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: DEFAULT_ORG_ID,
  sessionId: "sess_talk",
  lineageId: "lin_1"
};

/** A registry a deployment can actually read liveness through. */
function sharedStores(): StoreRegistry {
  const stores = createInMemoryStores();
  return {
    ...stores,
    activeRequests: Object.assign(
      Object.create(Object.getPrototypeOf(stores.activeRequests)),
      stores.activeRequests,
      { sharedAcrossProcesses: true }
    )
  };
}

async function seedSession(
  stores: StoreRegistry,
  record: Partial<SessionRecord> & { id: string }
): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    record.id,
    {
      orgId: DEFAULT_ORG_ID,
      flowKind: "board",
      flowId: "board",
      userId: CALLER.userId,
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
      ...record
    },
    "any"
  );
}

async function register(
  stores: StoreRegistry,
  entry: Partial<ActiveRequestEntry> & { requestId: string; sessionId: string }
): Promise<void> {
  const now = Date.now();
  await stores.activeRequests.register({
    flowKind: "board",
    flowId: "board",
    actionName: "work",
    userId: CALLER.userId,
    // Production-shaped by default, like `seedSession` above. Registration
    // stamps an org it *requires* (`requireAttributedOrg`), so an entry with no
    // org is a legacy row, not the normal case. Defaulting this to undefined is
    // what previously let the org comparison below pass for the wrong reason.
    orgId: DEFAULT_ORG_ID,
    source: "internal",
    startedAt: now,
    lastHeartbeatAt: now,
    ...entry
  });
}

function hostFor(stores: StoreRegistry, flow: FlowInstance) {
  const { host } = createRequestHost({
    stores,
    flow,
    identity: CALLER,
    dispatchOperation: async () => ({ requestId: "req_x" }),
    liveness: {
      staleThresholdMs: 60_000,
      heartbeatIntervalMs: 10_000,
      staleSweepIntervalMs: 30_000
    }
  });
  return host;
}

describe("liveness answers for a dispatch run on the same flow", () => {
  it("answers for a run dispatched from ANOTHER of the caller's conversations", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    // The bound, stated as a case rather than as prose: this run's parent is
    // `sess_other`, NOT the asking session, so the walk from `sess_talk` never
    // reaches it. The arm admits it anyway — requiring the parent to be the
    // caller's own session is exactly what the walk already tests, so that
    // condition would make this arm a no-op and take back what D4 authorised.
    await seedSession(stores, { id: "dsx_elsewhere", parentSessionId: "sess_other" });
    await register(stores, { requestId: "req_run", sessionId: "dsx_elsewhere" });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_run"]);
    expect(answers).toEqual({ req_run: true });
  });

  it("answers when the request ENTRY carries the caller's own org, as registration always stamps it", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    // The case every deployment actually hits, and the one an entry-less
    // fixture cannot reach: `register` requires an org, so a real entry always
    // carries one. The arm compares `principal.orgId` against THIS row, and a
    // caller that forwards no org compares it against `undefined` — which
    // matches only an org-less row and refuses every genuine run. Explicit
    // here rather than left to the helper's default so deleting the default
    // cannot quietly re-hide it.
    await seedSession(stores, { id: "dsx_prod", parentSessionId: "sess_other" });
    await register(stores, {
      requestId: "req_prod",
      sessionId: "dsx_prod",
      orgId: DEFAULT_ORG_ID
    });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_prod"]);
    expect(answers).toEqual({ req_prod: true });
  });

  it("does not answer for an ordinary session of the caller's on the same flow", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    // Same principal, same flow, no dispatcher involved — a conversation they
    // started elsewhere. The arm is bounded to dispatched work, so this stays
    // refused; answering here is the widening D4 declined.
    await seedSession(stores, { id: "sess_other_talk" });
    await register(stores, { requestId: "req_other", sessionId: "sess_other_talk" });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_other"]);
    expect(answers).toEqual({ req_other: false });
  });

  it("does not answer for a dispatch run in another of the caller's organizations", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    // Same person, same tenant, same flow — and a different organization, which
    // the runtime treats as a different identity (`OrgBindingMismatchError` on
    // adoption). The descendant walk never reached across this boundary because
    // a run in another org is not in this caller's chain; the arm does not walk,
    // so it has to conjoin the organization itself or it hands one org's
    // liveness answer to the other.
    await seedSession(stores, {
      id: "dsx_other_org",
      orgId: "org_other",
      parentSessionId: "sess_over_there"
    });
    await register(stores, {
      requestId: "req_other_org",
      sessionId: "dsx_other_org",
      orgId: "org_other"
    });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_other_org"]);
    expect(answers).toEqual({ req_other_org: false });
  });

  it("refuses when the entry's org matches but the SESSION RECORD's does not", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    // What makes the two org checks independent rather than one duplicated.
    // The entry and the session record carry separately stamped orgs, so this
    // pair disagrees: the entry passes `principal.orgId`, and only the record
    // check inside `isDispatchRunOfCaller` can refuse it. Delete that check as
    // "redundant now that principal carries orgId" and this goes green while a
    // run in another org becomes readable.
    await seedSession(stores, {
      id: "dsx_split",
      orgId: "org_other",
      parentSessionId: "sess_over_there"
    });
    await register(stores, {
      requestId: "req_split",
      sessionId: "dsx_split",
      orgId: DEFAULT_ORG_ID
    });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_split"]);
    expect(answers).toEqual({ req_split: false });
  });

  it("does not answer for another principal's dispatch run", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    await seedSession(stores, {
      id: "dsx_theirs",
      userId: "u_bob",
      parentSessionId: "sess_theirs"
    });
    await register(stores, {
      requestId: "req_theirs",
      sessionId: "dsx_theirs",
      userId: "u_bob"
    });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_theirs"]);
    expect(answers).toEqual({ req_theirs: false });
  });

  it("does not answer for a dispatch run belonging to another flow instance", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    await seedSession(stores, {
      id: "dsx_other_flow",
      flowKind: "other-board",
      flowId: "other-board",
      parentSessionId: "sess_elsewhere"
    });
    await register(stores, {
      requestId: "req_other_flow",
      sessionId: "dsx_other_flow",
      flowKind: "other-board",
      flowId: "other-board"
    });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_other_flow"]);
    expect(answers).toEqual({ req_other_flow: false });
  });

  it("does not answer for a session that does not exist", async () => {
    const stores = sharedStores();
    const flow = dispatchableFlow("board");
    await register(stores, { requestId: "req_ghost", sessionId: "dsx_missing" });

    const answers = await hostFor(stores, flow).livenessOf?.(["req_ghost"]);
    expect(answers).toEqual({ req_ghost: false });
  });
});

describe("the two arms compose", () => {
  const entry = (sessionId: string): ActiveRequestEntry => ({
    requestId: "req_1",
    flowKind: "board",
    flowId: "board",
    actionName: "work",
    sessionId,
    userId: "u_alice",
    tenantId: undefined,
    source: "internal",
    startedAt: 1_000,
    lastHeartbeatAt: 1_000
  });

  const inputs = {
    registry: { get: async () => entry("dsx_1") },
    staleThresholdMs: 60_000,
    flow: { id: "board", kind: "board", cardinality: "singleton" } as unknown as FlowInstance,
    principal: { userId: "u_alice", tenantId: undefined },
    now: () => 1_000
  };

  it("takes either arm, and refuses when neither answers", async () => {
    expect(
      await readLiveness(["req_1"], {
        ...inputs,
        isDescendantSession: async () => true,
        isDispatchRunOfCaller: async () => false
      })
    ).toEqual({ req_1: true });

    expect(
      await readLiveness(["req_1"], {
        ...inputs,
        isDescendantSession: async () => false,
        isDispatchRunOfCaller: async () => true
      })
    ).toEqual({ req_1: true });

    expect(
      await readLiveness(["req_1"], {
        ...inputs,
        isDescendantSession: async () => false,
        isDispatchRunOfCaller: async () => false
      })
    ).toEqual({ req_1: false });
  });

  it("cannot rescue a request that failed an identity check", async () => {
    // The arm runs after principal, tenant and flow ownership, so an arm that
    // said yes to everything still cannot widen past them.
    expect(
      await readLiveness(["req_1"], {
        ...inputs,
        principal: { userId: "u_bob", tenantId: undefined },
        isDescendantSession: async () => true,
        isDispatchRunOfCaller: async () => true
      })
    ).toEqual({ req_1: false });
  });
});

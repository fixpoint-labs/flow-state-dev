/**
 * The create-race branch of a `{ key }` dispatch (FIX-999).
 *
 * The seam reads the derived child key, finds nothing, and creates with
 * `expectedVersion: "absent"`. Between that read and that write another caller
 * can land the same child — the TOCTOU window the `"absent"` predicate exists to
 * close. Losing that race is **not** an error: if the winner's record is the same
 * child this call would have created, the loser adopts it and the dispatch
 * proceeds. Refusing there drops work a caller legitimately asked for.
 *
 * These tests drive that branch directly, because it cannot be reached through a
 * real store: by construction the window is between two awaits. The session store
 * here is a stand-in for "we lost", not a mock of a store's internals — `get`
 * reports the key empty (what this call saw) and the create conflicts (what the
 * winner did).
 *
 * The refusal cases matter as much as the adoption case: a conflict whose current
 * value is absent means the row is **tombstoned**, and the store contract
 * (`stores/types.ts`) is explicit that a caller must treat that as deleted and
 * stop, never as "reuse what I had cached".
 */
import { describe, it, expect } from "vitest";
import { createRequestHost } from "../../src/context/create-request-host";
import { deriveDispatchChildSessionId } from "../../src/context/detached-child";
import type { ExpectedVersion, SessionRecord } from "../../src/stores/types";
import { CHILD_ENTRY, dispatchableFlow } from "./seam-harness";

const IDENTITY = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: undefined,
  /** The running request's session — the parent of anything it spawns. */
  sessionId: "s_parent",
  lineageId: "lin_race"
};

const KEY = "review";

const FLOW = dispatchableFlow("seam-race");

/** The child this call would have created, as the winner already created it. */
function winnerRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const childId = deriveDispatchChildSessionId(
    {
      userId: IDENTITY.userId,
      tenantId: IDENTITY.tenantId,
      parentSessionId: IDENTITY.sessionId,
      lineageId: IDENTITY.lineageId
    },
    KEY
  );
  const ts = 1_700_000_000_000;
  return {
    id: childId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    flowKind: FLOW.kind,
    userId: IDENTITY.userId,
    parentSessionId: IDENTITY.sessionId,
    lineageId: IDENTITY.lineageId,
    journal: [],
    ...overrides
  } as SessionRecord;
}

/**
 * A session store that always loses the create race: the pre-write read sees an
 * empty key, and the `"absent"` create comes back as a conflict carrying
 * whatever the winner left at that key.
 */
function raceLosingStores(currentValue: SessionRecord | undefined) {
  return {
    session: {
      get: async (): Promise<SessionRecord | undefined> => undefined,
      set: async (_id: string, _value: SessionRecord, expected: ExpectedVersion) => {
        expect(expected).toBe("absent");
        return {
          ok: false as const,
          conflict: { currentValue, currentVersion: 0 }
        };
      }
    },
    // Every case here LOSES the create, so the tombstone reclamation a won
    // create runs (FIX-1258) is never reached. Present so a future case that
    // wins fails on its assertion rather than on a missing stub.
    resourceState: { purgeTombstones: async () => {} },
    // Per-process by default, so liveness is gated off — irrelevant here.
    activeRequests: {}
  } as never;
}

function seamOver(currentValue: SessionRecord | undefined, started: string[] = []) {
  return createRequestHost({
    stores: raceLosingStores(currentValue),
    flow: FLOW,
    identity: IDENTITY,
    dispatchOperation: async ({ sessionId }) => {
      started.push(sessionId);
      return { requestId: "req_child" };
    },
    liveness: {
      heartbeatIntervalMs: 10_000,
      staleThresholdMs: 60_000,
      staleSweepIntervalMs: 30_000
    }
  }).seam;
}

const SPEC = { ...CHILD_ENTRY, session: { key: KEY }, payload: {}, from: "racer" };

describe("a { key } dispatch, losing the create race", () => {
  it("ADOPTS the winner's matching child instead of refusing", async () => {
    const started: string[] = [];
    const result = await seamOver(winnerRecord(), started)(SPEC);

    // The whole point: the loser proceeds, and says it adopted rather than created.
    expect(result).toMatchObject({ ok: true, adopted: true });
    // And it actually dispatched — a refusal would have started nothing.
    expect(started).toHaveLength(1);
  });

  it("REFUSES when the winner's record is a different child", async () => {
    const result = await seamOver(winnerRecord({ flowKind: "some-other-flow" }))(SPEC);
    expect(result).toMatchObject({ ok: false, refused: "key-occupied" });
  });

  it("REFUSES when the winner's record sits on another lineage", async () => {
    // A same-id pre-creation through the session route carries whatever
    // lineage that route minted; adopting it would put every lineage-shared
    // resource in the child on a different root than the parent's.
    const result = await seamOver(winnerRecord({ lineageId: "lin_other" }))(SPEC);
    expect(result).toMatchObject({ ok: false, refused: "key-occupied" });
  });

  it("REFUSES when the conflict reports no current value — a tombstoned row is not adoptable", async () => {
    // `stores/types.ts`: an undefined current value means deleted; the caller
    // must stop rather than reuse a cached record.
    const result = await seamOver(undefined)(SPEC);
    expect(result).toMatchObject({ ok: false, refused: "key-occupied" });
  });
});

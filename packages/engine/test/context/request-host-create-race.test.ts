/**
 * The create-race branch of `startDetached` (FIX-999).
 *
 * `startDetached` reads the derived child key, finds nothing, and creates with
 * `expectedVersion: "absent"`. Between that read and that write another caller
 * can land the same child — the TOCTOU window the `"absent"` predicate exists to
 * close. Losing that race is **not** an error: if the winner's record is the same
 * child this call would have created, the loser adopts it and the detached work
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
import type { FlowInstance } from "@flow-state-dev/core";
import { createRequestHost } from "../../src/context/create-request-host";
import { deriveChildSessionId } from "../../src/context/detached-child";
import type { ExpectedVersion, SessionRecord } from "../../src/stores/types";

const IDENTITY = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: undefined,
  /** The running request's session — the parent of anything it spawns. */
  sessionId: "s_parent"
};

const SEED = { topic: "review" };

/** Only `kind` and `workstream` are read by the verb under test. */
const FLOW = {
  kind: "seam-race",
  workstream: { block: { name: "core" } }
} as unknown as FlowInstance;

/** The child this call would have created, as the winner already created it. */
function winnerRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const childId = deriveChildSessionId(
    {
      userId: IDENTITY.userId,
      tenantId: IDENTITY.tenantId,
      parentSessionId: IDENTITY.sessionId
    },
    SEED
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
    // Per-process by default, so liveness is gated off — irrelevant here.
    activeRequests: {}
  } as never;
}

describe("startDetached, losing the create race", () => {
  it("ADOPTS the winner's matching child instead of refusing", async () => {
    const started: string[] = [];
    const { host } = createRequestHost({
      stores: raceLosingStores(winnerRecord()),
      flow: FLOW,
      identity: IDENTITY,
      startOperation: async ({ sessionId }) => {
        started.push(sessionId);
        return { requestId: "req_child" };
      },
      liveness: {
        heartbeatIntervalMs: 10_000,
        staleThresholdMs: 60_000,
        staleSweepIntervalMs: 30_000
      }
    });

    const result = await host.startDetached({ seed: SEED, input: {} });

    // The whole point: the loser proceeds, and says it adopted rather than created.
    expect(result).toMatchObject({ ok: true, adopted: true });
    // And it actually dispatched — a refusal would have started nothing.
    expect(started).toHaveLength(1);
  });

  it("REFUSES when the winner's record is a different child", async () => {
    const { host } = createRequestHost({
      stores: raceLosingStores(winnerRecord({ flowKind: "some-other-flow" })),
      flow: FLOW,
      identity: IDENTITY,
      startOperation: async () => ({ requestId: "req_child" }),
      liveness: {
        heartbeatIntervalMs: 10_000,
        staleThresholdMs: 60_000,
        staleSweepIntervalMs: 30_000
      }
    });

    const result = await host.startDetached({ seed: SEED, input: {} });

    expect(result).toMatchObject({ ok: false, refused: "key-occupied" });
  });

  it("REFUSES when the conflict reports no current value — a tombstoned row is not adoptable", async () => {
    // `stores/types.ts`: an undefined current value means deleted; the caller
    // must stop rather than reuse a cached record.
    const { host } = createRequestHost({
      stores: raceLosingStores(undefined),
      flow: FLOW,
      identity: IDENTITY,
      startOperation: async () => ({ requestId: "req_child" }),
      liveness: {
        heartbeatIntervalMs: 10_000,
        staleThresholdMs: 60_000,
        staleSweepIntervalMs: 30_000
      }
    });

    const result = await host.startDetached({ seed: SEED, input: {} });

    expect(result).toMatchObject({ ok: false, refused: "key-occupied" });
  });
});

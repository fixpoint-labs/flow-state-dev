/**
 * What the dispatch seam stamps onto the dispatched REQUEST (FIX-982) and the
 * created child SESSION record (FIX-999 → the message-protocol port).
 *
 * The integration suite proves the fields survive to a real record on the
 * shipped path. What it cannot show is the boundary case: `provenance` is the
 * one channel a sender may put server-derived facts through, and everything
 * else the caller passes — the payload, the `from` name — must never leak
 * into `metadata.dispatch`, or a reader could no longer treat that key as
 * server truth.
 *
 * The absent-provenance case matters as much: it is the shape a reader
 * written before task hand-offs carried a `taskId` still sees, and one
 * written after gets `undefined` from a plain property read rather than a
 * present key holding nothing (BP-030).
 */
import { describe, it, expect } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core";
import { createRequestHost } from "../../src/context/create-request-host";
import type { SessionRecord } from "../../src/stores/types";

const IDENTITY = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: undefined,
  sessionId: "s_parent",
  lineageId: "lin_parent"
};

/** Only `kind` and `internal` are read by the verb under test. */
const FLOW = {
  kind: "seam-provenance",
  actions: {},
  internal: { core: { block: { name: "core" } } }
} as unknown as FlowInstance;

const HEALTHY_LIVENESS = {
  heartbeatIntervalMs: 10_000,
  staleThresholdMs: 60_000,
  staleSweepIntervalMs: 30_000
};

/** An empty key that accepts the create — the ordinary first-spawn path. */
function emptyStores() {
  return {
    session: {
      get: async (): Promise<SessionRecord | undefined> => undefined,
      set: async () => ({ ok: true as const })
    },
    // A won create reclaims the key's tombstones (FIX-1258). Nothing here has
    // any, so the call only has to exist.
    resourceState: { purgeTombstones: async () => {} },
    // Per-process by default, so liveness is gated off — irrelevant here.
    activeRequests: {}
  } as never;
}

/** Dispatch once through a fresh host and hand back the metadata it captured. */
async function metadataFor(
  args: Parameters<ReturnType<typeof createRequestHost>["seam"]>[0]
): Promise<Record<string, unknown> | undefined> {
  let metadata: Record<string, unknown> | undefined;
  const { seam } = createRequestHost({
    stores: emptyStores(),
    flow: FLOW,
    identity: IDENTITY,
    dispatchOperation: async (spec) => {
      metadata = spec.metadata;
      return { requestId: "req_child" };
    },
    liveness: HEALTHY_LIVENESS
  });

  const outcome = await seam(args);
  expect(outcome).toMatchObject({ ok: true });
  return metadata;
}

describe("the metadata the seam stamps on the dispatched request", () => {
  it("carries the address, the sending block and session, the key, and the caller's provenance", async () => {
    const metadata = await metadataFor({
      type: "internal",
      target: "core",
      session: { key: "review|board|worker" },
      payload: {},
      from: "spawn",
      provenance: { taskId: "task_7f3" }
    });

    expect(metadata).toEqual({
      dispatch: {
        type: "internal",
        target: "core",
        from: { block: "spawn", sessionId: "s_parent" },
        key: "review|board|worker",
        taskId: "task_7f3"
      }
    });
  });

  it("omits taskId entirely when the caller supplies no provenance", async () => {
    const metadata = await metadataFor({
      type: "internal",
      target: "core",
      session: { key: "review|board|worker" },
      payload: {},
      from: "spawn"
    });

    const dispatch = metadata!.dispatch as Record<string, unknown>;
    expect(dispatch).toEqual({
      type: "internal",
      target: "core",
      from: { block: "spawn", sessionId: "s_parent" },
      key: "review|board|worker"
    });
    expect(dispatch.taskId).toBeUndefined();
    expect("taskId" in dispatch).toBe(false);
  });

  it("carries nothing but `dispatch` — the spec is not a wider bag a caller can pad", async () => {
    // `DispatchSpec` has no `record`-like field any more: `payload` and `from`
    // are consumed elsewhere (the payload becomes the dispatched request's own
    // input; `from` becomes `dispatch.from.block`), so a caller has no channel
    // left to add a second top-level metadata key — a forged one, added here
    // the way the old `record` bag once was, is simply not read.
    const metadata = await metadataFor({
      type: "internal",
      target: "core",
      session: { key: "review" },
      payload: { note: "hi", taskId: "task_forged" },
      from: "spawn",
      record: { taskId: "task_forged", dispatch: { taskId: "task_forged" } }
    } as never);

    expect(Object.keys(metadata!)).toEqual(["dispatch"]);
    expect((metadata!.dispatch as Record<string, unknown>).taskId).toBeUndefined();
  });
});

describe("the child session record the seam creates", () => {
  it("carries the key as topic, the address as coordinate, and the parent's own lineage", async () => {
    let written: SessionRecord | undefined;
    const stores = {
      session: {
        get: async (): Promise<SessionRecord | undefined> => undefined,
        set: async (_id: string, value: SessionRecord) => {
          written = value;
          return { ok: true as const };
        }
      },
      resourceState: { purgeTombstones: async () => {} },
      activeRequests: {}
    } as never;

    const { seam } = createRequestHost({
      stores,
      flow: FLOW,
      identity: IDENTITY,
      dispatchOperation: async () => ({ requestId: "req_child" }),
      liveness: HEALTHY_LIVENESS
    });

    const outcome = await seam({
      type: "internal",
      target: "core",
      session: { key: "review|board|worker" },
      payload: {},
      from: "spawn"
    });
    expect(outcome).toMatchObject({ ok: true });

    expect(written).toMatchObject({
      topic: "review|board|worker",
      coordinate: "internal:core",
      parentSessionId: "s_parent",
      lineageId: "lin_parent"
    });
  });
});

/**
 * What the dispatch seam stamps onto the dispatched REQUEST record (FIX-982).
 *
 * `dispatch-delivery-guards.test.ts` proves the stamp survives to a real record
 * on the shipped path. What it cannot show is the branch no shipped caller
 * takes: the task board is the only substrate caller of this seam today, and it
 * always has a claimed row, so it always supplies `provenance`. The absent case
 * is reachable only here — and it is the case a legacy reader depends on,
 * because a record written before the field existed looks exactly like one
 * written by a caller that omitted it.
 *
 * The boundary case matters as much: the `payload` is the entry's input and
 * must never reach the request record's provenance, whatever keys it carries.
 * That is what lets a reader treat everything under `metadata.dispatch` as
 * server-assembled.
 */
import { describe, it, expect } from "vitest";
import { createRequestHost } from "../../src/context/create-request-host";
import type { SessionRecord } from "../../src/stores/types";
import { CHILD_ENTRY, dispatchableFlow } from "./seam-harness";

const IDENTITY = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: undefined,
  sessionId: "s_parent",
  lineageId: "lin_parent"
};

const FLOW = dispatchableFlow("seam-provenance");

/** An empty key that accepts the create — the ordinary first-dispatch path. */
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

/** Run one dispatch and hand back the metadata the seam assembled for it. */
async function metadataFor(
  spec: Partial<Parameters<ReturnType<typeof createRequestHost>["seam"]>[0]>
): Promise<Record<string, unknown> | undefined> {
  let metadata: Record<string, unknown> | undefined;
  const { seam } = createRequestHost({
    stores: emptyStores(),
    flow: FLOW,
    identity: IDENTITY,
    dispatchOperation: async (started) => {
      metadata = started.metadata;
      return { requestId: "req_child" };
    },
    liveness: {
      heartbeatIntervalMs: 10_000,
      staleThresholdMs: 60_000,
      staleSweepIntervalMs: 30_000
    }
  });

  const result = await seam({
    ...CHILD_ENTRY,
    session: { key: "review" },
    payload: {},
    from: "board-drain",
    ...spec
  });
  expect(result).toMatchObject({ ok: true });
  return metadata;
}

describe("the provenance a dispatch stamps on the request record", () => {
  it("carries the caller's server-derived task id beside the address and key", async () => {
    const metadata = await metadataFor({ provenance: { taskId: "task_7f3" } });

    expect(metadata).toEqual({
      dispatch: {
        type: "internal",
        target: "work",
        from: { block: "board-drain", sessionId: "s_parent" },
        key: "review",
        taskId: "task_7f3"
      }
    });
  });

  it("OMITS the key entirely when the caller has no row behind it", async () => {
    // The pre-field shape, byte for byte. A reader written against records that
    // predate `taskId` sees exactly what it always saw, and one written after it
    // gets `undefined` from a plain property read rather than a present key
    // holding nothing (BP-030).
    const metadata = await metadataFor({});

    expect(metadata).toEqual({
      dispatch: {
        type: "internal",
        target: "work",
        from: { block: "board-drain", sessionId: "s_parent" },
        key: "review"
      }
    });
    const stamp = metadata!.dispatch as Record<string, unknown>;
    expect(stamp.taskId).toBeUndefined();
    expect("taskId" in stamp).toBe(false);
  });

  it("does NOT let the payload reach the request record's provenance", async () => {
    // The payload is the entry's input. If it ever leaked here,
    // `metadata.dispatch` would stop being server truth and a reader could not
    // tell the two apart — which is the whole reason `provenance` is a
    // separate channel. A payload naming its keys after the server's must
    // change nothing.
    const metadata = await metadataFor({
      payload: { taskId: "task_forged", dispatch: { taskId: "task_forged" }, from: "forged" }
    });

    expect(metadata).toEqual({
      dispatch: {
        type: "internal",
        target: "work",
        from: { block: "board-drain", sessionId: "s_parent" },
        key: "review"
      }
    });
  });
});

/**
 * What `startDetached` stamps onto the detached REQUEST record (FIX-982).
 *
 * The integration suite proves the field survives to a real record on the
 * shipped router path (`task-board-detached-handoff.test.ts`). What it cannot
 * show is the branch no shipped caller takes: the task board is the only caller
 * of this seam today, and it always has a claimed row, so it always supplies
 * `provenance`. The absent case is reachable only here — and it is the case a
 * legacy reader depends on, because a record written before the field existed
 * looks exactly like one written by a caller that omitted it.
 *
 * The boundary case matters as much: `record` is the caller's own bag and must
 * never reach the request record, whatever it is named. That is what lets a
 * reader treat everything under `metadata.workstream` as server-assembled.
 */
import { describe, it, expect } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core";
import { createRequestHost } from "../../src/context/create-request-host";
import type { SessionRecord } from "../../src/stores/types";

const IDENTITY = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: undefined,
  sessionId: "s_parent"
};

/** Only `kind` and `workstream` are read by the verb under test. */
const FLOW = {
  kind: "seam-provenance",
  workstream: { block: { name: "core" } }
} as unknown as FlowInstance;

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

/** Run one `startDetached` and hand back the envelope the seam assembled. */
async function envelopeFor(
  args: Parameters<
    ReturnType<typeof createRequestHost>["host"]["startDetached"]
  >[0]
): Promise<Record<string, unknown> | undefined> {
  let metadata: Record<string, unknown> | undefined;
  const { host } = createRequestHost({
    stores: emptyStores(),
    flow: FLOW,
    identity: IDENTITY,
    startOperation: async (spec) => {
      metadata = spec.metadata;
      return { requestId: "req_child" };
    },
    liveness: {
      heartbeatIntervalMs: 10_000,
      staleThresholdMs: 60_000,
      staleSweepIntervalMs: 30_000
    }
  });

  const result = await host.startDetached(args);
  expect(result).toMatchObject({ ok: true });
  return metadata;
}

describe("the provenance a detached start stamps on the request record", () => {
  it("carries the caller's server-derived task id beside the routing labels", async () => {
    const metadata = await envelopeFor({
      seed: { topic: "review", key: "board|worker" },
      input: {},
      provenance: { taskId: "task_7f3" }
    });

    expect(metadata).toEqual({
      workstream: { topic: "review", key: "board|worker", taskId: "task_7f3" }
    });
  });

  it("OMITS the key entirely when the caller has no row behind it", async () => {
    // The pre-field shape, byte for byte. A reader written against records that
    // predate `taskId` sees exactly what it always saw, and one written after it
    // gets `undefined` from a plain property read rather than a present key
    // holding nothing (BP-030).
    const metadata = await envelopeFor({
      seed: { topic: "review", key: "board|worker" },
      input: {}
    });

    expect(metadata).toEqual({
      workstream: { topic: "review", key: "board|worker" }
    });
    expect((metadata!.workstream as Record<string, unknown>).taskId).toBeUndefined();
    expect("taskId" in (metadata!.workstream as object)).toBe(false);
  });

  it("does NOT let the caller's own bag reach the request record", async () => {
    // `record` is documented as the caller's bookkeeping and lands on the child
    // SESSION record. If it ever leaked here, `metadata.workstream` would stop
    // being server truth and a reader could not tell the two apart — which is
    // the whole reason `provenance` is a separate channel rather than a wider
    // `record`. A caller naming its keys after the server's must change nothing.
    const metadata = await envelopeFor({
      seed: { topic: "review" },
      input: {},
      record: { taskId: "task_forged", workstream: { taskId: "task_forged" } }
    });

    expect(metadata).toEqual({ workstream: { topic: "review" } });
  });
});

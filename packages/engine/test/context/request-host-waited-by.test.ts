/**
 * The stamp the dispatch seam writes on a request a waiting sender dispatched
 * (FIX-2082): `metadata.dispatch.waitedBy`, from the sender's own
 * server-derived facts (its request id and the row it works). The child's wait
 * depth counts its sender from it before the sender's park is written. Only a
 * dispatch the sender waits on carries it, and a caller's `provenance` can't
 * forge one.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createRequestHost } from "../../src/context/create-request-host";
import type { SessionRecord } from "../../src/stores/types";
import { CHILD_ENTRY, dispatchableFlow } from "./seam-harness";

const IDENTITY = {
  userId: "u_alice",
  tenantId: undefined,
  orgId: DEFAULT_ORG_ID,
  sessionId: "s_parent",
  lineageId: "lin_parent"
};

const FLOW = dispatchableFlow("seam-waited-by");

function emptyStores() {
  return {
    session: {
      get: async (): Promise<SessionRecord | undefined> => undefined,
      set: async () => ({ ok: true as const })
    },
    resourceState: { purgeTombstones: async () => {} },
    activeRequests: {}
  } as never;
}

/** The sender's own facts, as the engine derives them for its waits. */
const SENDER_WAITS = {
  provider: { listSuspended: async () => [] },
  deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 },
  requestId: "req_sender",
  own: { board: "", taskId: "task_sender" },
  readRequest: async () => undefined
} as never;

/** Run one dispatch and hand back the `metadata.dispatch` the seam assembled for it. */
async function stampFor(spec: Record<string, unknown>, waits: unknown | null = SENDER_WAITS): Promise<Record<string, unknown>> {
  let metadata: Record<string, unknown> | undefined;
  const { seam } = createRequestHost({
    stores: emptyStores(),
    flow: FLOW,
    identity: IDENTITY,
    dispatchOperation: async (started: { metadata?: Record<string, unknown> }) => {
      metadata = started.metadata;
      return { requestId: "req_child" };
    },
    liveness: { heartbeatIntervalMs: 10_000, staleThresholdMs: 60_000, staleSweepIntervalMs: 30_000 },
    ...(waits !== null ? { waits } : {})
  } as never);
  const result = await seam({ ...CHILD_ENTRY, session: { key: "review" }, payload: {}, from: "probe", ...spec } as never);
  expect(result).toMatchObject({ ok: true });
  return metadata!.dispatch as Record<string, unknown>;
}

describe("the waitedBy stamp a waited dispatch leaves on its child", () => {
  it("names the sender's request and the row it works, when the sender waits", async () => {
    const stamp = await stampFor({ waits: true });
    expect(stamp.waitedBy).toEqual({ requestId: "req_sender", own: { board: "", taskId: "task_sender" } });
  });

  it("is absent on a dispatch the sender doesn't wait on, and on a host that can't hold a wait", async () => {
    expect("waitedBy" in (await stampFor({}))).toBe(false);
    expect("waitedBy" in (await stampFor({ waits: true }, null))).toBe(false);
  });

  it("can't be forged through provenance", async () => {
    const forged = { waitedBy: { requestId: "req_someone_else" }, taskId: "task_7f3" };
    const unwaited = await stampFor({ provenance: forged });
    expect("waitedBy" in unwaited).toBe(false);
    expect(unwaited.taskId).toBe("task_7f3");
    const waited = await stampFor({ provenance: forged, waits: true });
    expect(waited.waitedBy).toEqual({ requestId: "req_sender", own: { board: "", taskId: "task_sender" } });
  });
});

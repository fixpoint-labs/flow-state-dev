/**
 * Discarding a dispatched child a restart cut off resumes the request waiting
 * on it (`dispatcher({ wait: true })`), as every other ending of the child
 * does. Without it the parent stays parked until its wait deadline, five
 * minutes by default, after the user already discarded the child.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";

const resumed: Array<{ requestId: string; outcome: unknown; resumedBy: string }> = [];
vi.mock("../src/durability/resume-wait-gate", () => ({
  resumeWaitGate: async (_deps: unknown, gate: { requestId: string }, outcome: unknown, resumedBy: string) => {
    resumed.push({ requestId: gate.requestId, outcome, resumedBy });
    return { ok: true };
  }
}));

const { createInMemoryStores } = await import("../src");
const { recordRequestStop } = await import("../src/execution/record-request-stop");
const { INTERNAL_SOURCE } = await import("../src/execution/transport-sources");

const parentGate = {
  requestId: "r_parent",
  sessionId: "s_parent",
  suspensionId: "wait:child",
  reason: "wait",
  status: "pending",
  userId: "u1",
  data: { requestId: "r_child", deadline: Date.now() + 300_000 }
};

beforeEach(() => {
  resumed.length = 0;
});

describe("discarding a dispatched child a restart cut off", () => {
  it("resumes the parent waiting on it, with the child's stop as the outcome", async () => {
    const stores = createInMemoryStores();
    await stores.request.set(
      "r_child",
      {
        orgId: DEFAULT_ORG_ID,
        id: "r_child",
        flowKind: "chat",
        actionName: "probe",
        userId: "u1",
        sessionId: "s_child",
        source: INTERNAL_SOURCE,
        metadata: { dispatch: { type: "internal", action: "probe", from: { block: "b", sessionId: "s_parent" } } },
        status: "interrupted",
        interruptedAt: Date.now(),
        startedAtMs: Date.now(),
        state: {},
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        incarnation: "inc_child",
        journal: []
      } as never,
      "any"
    );
    const provider = {
      listSuspended: async (filter: { sessionId?: string }) => (filter.sessionId === "s_parent" ? [parentGate] : []) as never,
      loadSuspension: async () => null as never
    };
    const parked = { provider, stores: { request: stores.request } } as never;

    const result = await recordRequestStop(stores.request, (await stores.request.get("r_child"))!, parked);

    expect(result).toEqual({ kind: "ended" });
    expect(resumed).toEqual([
      { requestId: "r_parent", outcome: expect.objectContaining({ answered: false, error: expect.objectContaining({ code: "wait_task_cancelled" }) }), resumedBy: "request:r_child" }
    ]);
  });
});

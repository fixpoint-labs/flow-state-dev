/**
 * A delegate's failed routed task whose error report isn't taken (a store
 * error, say): the report rides the task's ending like any task's (FIX-2078,
 * epic decision (f)), so the notice stays owed on the task, and the report
 * goes again with it, rather than the conversation hearing an ending its
 * report never reached. No separate report marker is written.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/conversation-board/report-owed", async (original) => ({
  ...(await original<typeof import("../src/conversation-board/report-owed")>()),
  sendTaskReport: async () => "not-taken" as const
}));

import { bootHost } from "./coordinator-harness";

describe("a delegate's failed routed task whose report can't be sent", () => {
  it("keeps its ending owed for the board's next touch, and writes no report marker", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await host.act("alice", id, "respond", { message: "[route:eng.em] [conf:0.9] [fail:eng.em] plan the release" });
    const requests = await host.settled();
    const [row] = await host.routedRows("alice");
    expect(row).toMatchObject({ status: "errored", assignee: "eng.em" });
    // The conversation's notice entry ran, and stopped on the report: the ending stays owed.
    expect(requests.some((r) => r.flowKind === "coordinator" && r.actionName === "onTaskSettled" && r.status === "failed")).toBe(true);
    expect(row.metadata["noticeOwed:1:errored"]).not.toBeNull();
    expect(row.metadata["noticeOwed:1:errored"]).toBeDefined();
    expect(Object.keys(row.metadata ?? {}).filter((key) => key.startsWith("reportOwed:"))).toEqual([]);
  });
});

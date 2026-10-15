/**
 * A delegate's failed post tells its coordinator it ended even when sending
 * the post's error report throws (a store error, say): the report is best
 * effort, and the mark stays for the board's next touch (FIX-2010).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/conversation-board/report-owed", async (original) => ({
  ...(await original<typeof import("../src/conversation-board/report-owed")>()),
  sendOwedReports: async () => {
    throw new Error("the store was down");
  }
}));

import { bootHost } from "./coordinator-harness";

describe("a delegate's failed post whose report can't be sent", () => {
  it("still tells the coordinator the post ended, and keeps the report owed", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await host.act("alice", id, "run", { message: "[route:eng.em] [conf:0.9] [fail:eng.em] plan the release" });
    const requests = await host.settled();
    const [row] = await host.postRows("alice");
    expect(row).toMatchObject({ status: "errored", assignee: "eng.em" });
    // The notice was sent: its mark is cleared, and the coordinator heard the ending.
    expect(row.metadata["noticeOwed:1:errored"]).toBeNull();
    expect(requests.some((r) => r.flowKind === "coordinator" && r.actionName === "onPostSettled")).toBe(true);
    expect(row.metadata["reportOwed:1"]).toMatchObject({ attempt: 1, error: "eng.em could not answer" });
  });
});

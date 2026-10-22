/**
 * A delegate's failed post tells its coordinator it ended even when its error
 * report isn't taken (a store error, say): a post's report is best effort,
 * sent on its notice (FIX-2010, FIX-2078), and leaves no marker.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/conversation-board/report-owed", async (original) => ({
  ...(await original<typeof import("../src/conversation-board/report-owed")>()),
  sendTaskReport: async () => "not-taken" as const
}));

import { bootHost } from "./coordinator-harness";

describe("a delegate's failed post whose report can't be sent", () => {
  it("still tells the coordinator the post ended, and writes no report marker", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    await host.act("alice", id, "run", { message: "[route:eng.em] [conf:0.9] [fail:eng.em] plan the release" });
    const requests = await host.settled();
    const [row] = await host.postRows("alice");
    expect(row).toMatchObject({ status: "errored", assignee: "eng.em" });
    // The notice was sent: its mark is cleared, and the coordinator heard the ending.
    expect(row.metadata["noticeOwed:1:errored"]).toBeNull();
    expect(requests.some((r) => r.flowKind === "coordinator" && r.actionName === "onPostSettled")).toBe(true);
    expect(Object.keys(row.metadata ?? {}).filter((key) => key.startsWith("reportOwed:"))).toEqual([]);
  });
});

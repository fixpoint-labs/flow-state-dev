/**
 * A batch a task session files reads its dependencies as stored now
 * (FIX-2114): a dependency another request failed while the turn ran is
 * refused `dependency_ended` before anything is written, and that includes the
 * chain's reservation for the row.
 *
 * The turn reads its board (the snapshot its request keeps), then a piece it
 * filed earlier fails in the piece's own session, then the turn files a
 * batch depending on that piece.
 */
import { describe, expect, it } from "vitest";
import { bootSplitHost } from "./split-harness";

describe("a task session's batch reads its dependencies as stored now", () => {
  it("refuses a dependency that failed in another request while the turn ran, and reserves nothing", async () => {
    let releaseBook!: () => void;
    let releaseFlyers!: () => void;
    let releaseKeep!: () => void;
    const holds = new Map([
      ["book", new Promise<void>((resolve) => (releaseBook = resolve))],
      ["flyers", new Promise<void>((resolve) => (releaseFlyers = resolve))],
      // Keeps the top task open, so its chain is still there to read.
      ["keep", new Promise<void>((resolve) => (releaseKeep = resolve))]
    ]);
    const h = bootSplitHost({ holds });
    try {
      h.controls.plans.planner = [{ goal: "Plan the launch", assignee: "s1" }];
      h.controls.plans.s1 = [
        { goal: "Book the venue [hold:book]", assignee: "eng.tasker" },
        { goal: "Print the flyers [hold:flyers] [fail]", assignee: "eng.writer", id: "flyers", maxAttempts: 1 },
        { goal: "Hire the band [hold:keep]", assignee: "eng.tasker" }
      ];
      h.controls.batch.add("s1");
      // On the venue's completion, s1's turn files the posting, which needs the flyers.
      h.controls.onCompleted.s1 = [{ goal: "Post the flyers", assignee: "eng.tasker", deps: ["flyers"] }];

      await h.turn("alice", await h.open("alice", "planner"));
      expect(await h.until(async () => (await h.rowsNamed("alice", "Print the flyers [hold:flyers] [fail]")).length === 1)).toBe(true);

      // The turn the venue's ending wakes reads its board, and holds there.
      let reached!: () => void;
      const atHold = new Promise<void>((resolve) => (reached = resolve));
      let releaseTurn!: () => void;
      h.controls.holdAfterResolve.s1 = { reached, release: new Promise<void>((resolve) => (releaseTurn = resolve)) };
      releaseBook();
      await atHold;
      // Meanwhile the flyers fail for good, in their own session.
      releaseFlyers();
      expect(await h.until(async () => (await h.rowsNamed("alice", "Print the flyers [hold:flyers] [fail]"))[0]?.status === "errored")).toBe(true);
      releaseTurn();
      // The refusal is recorded once the batch's add returns: whatever it reserved is written by then.
      expect(await h.until(async () => h.controls.refusals.length > 0)).toBe(true);
      // Nothing reserved for the refused row: the chain holds the three pieces filed, each added.
      const entries = Object.values(await h.chains("alice")).flatMap((record) => Object.values(record.entries));
      expect(entries.map((entry) => entry.state)).toEqual(["added", "added", "added"]);
      releaseKeep();
      await h.settled();

      expect(h.controls.refusals).toEqual([
        expect.objectContaining({ worker: "s1", error: "TaskFilingRefusedError", message: expect.stringContaining("dependency_ended") })
      ]);
      expect(await h.rowsNamed("alice", "Post the flyers")).toEqual([]);
    } finally {
      // Every gate opens, so a failed assertion still lets the host wind down.
      for (const release of [releaseBook, releaseFlyers, releaseKeep]) release();
      await h.dispose();
    }
  }, 20_000);
});

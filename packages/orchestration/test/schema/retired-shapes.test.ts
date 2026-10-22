/**
 * The retired-shape map (FIX-2080, epic D3): one read for every task row
 * stored in a shape the epic retires, one test per shape.
 *
 * An entry is on once nothing writes its shape: its rows read in the current
 * shape at every read boundary. One (`post`) is built here and turned on by
 * the issue that stops writing its shape; until then the boundary reads it as
 * stored, and the entry's own read shows what it will read as.
 */
import { describe, expect, it } from "vitest";
import {
  RETIRED_SHAPES,
  readRetiredShape,
  withRetiredShapes,
} from "../../src/tasks/schema/retired-shapes";
import { persistedTaskStatusSchema } from "../../src/tasks/schema/task-status";

const row = { id: "t", goal: "t", attempts: 0, createdAt: 1, updatedAt: 1 };

describe("the retired-shape map", () => {
  it("turns on exactly the entries whose shapes nothing writes any more", () => {
    const on = Object.entries(RETIRED_SHAPES)
      .filter(([, entry]) => entry.on)
      .map(([shape]) => shape);
    expect(on.sort()).toEqual(["blocked", "parked-for-turn", "parked-split", "recorded", "reopened"]);
  });

  it("returns a row in no retired shape as the same object", () => {
    const current = { ...row, status: "pending" };
    expect(withRetiredShapes(current)).toBe(current);
  });

  it("blocked: reads as held, with the block's reason kept apart from what a worker reads", () => {
    const read = withRetiredShapes({ ...row, status: "blocked", error: "waiting on legal", metadata: { team: "a" } });
    expect(read).toMatchObject({ status: "held", metadata: { team: "a", heldReason: "waiting on legal" } });
    expect(read).not.toHaveProperty("error");
    expect(read).not.toHaveProperty("feedback");
    // A fixed point: read again, unchanged.
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("blocked: the parse path reads the status as held too", () => {
    expect(persistedTaskStatusSchema.parse("blocked")).toBe("held");
  });

  it("recorded: a recorded-not-started row reads as held, without the mark", () => {
    const read = withRetiredShapes({ ...row, status: "pending", undispatched: true });
    expect(read).toMatchObject({ status: "held" });
    expect(read).not.toHaveProperty("undispatched");
  });

  it("recorded: an ended row keeps its status and loses the mark", () => {
    const read = withRetiredShapes({ ...row, status: "cancelled", undispatched: true });
    expect(read).toMatchObject({ status: "cancelled" });
    expect(read).not.toHaveProperty("undispatched");
  });

  it("post (off until FIX-2083): read as stored; its entry routes it to the delegate's ongoing session", () => {
    const post = { ...row, status: "pending", sealed: { kind: "post", session: { key: "delegate:x" } } };
    expect(withRetiredShapes(post)).toBe(post);
    expect(readRetiredShape("post", post)).toMatchObject({ session: "ongoing", sealed: post.sealed });
  });

  it("parked-split (on, FIX-2077): a split parked on its pieces reads as running, waiting on them, with no lease", () => {
    // Stored by the split before FIX-2077: parked, its lease left on the row.
    const split = {
      ...row,
      status: "parked",
      leaseUntil: 5,
      feedback: "Waiting on its pieces.",
      metadata: { splitInto: { session: "s", flow: "f" }, kept: true },
    };
    const read = withRetiredShapes(split) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "in_progress", waitingOn: "filed", metadata: { kept: true } });
    // No lease: a reclaim past the stale deadline must not run the task again (D1).
    expect(read).not.toHaveProperty("leaseUntil");
    expect(read).not.toHaveProperty("feedback");
    expect(read.metadata).not.toHaveProperty("splitInto");
    // A fixed point: a second read returns the same object.
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("reopened (on, FIX-2086): a reopened row in flight reads as pending, with one steer pointing at the session's latest line", () => {
    const reopened = { ...row, status: "pending", attempts: 1, reopened: true, turnReentries: 1, updatedAt: 7 };
    const read = withRetiredShapes(reopened) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "pending", attempts: 1 });
    expect(read).not.toHaveProperty("reopened");
    // Untaken, so the attempt that picks the task up is handed it; from the person who typed the line.
    expect(read.steers).toEqual([
      { id: "reopened", from: "user", at: 7, message: expect.stringContaining("latest line in this session") },
    ]);
    // A fixed point: a second read returns the same object.
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("reopened (on): a reopened row whose attempt is running keeps running, and its request takes the steer", () => {
    const running = { ...row, status: "in_progress", attempts: 2, reopened: true, leaseUntil: 9 };
    const read = withRetiredShapes(running) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "in_progress", attempts: 2, leaseUntil: 9 });
    expect((read.steers as Array<{ takenBy?: number }>)[0]!.takenBy).toBeUndefined();
  });

  it("reopened (on): a reopened row that has finished again only loses the mark: a finished task takes no steer", () => {
    const finished = { ...row, status: "completed", attempts: 2, reopened: true, output: "again" };
    const read = withRetiredShapes(finished) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "completed", output: "again" });
    expect(read).not.toHaveProperty("reopened");
    expect(read).not.toHaveProperty("steers");
  });

  it("parked-for-turn (on, FIX-2086): a row parked for a person's turn re-queues, uncharged", () => {
    const parked = { ...row, status: "parked", parkedForTurn: true, turnReentries: 1, leaseUntil: 5 };
    const read = withRetiredShapes(parked);
    expect(read).toMatchObject({ status: "pending", turnReentries: 2 });
    expect(read).not.toHaveProperty("parkedForTurn");
    expect(read).not.toHaveProperty("leaseUntil");
    expect(withRetiredShapes(read)).toBe(read);
  });
});

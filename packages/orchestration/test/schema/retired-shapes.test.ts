/**
 * The retired-shape map (FIX-2080, epic D3): one read for every task row
 * stored in a shape the epic retires, one test per shape.
 *
 * Two entries are on (`blocked`, `recorded`): their rows read in the current
 * shape at every read boundary. Four are built here and turned on by the
 * issue that stops writing their shape; until then the boundary reads them as
 * stored, and the entry's own read shows what they will read as.
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
  it("turns on exactly the two entries this change stops writing", () => {
    const on = Object.entries(RETIRED_SHAPES)
      .filter(([, entry]) => entry.on)
      .map(([shape]) => shape);
    expect(on.sort()).toEqual(["blocked", "recorded"]);
  });

  it("returns a row in no retired shape as the same object", () => {
    const current = { ...row, status: "pending" };
    expect(withRetiredShapes(current)).toBe(current);
  });

  it("blocked: reads as held, with the block's reason as its note", () => {
    const read = withRetiredShapes({ ...row, status: "blocked", error: "waiting on legal" });
    expect(read).toMatchObject({ status: "held", feedback: "waiting on legal" });
    expect(read).not.toHaveProperty("error");
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

  it("parked-split (off until FIX-2077): read as stored; its entry reads it running", () => {
    const split = { ...row, status: "parked", metadata: { splitInto: { session: "s", flow: "f" } } };
    expect(withRetiredShapes(split)).toBe(split);
    expect(readRetiredShape("parked-split", split)).toMatchObject({ status: "in_progress" });
  });

  it("reopened (off until FIX-2086): read as stored; its entry reads it as a plain pending row", () => {
    const reopened = { ...row, status: "pending", reopened: true };
    expect(withRetiredShapes(reopened)).toBe(reopened);
    const read = readRetiredShape("reopened", reopened);
    expect(read).toMatchObject({ status: "pending" });
    expect(read).not.toHaveProperty("reopened");
  });

  it("parked-for-turn (off until FIX-2086): read as stored; its entry re-queues it uncharged", () => {
    const parked = { ...row, status: "parked", parkedForTurn: true, turnReentries: 1, leaseUntil: 5 };
    expect(withRetiredShapes(parked)).toBe(parked);
    const read = readRetiredShape("parked-for-turn", parked);
    expect(read).toMatchObject({ status: "pending", turnReentries: 2 });
    expect(read).not.toHaveProperty("parkedForTurn");
    expect(read).not.toHaveProperty("leaseUntil");
  });
});

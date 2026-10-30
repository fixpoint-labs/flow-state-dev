/**
 * The retired-shape map (FIX-2080, epic D3): one read for every task row
 * stored in a shape the epic retires, one test per shape.
 *
 * Every entry is on: nothing writes its shape any more, so its rows read in
 * the current shape at every read boundary, and the entry's own read shows
 * what a stored row reads as.
 */
import { describe, expect, it } from "vitest";
import {
  RETIRED_SHAPES,
  withRetiredShapes,
} from "../../src/tasks/schema/retired-shapes";
import { persistedTaskStatusSchema } from "../../src/tasks/schema/task-status";
import { taskSchema } from "../../src/tasks/schema/task";

const row = { id: "t", goal: "t", attempts: 0, createdAt: 1, updatedAt: 1 };

describe("the retired-shape map", () => {
  it("turns on exactly the entries whose shapes nothing writes any more", () => {
    const on = Object.entries(RETIRED_SHAPES)
      .filter(([, entry]) => entry.on)
      .map(([shape]) => shape);
    expect(on.sort()).toEqual(["blocked", "post", "questions", "queued", "recorded", "reopened", "suspendedWait"]); // retired-name-refusal: the reopened shape
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

  it("post (on, FIX-2083): a post row reads as a routed task in the delegate's ongoing session, its result to the conversation", () => {
    // Stored by a coordinator before FIX-2083: the post in its payload, the
    // session it is worked in keyed for the delegate.
    const post = { ...row, status: "pending", assignee: "writer", maxAttempts: 1, sealed: { kind: "post", body: "hi", session: { key: "delegate:x" } } };
    const read = withRetiredShapes(post) as Record<string, unknown>;
    expect(read).toMatchObject({ session: "ongoing", resultTo: "conversation", sealed: post.sealed, assignee: "writer" });
    // A keyed session is the delegate's own: no workstream session to carry.
    expect(read).not.toHaveProperty("targetSessionId");
    // A fixed point: read again, unchanged.
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("post (on, FIX-2083): a workstream post's session, by id, is the session its filing resolved", () => {
    const post = { ...row, status: "pending", sealed: { kind: "post", session: { id: "ws-session" } } };
    const read = withRetiredShapes(post) as Record<string, unknown>;
    expect(read).toMatchObject({ session: "ongoing", resultTo: "conversation", targetSessionId: "ws-session" });
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("reopened (on, FIX-2086): a reopened row in flight reads as pending, with one steer pointing at the session's latest line", () => {
    const reopened = { ...row, status: "pending", attempts: 1, reopened: true, updatedAt: 7 }; // retired-name-refusal: the reopened shape
    const read = withRetiredShapes(reopened) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "pending", attempts: 1 });
    expect(read).not.toHaveProperty("reopened"); // retired-name-refusal: the reopened shape
    // Untaken, so the attempt that picks the task up is handed it; from the person who typed the line.
    expect(read.steers).toEqual([
      { id: "reopened", from: "user", at: 7, message: expect.stringContaining("latest line in this session") }, // retired-name-refusal: the reopened shape
    ]);
    // A fixed point: a second read returns the same object.
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("reopened (on): a reopened row whose attempt is running keeps running, and its request takes the steer", () => {
    const running = { ...row, status: "in_progress", attempts: 2, reopened: true, leaseUntil: 9 }; // retired-name-refusal: the reopened shape
    const read = withRetiredShapes(running) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "in_progress", attempts: 2, leaseUntil: 9 });
    expect((read.steers as Array<{ takenBy?: number }>)[0]!.takenBy).toBeUndefined();
  });

  it("reopened (on): a reopened row that has finished again only loses the mark: a finished task takes no steer", () => {
    const finished = { ...row, status: "completed", attempts: 2, reopened: true, output: "again" }; // retired-name-refusal: the reopened shape
    const read = withRetiredShapes(finished) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "completed", output: "again" });
    expect(read).not.toHaveProperty("reopened"); // retired-name-refusal: the reopened shape
    expect(read).not.toHaveProperty("steers");
  });

  it("queued: a task held open for a message queued to its session reads as answered, waiting on its filed work, with no lease", () => {
    // Stored while a queued message held a task open: running, its work's
    // answer kept, a lease one span out. No message holds a task now; read
    // with a lease, the lapse would run the answered work again.
    const held = { ...row, status: "in_progress", attempts: 1, keptOpenBy: "queued", leaseUntil: 5, output: "the answer" };
    const read = withRetiredShapes(held) as Record<string, unknown>;
    expect(read).toMatchObject({ status: "in_progress", attempts: 1, keptOpenBy: "filed", output: "the answer" });
    expect(read).not.toHaveProperty("leaseUntil");
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("queued: the parse path reads the wait as filed too, rather than failing the row", () => {
    const parsed = taskSchema.parse({ ...row, status: "in_progress", keptOpenBy: "queued" });
    expect(parsed.keptOpenBy).toBe("filed");
    expect(taskSchema.parse(parsed).keptOpenBy).toBe("filed");
  });

  it("queued: only the retired-shape read drops the lease, so it must come before a parse", () => {
    const stored = { ...row, status: "in_progress", keptOpenBy: "queued", leaseUntil: 5 };
    // A bare parse reads the wait as filed but keeps the stored lease.
    expect(taskSchema.parse(stored)).toMatchObject({ keptOpenBy: "filed", leaseUntil: 5 });
    // The read boundary's order: the retired-shape read, then the parse. No lease.
    const parsed = taskSchema.parse(withRetiredShapes(stored));
    expect(parsed.keptOpenBy).toBe("filed");
    expect(parsed.leaseUntil).toBeUndefined();
  });

  // FIX-2317: a question is one kind of hold, so a row FIX-2183 stored with its
  // holds under `questions` still blocks its claim once read.
  const stop = { id: "s1", actor: "user", openedAt: 1, source: { kind: "suspension", requestId: "r", suspensionId: "s1" }, ask: { kind: "review", prompt: "Look?" } };

  it("questions: a row's holds stored as questions read as holds", () => {
    const read = withRetiredShapes({ ...row, status: "in_progress", questions: [stop] });
    expect(read).toMatchObject({ holds: [stop] });
    expect(read).not.toHaveProperty("questions");
    expect(taskSchema.parse(read).holds).toEqual([stop]);
    expect(withRetiredShapes(read)).toBe(read);
  });

  it("questions: a row that has holds keeps them over a stale questions list", () => {
    const read = withRetiredShapes({ ...row, status: "in_progress", holds: [stop], questions: [] });
    expect(read).toMatchObject({ holds: [stop] });
    expect(read).not.toHaveProperty("questions");
  });

  it("suspendedWait: a row kept open by its suspended request reads suspended, on both read paths", () => {
    const stored = { ...row, status: "in_progress", keptOpenBy: "wait" };
    expect(withRetiredShapes(stored)).toMatchObject({ keptOpenBy: "suspended" });
    expect(taskSchema.parse(stored).keptOpenBy).toBe("suspended");
    const read = withRetiredShapes(stored);
    expect(withRetiredShapes(read)).toBe(read);
  });
});

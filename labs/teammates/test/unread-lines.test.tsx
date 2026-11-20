/**
 * What counts toward a teammate's unread: the lines its conversation draws
 * that aren't yours. A line the lab draws as nothing (a stretch of thinking
 * with no tool call, a wait that is the task popup's) must not raise the
 * count, or the list says there is something new where nothing shows.
 */
import { describe, expect, it } from "vitest";
import { unreadable } from "../src/components/WorkersList";
import { call, linesOf, message, thought } from "./lines";

const waitOnTask = { id: "w1", requestId: "q3", status: "completed", itemIndex: 0, ts: 0, provenance: { blockName: "worker", blockInstanceId: "worker", phase: "main" }, type: "suspension", reason: "task_hold", suspensionId: "s1", message: "waits on a task" };

describe("unread lines", () => {
  it("count what the worker said and did, never a stretch of thinking alone or a wait the popup shows", () => {
    const lines = linesOf([message("u1", "q1", "user", "Look into it"), thought("r1", "q1"), message("a1", "q1", "assistant", "On it."), thought("r2", "q2"), waitOnTask]);
    expect(unreadable(lines)).toBe(1);
    expect(unreadable(linesOf([thought("r3", "q4"), call("c1", "q4", "read")]))).toBe(1);
  });
});

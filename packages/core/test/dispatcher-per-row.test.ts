/**
 * A task dispatcher's two per-row choices: which entry a row goes to, and
 * which session it runs in.
 *
 * Both exist so one board can send different rows to different places — a
 * post to one entry in a session already running, a task to another in a
 * child of its own — without a second board. What has to hold is that the
 * choice stays inside what the dispatcher declared: an entry outside `among`
 * is refused before the seam is touched, and an `{ id }` answer is handed to
 * the seam as an existing session (which the engine then delivers into or
 * refuses, never creates). The string `action` and every keyed policy must
 * send exactly what they sent before.
 */
import { describe, expect, it, vi } from "vitest";
import { dispatcher } from "../src";
import {
  DISPATCH_SEAM,
  DispatchRefusedError,
  type DispatchOutcome,
  type DispatchSeam,
  type DispatchSpec,
  type TaskTargetQuery
} from "../src/types/dispatch";
import { createMockContext, runForTest } from "./helpers";

const accepted: DispatchOutcome = { ok: true, sessionId: "s_child", requestId: "req_child", adopted: false };

function seamRecording() {
  const calls: DispatchSpec[] = [];
  const seam: DispatchSeam = vi.fn(async (spec: DispatchSpec) => {
    calls.push(spec);
    return accepted;
  });
  return { seam, calls, ctx: createMockContext({ [DISPATCH_SEAM]: seam }) };
}

function envelope(payload: Record<string, unknown>, taskId = "t1") {
  return { boardId: "work", assignee: "em", taskId, attempt: 1, createdAt: 1, payload };
}

/** Rows that say which entry and session they belong to, as a server-written field would. */
const kindOf = (task: TaskTargetQuery) => (task.input as { kind?: string }).kind ?? "";

describe("a task dispatcher that chooses its entry per row", () => {
  const byKind = () =>
    dispatcher({
      name: "by-kind",
      type: "task",
      action: { among: ["work", "post"], by: kindOf },
      session: "per-task"
    });

  it("sends each row to the entry its choice answers", async () => {
    const { calls, ctx } = seamRecording();
    const block = byKind();
    await runForTest(block, envelope({ kind: "post" }, "t1"), ctx);
    await runForTest(block, envelope({ kind: "work" }, "t2"), ctx);
    expect(calls.map((call) => call.action)).toEqual(["post", "work"]);
  });

  it("refuses an answer outside the declared entries, before anything is dispatched", async () => {
    const { seam, ctx } = seamRecording();
    const error = await runForTest(byKind(), envelope({ kind: "admin" }), ctx).catch((caught) => caught);
    expect(error).toBeInstanceOf(DispatchRefusedError);
    expect((error as DispatchRefusedError).refused).toBe("no-entry");
    expect((error as DispatchRefusedError).message).toMatch(/"admin"/);
    expect(seam).not.toHaveBeenCalled();
  });

  it("carries the choice on its address, so the walk verifies every name it can answer", () => {
    expect(byKind().dispatch).toMatchObject({ type: "task", action: { among: ["work", "post"] } });
  });

  it("refuses a choice with nothing to choose among, a repeated name, or no chooser", () => {
    const build = (action: unknown) => () =>
      dispatcher({ name: "bad", type: "task", action: action as never, session: "per-task" });
    expect(build({ among: [], by: kindOf })).toThrow(/at least one entry/);
    expect(build({ among: ["work", "work"], by: kindOf })).toThrow(/each named once/);
    expect(build({ among: ["work", ""], by: kindOf })).toThrow(/chooses its entry per row/);
    expect(build({ among: ["work"] })).toThrow(/chooses its entry per row/);
  });

  it("refuses a choice on an internal dispatcher — only a task row is chosen for", () => {
    expect(() =>
      dispatcher({
        name: "internal-choice",
        type: "internal",
        action: { among: ["a"], by: () => "a" } as never,
        session: { key: () => "k" }
      })
    ).toThrow(/Only a task dispatcher chooses its entry per row/);
  });

  it("is a task dispatcher from the choice alone when type is omitted", () => {
    const block = dispatcher({ name: "inferred", action: { among: ["work"], by: () => "work" }, session: "per-task" });
    expect(block.dispatch?.type).toBe("task");
  });
});

describe("a task dispatcher that chooses its session per row", () => {
  const bySession = (state?: Record<string, unknown>) =>
    dispatcher({
      name: "by-session",
      type: "task",
      action: "work",
      session: {
        by: (task: TaskTargetQuery) => {
          const sessionId = (task.input as { sessionId?: string }).sessionId;
          return sessionId !== undefined ? { id: sessionId } : { key: `own|${task.taskId}` };
        }
      },
      ...(state !== undefined ? { state } : {})
    });

  it("hands the seam an existing session by id, with no initial state — it is never created", async () => {
    const { calls, ctx } = seamRecording();
    await runForTest(bySession({ seeded: true }), envelope({ sessionId: "s_running" }), ctx);
    expect(calls[0]?.session).toEqual({ id: "s_running" });
  });

  it("hands the seam a keyed child, with the declared initial state, when the row asks for one", async () => {
    const { calls, ctx } = seamRecording();
    await runForTest(bySession({ seeded: true }), envelope({}, "t9"), ctx);
    expect(calls[0]?.session).toEqual({ key: "own|t9", state: { seeded: true } });
  });

  it("refuses an answer that is not exactly one non-empty key or id, before anything is dispatched", async () => {
    for (const answer of [{}, { id: "" }, { key: "k", id: "s" }, { key: 7 }, null]) {
      const { seam, ctx } = seamRecording();
      const block = dispatcher({ name: "bad-session", type: "task", action: "work", session: { by: () => answer as never } });
      await expect(runForTest(block, envelope({}), ctx)).rejects.toThrow(/not one non-empty `key` or `id`/);
      expect(seam).not.toHaveBeenCalled();
    }
  });

  it("is a task dispatcher from the policy alone when type is omitted", () => {
    const block = dispatcher({ name: "inferred", action: "work", session: { by: () => ({ key: "k" }) } });
    expect(block.dispatch?.type).toBe("task");
  });

  it("refuses a policy that both keys and chooses", () => {
    expect(() =>
      dispatcher({
        name: "both",
        type: "task",
        action: "work",
        session: { key: () => "k", by: () => ({ key: "k" }) } as never
      })
    ).toThrow(/must declare a task session policy/);
  });
});

describe("a string action and the keyed policies behave as before", () => {
  it("sends the declared entry under the keys each preset derives", async () => {
    const { calls, ctx } = seamRecording();
    const row = envelope({ goal: "g" });
    await runForTest(dispatcher({ name: "a", type: "task", action: "work", session: "per-task" }), row, ctx);
    await runForTest(dispatcher({ name: "b", type: "task", action: "work", session: "per-worker" }), row, ctx);
    await runForTest(dispatcher({ name: "c", type: "task", action: "work", session: { key: () => "fixed" } }), row, ctx);
    expect(calls.map((call) => [call.action, call.session])).toEqual([
      ["work", { key: "task|4:work|2:t1" }],
      ["work", { key: "worker|4:work|2:em" }],
      ["work", { key: "fixed" }]
    ]);
  });
});

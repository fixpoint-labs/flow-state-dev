/**
 * The check a resend runs again on a message addressed to a task (FIX-2240).
 *
 * Why it matters: a resend goes to the session written on the row. A task
 * reassigned since the send is worked in another session, so checking the
 * task as it reads now checks a session the resend would never reach; the
 * message must end refused, not land in the old session.
 */
import { describe, expect, it, vi } from "vitest";

const current = { sessionId: "sess_task_a" };

vi.mock("../src/messages/message-target", async (original) => {
  const actual = await original<typeof import("../src/messages/message-target")>();
  return {
    ...actual,
    checkTaskTarget: async () => ({ ok: true, target: { sessionId: current.sessionId, worker: { id: "coder" } } })
  };
});

const { recheckRecipient } = await import("../src/messages/send-message");

const row = { from: "otto", to: "coder", addressedBy: "task" as const, toTask: "task_1", toSession: "sess_task_a" };

describe("a resend of a message to a task", () => {
  it("passes while the task is worked in the session on the row, and is refused task_moved once it is worked in another", async () => {
    expect(await recheckRecipient({} as never, {} as never, row)).toBeUndefined();
    current.sessionId = "sess_task_b";
    expect(await recheckRecipient({} as never, {} as never, row)).toMatch(/^task_moved/);
  });
});

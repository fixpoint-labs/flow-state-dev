/**
 * Delegates as a worker's authority (FIX-2081): a session files for its
 * delegates and no one else, `delegates: all` is the user's roster as it
 * stands (D2), and a cancel made from a screen is recorded as an action's.
 * Every leg reads the store, never the action's own say-so.
 */
import { describe, expect, it } from "vitest";
import { bootBoardHost, boardWorkers, messageOf, type BoardHost } from "./conversation-board-harness";

const act = async (host: BoardHost, conv: string, action: string, input: Record<string, unknown>, userId = "alice") => {
  const result = await host.act(userId, conv, action, input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string; tasks?: Array<{ id: string }> };
};

describe("a session files for its delegates and no one else", () => {
  it("refuses a task for a worker on the roster that isn't a delegate, and files nothing", async () => {
    const host = bootBoardHost();
    try {
      // lead's one delegate is eng.tasker; eng.writer is on alice's roster and takes tasks.
      const conv = await host.conversation("alice", "lead");
      const refused = await act(host, conv, "createTask_tasks", { goal: "Write the notes", assignee: "eng.writer" });
      expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "eng\.writer"/) });
      expect(await host.rows("alice")).toEqual([]);
      expect((await act(host, conv, "createTask_tasks", { goal: "Do it", assignee: "eng.tasker" })).ok).toBe(true);
    } finally {
      await host.dispose();
    }
  });
});

describe("delegates: all follows the roster as it changes (D2)", () => {
  it("reaches every task-taker on the roster, and a worker hired mid-conversation at once", async () => {
    const host = bootBoardHost({ standard: boardWorkers({ lead: { delegates: "all" } }) });
    try {
      const conv = await host.conversation("alice", "lead");
      const filing = await host.filingOf("alice", conv);
      const writer = await act(host, conv, "createTask_tasks", { goal: "Write the notes", assignee: "eng.writer" });
      expect(writer.ok).toBe(true);
      // Hired after the conversation began: reachable on the next call, with no copy to refresh.
      expect((await host.hire("alice", { id: "my.tasker", flow: "tasker", instructions: "Mine." })).error).toBeUndefined();
      const hired = await act(host, conv, "createTask_tasks", { goal: "Count the boxes", assignee: "my.tasker" });
      expect(hired.ok).toBe(true);
      await host.settled();
      expect(await host.row("alice", filing, hired.taskId!)).toMatchObject({ status: "completed", assignee: "my.tasker" });
      // Nothing was pinned into the session: the list still follows the roster.
      expect((await host.session(conv)).state.delegates ?? null).toBeNull();
    } finally {
      await host.dispose();
    }
  });

  it("still reaches no one off the roster, and no other user's worker", async () => {
    const host = bootBoardHost({ standard: boardWorkers({ lead: { delegates: "all" } }) });
    try {
      expect((await host.hire("bob", { id: "bobs.tasker", flow: "tasker", instructions: "Bob's." })).error).toBeUndefined();
      const conv = await host.conversation("alice", "lead");
      const refused = await act(host, conv, "createTask_tasks", { goal: "Help", assignee: "bobs.tasker" });
      expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^unknown_assignee: "bobs\.tasker"/) });
      expect(await host.rows("alice")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
});

describe("a screen's cancel is recorded as a public action's", () => {
  it("writes cancelledVia: action on the row", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const filed = await act(host, conv, "createTask_tasks", { goal: "Later", assignee: "eng.tasker", held: true });
      expect((await act(host, conv, "updateTask_tasks", { id: filed.taskId!, status: "cancelled" })).ok).toBe(true);
      expect(await host.row("alice", filing, filed.taskId!)).toMatchObject({ status: "cancelled", cancelledVia: "action" });
    } finally {
      await host.dispose();
    }
  });
});

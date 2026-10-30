/**
 * Watching a conversation's task board stores nothing (FIX-2286).
 *
 * An app reads the board through the `listTasks_tasks` read, `client.flow(f)
 * .read(...)`, instead of running the action of the same name. The read must
 * answer exactly what the action answers, add no request however often it is
 * called, reach only a conversation its caller owns, and never run the
 * board's pass (D2): a row whose start was lost waits for an action, not a
 * look. Every assertion reads the store, not the read's own answer.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@flow-state-dev/client";
import { createInProcessFetch } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

const LIST = "listTasks_tasks";

/** Every request in the store, read from the store itself. */
const requestCount = async (host: BoardHost) => (await (await host.state.getRuntime()).stores.request.list({})).length;

/** `userId`'s client over the host's router, in process. */
function clientOf(host: BoardHost, userId: string) {
  const inProcess = createInProcessFetch(host.state);
  return createClient({
    userId,
    fetcher: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-user", userId);
      return inProcess(input, { ...init, headers });
    }
  });
}

const file = async (host: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await host.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: true; taskId: string };
};

const read = (host: BoardHost, userId: string, conv: string) =>
  clientOf(host, userId).flow("coordinator").read<{ ok: boolean; tasks: Array<{ id: string; status: string }> }>(LIST, {}, { sessionId: conv });

describe("the conversation board's listTasks read (FIX-2286)", () => {
  it("answers what the action answers, and adds no request however often it's called", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker" });
      await file(host, conv, { goal: "Draft the notes", assignee: "eng.tasker", held: true });
      await host.settled();

      const requestsBefore = (await requestCount(host));
      const rowsBefore = JSON.stringify(await host.rows("alice"));
      const reads = [];
      for (let i = 0; i < 10; i += 1) reads.push(await read(host, "alice", conv));
      expect((await requestCount(host))).toBe(requestsBefore);
      expect(JSON.stringify(await host.rows("alice"))).toBe(rowsBefore);

      const acted = await host.act("alice", conv, LIST, {});
      expect(acted.error, messageOf(acted.error)).toBeUndefined();
      expect(reads[0]).toEqual(acted.output);
      expect(reads[0]!.tasks.map((task) => task.status).sort()).toEqual(["completed", "held"]);
      expect(new Set(reads.map((answer) => JSON.stringify(answer))).size).toBe(1);
    } finally {
      await host.dispose();
    }
  });

  it("answers another user as for a conversation that doesn't exist", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker", held: true });
      await expect(read(host, "bob", conv)).rejects.toMatchObject({ status: 404 });
      // The control: the same call as alice is answered.
      expect((await read(host, "alice", conv)).tasks).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("never runs the board's pass: a row whose start was lost waits for an action, not a read (D2)", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const held = await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker", held: true });
      await host.settled();
      // Released by a write that sent no wake: the row is startable, and owed a pass.
      const filing = await host.filingOf("alice", conv);
      const { partition: _partition, ...row } = (await host.row("alice", filing, held.taskId))!;
      await host.writeRow("alice", filing, { ...(row as Task), status: "pending" } as Task);

      const requestsBefore = (await requestCount(host));
      expect((await read(host, "alice", conv)).tasks).toEqual([expect.objectContaining({ id: held.taskId, status: "pending" })]);
      await host.settled();
      expect((await requestCount(host))).toBe(requestsBefore);
      expect((await host.row("alice", filing, held.taskId))?.status).toBe("pending");

      // The action's touch does run it.
      expect((await host.act("alice", conv, LIST, {})).error).toBeUndefined();
      await host.settled();
      expect((await host.row("alice", filing, held.taskId))?.status).toBe("completed");
    } finally {
      await host.dispose();
    }
  });
});

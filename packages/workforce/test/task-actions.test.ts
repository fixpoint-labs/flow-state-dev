/**
 * A board's task actions from the browser client (FIX-2381): an app cancels,
 * steers, releases and re-files a conversation board's tasks through
 * orchestration's Inbox client, over the real router as the signed-in user,
 * naming no action and building no payload.
 *
 * Every leg reads the row back from the store, never the helper's own answer
 * alone. Two controls must turn the legs red: actions bound to a board the
 * flow doesn't have, and the refusal read dropped (in orchestration's unit
 * tests, where the routine lives).
 */
import { describe, expect, it } from "vitest";
import { createInboxClient, type RefileRow, type TaskBoardAt } from "@flow-state-dev/orchestration/inbox";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** A gate a `[hold:<name>]` task waits on, and its release. */
function gate() {
  let open!: () => void;
  const shut = new Promise<void>((resolve) => (open = resolve));
  return { shut, open };
}

async function file(host: BoardHost, conv: string, input: Record<string, unknown>): Promise<string> {
  const result = await host.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  expect(result.output.ok, JSON.stringify(result.output)).toBe(true);
  return result.output.taskId as string;
}

/** One row of the conversation's board, as `alice`'s browser reads it: the fields the board exposes, nothing more. */
async function browserRow(host: BoardHost, sessionId: string, taskId: string): Promise<Record<string, unknown>> {
  const path = ["sessions", sessionId, "resources", "tasks"];
  const router = (await host.state.getRouter()) as any;
  const response: Response = await router.GET(new Request(`http://localhost/api/flows/${path.join("/")}`, { headers: { "x-user": "alice" } }), { params: { path } });
  const body = (await response.json()) as { items?: Array<{ clientData: Record<string, unknown> }> };
  const found = body.items?.find((item) => item.clientData.id === taskId)?.clientData;
  if (found === undefined) throw new Error(`the browser's read has no row ${taskId}`);
  return found;
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`${what}: still ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("a board's task actions, through the Inbox client, on a real conversation board", () => {
  it("releases, steers, cancels and re-files, each read back from the row", async () => {
    const work = gate();
    const host = bootBoardHost({ holds: new Map([["work", work.shut]]) });
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const row = (id: string) => host.row("alice", filing, id);
      const tasks = createInboxClient(host.fsd("alice")).board({ flowId: "coordinator", sessionId: conv, board: "tasks" });

      // Release: a held row starts once released, and runs until its gate opens.
      const id = await file(host, conv, { goal: "[hold:work] Audit licenses", title: "Audit", context: "All repos", assignee: "eng.tasker", labels: ["audit"], priority: 2, held: true });
      expect((await row(id))?.status).toBe("held");
      await tasks.release(id);
      await until(() => row(id), (r) => r?.status === "in_progress", "the released task never started");

      // Steer: the words join the open task's steers.
      await tasks.steer(id, "Skip the archived repos");
      expect((await row(id))?.steers?.map((s) => s.message)).toContain("Skip the archived repos");

      // Cancel: the row ends cancelled, and its dependent goes with it, named.
      const dependent = await file(host, conv, { goal: "Report on the audit", assignee: "eng.tasker", deps: [id] });
      const took = await tasks.cancel(id);
      expect(took).toEqual([dependent]);
      expect((await row(id))?.status).toBe("cancelled");
      expect((await row(dependent))?.status).toBe("cancelled");

      // Refusals: a finished task takes no steer and no second cancel, in the board's words, and nothing is written.
      const before = await row(id);
      await expect(tasks.steer(id, "again")).rejects.toThrow(/task_finished/);
      await expect(tasks.cancel(id)).rejects.toThrow(/cancelled/);
      expect(await row(id)).toEqual(before);

      // Re-file, from the row as a browser reads it: a new row with the whole brief, the override winning.
      const seen = await browserRow(host, conv, id);
      const again = await tasks.refile(seen as unknown as RefileRow, { goal: "Audit licenses, active repos only" });
      expect(again).not.toBe(id);
      expect(await row(again)).toMatchObject({
        goal: "Audit licenses, active repos only",
        title: "Audit",
        context: "All repos",
        assignee: "eng.tasker",
        labels: ["audit"],
        priority: 2,
      });
      work.open();
      await host.settled();
    } finally {
      work.open();
      await host.dispose();
    }
  }, 30_000);

  it("retries a failed task: the same id runs again and finishes", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const row = (id: string) => host.row("alice", filing, id);
      const tasks = createInboxClient(host.fsd("alice")).board({ flowId: "coordinator", sessionId: conv, board: "tasks" });
      const id = await file(host, conv, { goal: "[fail-until:2] Audit licenses", assignee: "eng.tasker", maxAttempts: 1 });
      await until(() => row(id), (r) => r?.status === "errored", "the task never failed");
      await tasks.retry(id);
      const done = await until(() => row(id), (r) => r?.status === "completed", "the retried task never finished");
      expect(done?.id).toBe(id);
      expect(host.runs.filter((r) => r.taskId === id).map((r) => r.attempt)).toEqual([1, 2]);
      // A finished task isn't retried, in the board's words.
      await expect(tasks.retry(id)).rejects.toThrow(/follow-up|completed/);
      await host.settled();
    } finally {
      await host.dispose();
    }
  }, 30_000);

  it("control wrong-board: actions bound to a board the flow doesn't have refuse every leg, and write nothing", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const id = await file(host, conv, { goal: "Audit licenses", assignee: "eng.tasker", held: true });
      const at: TaskBoardAt = { flowId: "coordinator", sessionId: conv, board: "plan" };
      const tasks = createInboxClient(host.fsd("alice")).board(at);
      await expect(tasks.release(id)).rejects.toThrow();
      await expect(tasks.steer(id, "x")).rejects.toThrow();
      await expect(tasks.cancel(id)).rejects.toThrow();
      await expect(tasks.retry(id)).rejects.toThrow();
      await expect(tasks.refile({ goal: "Audit licenses", assignee: "eng.tasker" })).rejects.toThrow();
      expect((await host.row("alice", filing, id))?.status).toBe("held");
      expect((await host.rows("alice")).length).toBe(1);
    } finally {
      await host.dispose();
    }
  }, 30_000);
});

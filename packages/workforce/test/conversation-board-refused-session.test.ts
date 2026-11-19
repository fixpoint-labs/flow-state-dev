/**
 * A session whose every turn is refused settles what its board owes it
 * (FIX-2849).
 *
 * Why it matters: its board's pass never runs again, so a debt left owed is
 * never paid, and a wake left kept fires forever. Every refusal settles, not
 * only a firing; a settle that fails keeps the wake, so the next refused turn
 * tries again; and a task that failed for good is reported once, under the
 * board it is on.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { filingSessionIdOf } from "../src/conversation-board/filing-session";
import { settleRefusedSession } from "../src/conversation-board/refused-session";
import { ERROR_REPORTER_INTAKE_FLOW, INTAKE_ENTRY } from "../src/error-reporter/keys";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
};

const file = async (host: BoardHost, userId: string, conv: string, input: Record<string, unknown>) => {
  const result = await host.act(userId, conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string };
};

/** An Error Reporter intake that records each occurrence it is handed. */
function recordingIntake(taken: Array<Record<string, unknown>>): FlowInstance {
  const intake = handler({
    name: "recording-intake",
    inputSchema: z.object({ occurrence: z.record(z.string(), z.unknown()) }),
    execute: (input) => {
      taken.push(input.occurrence);
      return { decision: "new" };
    }
  });
  const flow = defineFlow({ kind: ERROR_REPORTER_INTAKE_FLOW, actions: {}, internal: { actions: { [INTAKE_ENTRY]: intake } } } as never);
  return (flow as unknown as (options: { id: string }) => FlowInstance)({ id: ERROR_REPORTER_INTAKE_FLOW });
}

describe("a refused session's board debts", () => {
  it("are settled for a refusal that is not a firing too: a worker moved to another flow", async () => {
    // A session stays on the flow it was created on, so a worker moved off it
    // refuses every turn there, as a fired one does.
    const host = bootBoardHost();
    try {
      const hired = await host.hire("alice", {
        id: "my.desk",
        flow: "coordinator",
        settings: { delegates: ["eng.tasker"], routing: "best-fit", fallback: "eng.tasker" }
      });
      expect(hired.error, messageOf(hired.error)).toBeUndefined();
      const conv = await host.conversation("alice", "my.desk");
      const filing = await host.filingOf("alice", conv);
      const filed = await file(host, "alice", conv, { goal: "moved off [slow:150]", assignee: "eng.tasker" });
      for (let i = 0; i < 100 && host.runs.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      const moved = await host.act("alice", "roster-alice", "edit", { id: "my.desk", flow: "tasker", settings: {} }, "roster");
      expect(moved.error, messageOf(moved.error)).toBeUndefined();
      expect(
        await until(async () => (await host.row("alice", filing, filed.taskId!))?.metadata?.["noticeUndeliverable:1:completed"] != null)
      ).toBe(true);
      const task = await host.row("alice", filing, filed.taskId!);
      expect(task?.status).toBe("completed");
      expect(task?.metadata?.["noticeOwed:1:completed"]).toBeNull();
      expect((task?.metadata?.["noticeUndeliverable:1:completed"] as { detail: string }).detail).toMatch(
        /^its worker can't run there: Worker "my\.desk" now runs on flow "tasker"/
      );
    } finally {
      await host.dispose();
    }
  });

  it("keep the wake when they can't all be settled, so the next refused turn tries again", async () => {
    // A session with no lineage id has no board partition to read: the scan
    // fails before anything is settled.
    const settles: unknown[] = [];
    const ctx = {
      session: { identity: { id: "s1" }, state: {} },
      emit: { message: () => {} },
      requestHost: {
        wakes: {
          read: async () => ({ dueAt: 0, landBy: 0, version: 1 }),
          settle: async (...args: unknown[]) => {
            settles.push(args);
            return "cleared";
          }
        }
      }
    } as unknown as BlockContext;
    expect(await settleRefusedSession(ctx, "its worker was fired")).toMatch(/no lineageId/);
    expect(settles).toEqual([]);
  });

  it("report a task that failed for good once, under the board it is on, from a session with a board above", async () => {
    const taken: Array<Record<string, unknown>> = [];
    const host = bootBoardHost({ plainFlows: { [ERROR_REPORTER_INTAKE_FLOW]: recordingIntake(taken) } });
    try {
      expect((await host.hire("alice", { id: "my.tasker", flow: "tasker", instructions: "Mine." })).error).toBeUndefined();
      const conv = await host.conversation("alice", "desk");
      const convFiling = await host.filingOf("alice", conv);
      expect((await host.act("alice", conv, "addDelegate", { worker: "my.tasker" })).error).toBeUndefined();
      await file(host, "alice", conv, { goal: "work it [slow:150]", assignee: "my.tasker" });
      for (let i = 0; i < 100 && host.runs.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      const taskSession = host.runs[0]!.sessionId;
      await host.settled();
      const record = await (await host.state.getRuntime()).stores.session.get(taskSession);
      const ownFiling = await filingSessionIdOf({ identity: { id: taskSession }, ...(record?.lineageId != null ? { lineageId: record.lineageId } : {}) });
      expect(ownFiling).not.toBe(convFiling);
      expect((await host.fire("alice", "my.tasker")).error).toBeUndefined();
      // A piece the task session filed on its own board failed for good, and its notice is owed there.
      const [template] = await host.rows("alice");
      const piece: Task = {
        ...template!,
        id: "task_piece_failed",
        goal: "the piece",
        status: "errored",
        filer: { sessionId: taskSession },
        metadata: { "noticeOwed:1:errored": { attempt: 1, ending: "errored", error: "the piece broke" } }
      } as Task;
      await host.writeRow("alice", ownFiling, piece);
      taken.length = 0;
      // Any turn of the task session is refused, and settles what its board owes it.
      await host.act("alice", taskSession, "respond", { message: "still there?" }, "tasker");
      await host.settled();
      expect((await host.row("alice", ownFiling, piece.id))?.metadata?.["noticeUndeliverable:1:errored"]).toMatchObject({
        detail: "its worker was fired"
      });
      const reports = taken.filter((occurrence) => occurrence.taskId === piece.id);
      expect(reports.map((occurrence) => occurrence.partition)).toEqual([ownFiling]);
    } finally {
      await host.dispose();
    }
  });
});

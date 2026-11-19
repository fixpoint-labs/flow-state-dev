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

  /**
   * A fired worker's task session (a session with a board above) whose own
   * board owes an errored notice, and one refused turn of it. What the
   * session's board then holds for the piece, and the turn's error.
   */
  async function refusedTurnOwingAFailure(host: BoardHost, taken: Array<Record<string, unknown>>) {
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
    const turn = await host.act("alice", taskSession, "respond", { message: "still there?" }, "tasker");
    await host.settled();
    const metadata = (await host.row("alice", ownFiling, piece.id))?.metadata ?? {};
    return { metadata, ownFiling, pieceId: piece.id, error: messageOf(turn.error) };
  }

  it("keep the wake to when the next debt falls due, as the payers answer it", async () => {
    // Why: a debt due later (a question's deadline, a wait slot's next look, a
    // message's resend) can't be paid now. Cleared, the wake that would have
    // paid it then is gone.
    const settled: Array<number | null> = [];
    const ctx = {
      session: { identity: { id: "s1" }, lineageId: "l1", state: {} },
      resources: {},
      emit: { message: () => {} },
      requestHost: {
        wakes: {
          read: async () => ({ dueAt: 0, landBy: 0, version: 1 }),
          settle: async (_entry: string, _read: unknown, next: number | null) => {
            settled.push(next);
            return next === null ? "cleared" : "moved";
          }
        }
      }
    } as unknown as BlockContext;
    const due = Date.now() + 60_000;
    expect(await settleRefusedSession(ctx, "its worker was fired", async () => due)).toContain("still owed");
    expect(settled).toEqual([due]);
  });

  it("clear only the wake as it stood before the boards were read: a debt landing meanwhile keeps its wake", async () => {
    // Why: a notice written while the refused turn reads its boards owes the
    // wake again (a new version). Cleared at that version, the notice the
    // read never saw is left with no wake.
    let version = 1;
    const settled: number[] = [];
    const ctx = {
      session: { identity: { id: "s1" }, lineageId: "l1", state: {} },
      resources: {},
      emit: { message: () => {} },
      requestHost: {
        wakes: {
          read: async () => ({ dueAt: 0, landBy: 0, version }),
          settle: async (_entry: string, read: { version: number }) => {
            settled.push(read.version);
            return "cleared";
          }
        }
      }
    } as unknown as BlockContext;
    // A debt lands while the boards are read: the wake is owed again.
    const payMessages = async () => {
      version = 2;
      return undefined;
    };
    expect(await settleRefusedSession(ctx, "its worker was fired", payMessages)).toBeUndefined();
    expect(settled).toEqual([1]);
  });

  it("report a task that failed for good once, under the board it is on, from a session with a board above", async () => {
    const taken: Array<Record<string, unknown>> = [];
    const host = bootBoardHost({ plainFlows: { [ERROR_REPORTER_INTAKE_FLOW]: recordingIntake(taken) } });
    try {
      const { metadata, ownFiling, pieceId } = await refusedTurnOwingAFailure(host, taken);
      expect(metadata["noticeUndeliverable:1:errored"]).toMatchObject({ detail: "its worker was fired" });
      const reports = taken.filter((occurrence) => occurrence.taskId === pieceId);
      expect(reports.map((occurrence) => occurrence.partition)).toEqual([ownFiling]);
    } finally {
      await host.dispose();
    }
  });

  it("keep a failure owed when the Error Reporter doesn't take its report, so it goes again", async () => {
    // Why: the notice is the only record that the failure is still to be
    // reported. Settled before the intake took it, the failure is lost.
    const host = bootBoardHost({ plainFlows: { [ERROR_REPORTER_INTAKE_FLOW]: refusingIntake() } });
    try {
      const { metadata, error } = await refusedTurnOwingAFailure(host, []);
      expect(metadata["noticeOwed:1:errored"]).toMatchObject({ attempt: 1, ending: "errored" });
      expect(metadata["noticeUndeliverable:1:errored"] ?? null).toBeNull();
      // Not the refusal: an ordinary failure, so the wake is kept and the next refused turn tries again.
      expect(error).toContain("couldn't all be settled yet");
    } finally {
      await host.dispose();
    }
  });
});

describe("a refused session's other board debts", () => {
  /**
   * A fired coordinator's conversation, with `task` written onto its own
   * board as a crash would leave it, and one refused turn of it. The task as
   * the board then holds it, and the turn's error.
   */
  async function refusedOwing(host: BoardHost, shape: (template: Task) => Task, turns = 1) {
    const hired = await host.hire("alice", {
      id: "my.desk",
      flow: "coordinator",
      settings: { delegates: ["eng.tasker"], routing: "best-fit", fallback: "eng.tasker" }
    });
    expect(hired.error, messageOf(hired.error)).toBeUndefined();
    const conv = await host.conversation("alice", "my.desk");
    const filing = await host.filingOf("alice", conv);
    await file(host, "alice", conv, { goal: "a first one", assignee: "eng.tasker" });
    await host.settled();
    const [template] = await host.rows("alice");
    expect((await host.fire("alice", "my.desk")).error).toBeUndefined();
    const task = shape(template!);
    await host.writeRow("alice", filing, task);
    const errors: string[] = [];
    for (let i = 0; i < turns; i += 1) {
      try {
        const turn = await host.act("alice", conv, "listTasks_tasks", {});
        errors.push(messageOf(turn.error) ?? "");
      } catch (error) {
        errors.push((error as Error).message);
      }
      await host.settled();
    }
    return { task: await host.row("alice", filing, task.id), errors };
  }

  it("pay a cancel owed: the board's own repair runs, not only the notice scan", async () => {
    // Why: the pass that would cancel it never runs again. Left owed, the
    // task stays open, and the wake that was its only way out is cleared.
    const host = bootBoardHost();
    try {
      // A second refused turn finds nothing left owed.
      const { task, errors } = await refusedOwing(
        host,
        // A cancel is owed only on a row a request waited on (its wait slot).
        (template) =>
          ({
            ...template,
            id: "task_cancel_owed",
            goal: "stopped wait",
            status: "pending",
            cancelOwed: true,
            wait: { gateId: "gate_stopped", requestId: "req_stopped", sessionId: template.filer?.sessionId ?? "s", deadline: Date.now() + 60_000 },
            metadata: {}
          }) as unknown as Task,
        2
      );
      expect(task?.status).toBe("cancelled");
      expect(task?.cancelOwed ?? false).toBe(false);
      // The last turn is the refusal itself: nothing is left owed.
      expect(errors.at(-1)).toContain('Worker "my.desk" was fired');
      expect(errors.at(-1)).not.toContain("still owed");
    } finally {
      await host.dispose();
    }
  });

  it("keep no wake for a claimed task's lease end: its ending owes a wake of its own", async () => {
    // Why: a lease end held the wake would start one refused request each
    // lease, for as long as the task runs. The task's ending owes its notice
    // and a fresh wake, and is settled then.
    const host = bootBoardHost();
    try {
      const { task, errors } = await refusedOwing(host, (template) => ({
        ...template,
        id: "task_still_running",
        goal: "still running",
        status: "in_progress",
        leaseUntil: Date.now() + 60_000,
        metadata: {}
      }) as Task);
      expect(task?.status).toBe("in_progress");
      expect(errors[0]).toContain('Worker "my.desk" was fired');
      expect(errors[0]).not.toContain("still owed");
    } finally {
      await host.dispose();
    }
  });

  it("keep the wake while a debt can't be paid yet: the turn fails as a failure that may pass", async () => {
    // A resume owed to a gate that isn't there yet (the waiting turn hasn't
    // parked) can't be paid now, so the wake must stay for the next try.
    const host = bootBoardHost();
    try {
      const { task, errors } = await refusedOwing(host, (template) => ({
        ...template,
        id: "task_resume_owed",
        goal: "waited on",
        status: "completed",
        resumeOwed: true,
        wait: { gateId: "gate_not_parked_yet", requestId: "req_waiting", sessionId: template.filer?.sessionId ?? "s", deadline: Date.now() + 60_000 },
        metadata: {}
      }) as unknown as Task);
      expect(task?.resumeOwed).toBe(true);
      expect(errors[0]).toContain("still owed: the next debt falls due at");
    } finally {
      await host.dispose();
    }
  });
});

/** An Error Reporter flow whose intake entry is missing: every report is refused, and none is taken. */
function refusingIntake(): FlowInstance {
  const flow = defineFlow({ kind: ERROR_REPORTER_INTAKE_FLOW, actions: {}, internal: { actions: {} } } as never);
  return (flow as unknown as (options: { id: string }) => FlowInstance)({ id: ERROR_REPORTER_INTAKE_FLOW });
}

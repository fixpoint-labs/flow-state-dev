/**
 * A worker session is born carrying the names a reader calls it by (FIX-2881).
 *
 * The developer tool's flow tree labels a session from its own state only. A
 * hired worker's name lives on its owner's roster and a task's title on the
 * conversation's board, so both are written into the session when it is
 * created: the name by the installation's create check, from the worker it
 * reads, and the title by the board's hand-over. A caller can't write either.
 */
import { describe, expect, it } from "vitest";
import { bootBoardHost, messageOf } from "./conversation-board-harness";

describe("the names a worker session is born with", () => {
  it("names a hired worker's conversation by the worker's roster name", async () => {
    const host = bootBoardHost();
    try {
      const hired = await host.hire("alice", { id: "my.lead", flow: "coordinator", name: "Tess" });
      expect(hired.error, messageOf(hired.error)).toBeUndefined();
      const conv = await host.conversation("alice", "my.lead");
      const session = await host.session(conv);
      expect(session.state).toMatchObject({ workerId: "my.lead", workerName: "Tess" });
      expect(host.installation.session().label!({ id: conv, state: session.state as never })).toBe("Tess");
    } finally {
      await host.dispose();
    }
  });

  it("names a hired worker's task session by the worker's name and the task's title", async () => {
    const host = bootBoardHost();
    try {
      expect((await host.hire("alice", { id: "my.tasker", flow: "tasker", name: "Tess", instructions: "Mine." })).error).toBeUndefined();
      const conv = await host.conversation("alice", "mixed");
      expect((await host.act("alice", conv, "addDelegate", { worker: "my.tasker" })).error).toBeUndefined();
      const filed = await host.act("alice", conv, "createTask_tasks", { title: "Audit licenses", goal: "Audit the licenses of every dependency", assignee: "my.tasker" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      await host.settled();
      const [run] = host.runs;
      expect(run).toBeDefined();
      const session = await host.session(run!.sessionId);
      expect(session.state).toMatchObject({ workerId: "my.tasker", workerName: "Tess", taskTitle: "Audit licenses" });
      expect(host.installation.session().label!({ id: run!.sessionId, state: session.state as never })).toBe("Tess · Audit licenses");
    } finally {
      await host.dispose();
    }
  });

  it("names a task with no title by its goal", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: "Audit licenses", assignee: "eng.tasker" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      await host.settled();
      const session = await host.session(host.runs[0]!.sessionId);
      expect(session.state).toMatchObject({ workerId: "eng.tasker", taskTitle: "Audit licenses" });
    } finally {
      await host.dispose();
    }
  });

  it("refuses a create that names the worker or the task itself", async () => {
    const host = bootBoardHost();
    try {
      for (const seeded of [{ workerName: "Someone else" }, { taskTitle: "A decoy" }]) {
        const created = await host.create("alice", "coordinator", { state: { workerId: "lead", ...seeded } });
        expect(created.status).toBe(400);
        expect(created.body.error).toMatch(new RegExp(Object.keys(seeded)[0]!));
      }
    } finally {
      await host.dispose();
    }
  });
});

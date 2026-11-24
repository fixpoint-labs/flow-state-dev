/**
 * A worker flow's no-pick assignee (FIX-2877 D2): a task a model's turn files
 * for one of the flow's workers, from outside the flow's work, goes to the
 * worker the flow names, whatever the model wrote. A user's own move on the
 * board (an action) keeps the worker they named, and so does a filing from a
 * session on that flow. Read back from the stored rows, never the tool's answer.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator } from "@flow-state-dev/testing";
import { TaskWriteRefusedError } from "@flow-state-dev/orchestration/internal";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import type { NoPickAssignee } from "../src/workers/worker-flow";

/** A judgment turn that files one task for `assignee`, then answers. */
const filing = (assignee: string) =>
  mockGenerator({
    script: [
      { toolCalls: [{ toolCallId: "c1", toolName: "createTask", args: { goal: "Write the notes", assignee } }] },
      { text: "Filed it." },
      { text: "It's done." }
    ]
  });

/** `worker`'s conversation as alice, after one turn asking for the notes. */
const ask = async (host: BoardHost, worker: string) => {
  const conv = await host.conversation("alice", worker);
  const turn = await host.act("alice", conv, "respond", { message: "get the notes written" });
  expect(turn.error, messageOf(turn.error)).toBeUndefined();
  await host.settled();
  return conv;
};

describe("a model's task for a worker whose flow names its no-pick assignee", () => {
  it("goes to the worker the flow names, whatever the model wrote", async () => {
    const asked: string[] = [];
    const noPickAssignee: NoPickAssignee = async (ctx) => {
      asked.push(String((ctx.session.state as Record<string, unknown>).workerId));
      return "eng.writer";
    };
    const host = bootBoardHost({ judgment: filing("eng.tasker"), registration: { tasker: { noPickAssignee } } });
    try {
      await ask(host, "pm");
      const tasks = await host.rows("alice");
      expect(tasks.map((task) => [task.goal, task.assignee, task.status])).toEqual([["Write the notes", "eng.writer", "completed"]]);
      expect(host.runs.map((run) => run.worker)).toEqual(["eng.writer"]);
      // Decided on the filer's own turn, from its server-written session.
      expect(asked).toEqual(["pm"]);
    } finally {
      await host.dispose();
    }
  });

  it("keeps the model's worker when the flow names none (control: the rule, not the model, moved it)", async () => {
    const host = bootBoardHost({ judgment: filing("eng.tasker") });
    try {
      await ask(host, "pm");
      expect((await host.rows("alice")).map((task) => task.assignee)).toEqual(["eng.tasker"]);
    } finally {
      await host.dispose();
    }
  });

  it("keeps the model's worker when the flow's rule answers none", async () => {
    const host = bootBoardHost({ judgment: filing("eng.tasker"), registration: { tasker: { noPickAssignee: async () => undefined } } });
    try {
      await ask(host, "pm");
      expect((await host.rows("alice")).map((task) => task.assignee)).toEqual(["eng.tasker"]);
    } finally {
      await host.dispose();
    }
  });

  it("is refused with the flow's reason, and nothing is filed, when the rule refuses", async () => {
    const noPickAssignee: NoPickAssignee = async () => {
      throw new TaskWriteRefusedError("no_default_coder", "no coding worker runs the default. Nothing was filed.");
    };
    const host = bootBoardHost({ judgment: filing("eng.tasker"), registration: { tasker: { noPickAssignee } } });
    try {
      const conv = await ask(host, "pm");
      expect(await host.rows("alice")).toEqual([]);
      // The model read the refusal back as the tool's answer.
      const items = (await host.requestsOf(conv)).flatMap((request) => (request as { items?: Array<{ type: string; output?: unknown }> }).items ?? []);
      expect(items.filter((item) => item.type === "tool_output").map((item) => item.output)).toContainEqual({
        ok: false,
        error: "no_default_coder: no coding worker runs the default. Nothing was filed."
      });
    } finally {
      await host.dispose();
    }
  });

  it("is never applied to a user's own move: the board's createTask action keeps the worker they named", async () => {
    const host = bootBoardHost({ registration: { tasker: { noPickAssignee: async () => "eng.writer" } } });
    try {
      const conv = await host.conversation("alice", "pm");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: "Write the notes", assignee: "eng.tasker" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      await host.settled();
      expect((await host.rows("alice")).map((task) => task.assignee)).toEqual(["eng.tasker"]);
    } finally {
      await host.dispose();
    }
  });

  it("keeps the model's worker on a filing from a session on that same flow", async () => {
    // boss runs on the coordinator flow and files for lead, another coordinator: that filing is the flow's own work.
    const host = bootBoardHost({ judgment: filing("lead"), registration: { coordinator: { noPickAssignee: async () => "pm" } } });
    try {
      await ask(host, "boss");
      expect((await host.rows("alice")).map((task) => task.assignee)).toEqual(["lead"]);
    } finally {
      await host.dispose();
    }
  });
});

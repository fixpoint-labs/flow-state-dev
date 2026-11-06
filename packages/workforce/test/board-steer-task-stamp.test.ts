/**
 * A steer sent through the board (`updateTask`, as a task's Steer button
 * sends it) is answered in the turn it is owed (`STEER_TURN_ENTRY`), in the
 * task's session. That turn shows the steer as a line and runs the worker's
 * reply, and both are stamped with the steered task's id, so a task view that
 * reads the session's stored items after a reload (`itemsForTask`) still finds
 * them. The board path never goes through the worker door, so the door's
 * `taskOf` stamp doesn't reach it.
 *
 * Red state produced before this was trusted: without the steer turn's mark,
 * the line and the reply are stored with no `taskId`.
 *
 * The host is the conversation board's (`./conversation-board-harness`).
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf } from "./conversation-board-harness";
import type { WorkerManifest } from "../src/manifest";

const workers = (): WorkerManifest[] => [
  ...boardWorkers(),
  { id: "chief", declared: { flow: "coordinator", delegates: ["otto"] }, body: "Hand the work to otto.", skills: [] }
];

const STEER = "Mention the new flag too.";
const REPLY = "Added the new flag.";

describe("a steer sent through the board", () => {
  it("stores its line and the worker's reply under the steered task, so the task's view finds them after a reload", async () => {
    // Hold otto's first model call open after it answers: the steer lands
    // after the task's last model call, so it is owed a turn of its own.
    let release!: () => void;
    let reached!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const atHold = new Promise<void>((resolve) => (reached = resolve));
    let calls = 0;
    const agentAnswer = mockGenerator({
      script: [{ text: "first draft" }, { text: REPLY }]
    });
    const h = bootBoardHost({
      standard: workers(),
      agentAnswer,
      judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }),
      afterModelCall: async (block) => {
        if (block === undefined || !block.startsWith("agent-answer")) return;
        calls += 1;
        if (calls !== 1) return;
        reached();
        await released;
      }
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await h.act("alice", conv, "createTask_tasks", { goal: "Write the release note", assignee: "otto" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const taskId = (filed.output as { taskId: string }).taskId;
      await atHold;

      // The board's steer, not the door: what a task's Steer button sends.
      const steered = await h.act("alice", conv, "updateTask_tasks", { id: taskId, message: STEER });
      expect(steered.output).toEqual({ ok: true });
      release();
      await h.settled();

      const row = (await h.row("alice", filing, taskId)) as Task;
      expect(row).toMatchObject({ status: "completed", attempts: 1 });
      expect(agentAnswer.calls).toHaveLength(2);

      // What a reload reads: the task session's stored requests, nothing the app remembered.
      const requests = await h.requestsOf(row.run!.sessionId);
      const steerTurn = requests.find((request) => request.actionName === "onTaskSteered");
      expect(steerTurn, "the steer's owed turn ran in the task's session").toBeDefined();
      const messages = ((steerTurn as unknown as { items?: any[] }).items ?? [])
        .filter((item) => item.type === "message")
        .map((item) => ({
          text: (item.content ?? []).map((part: { text?: string }) => part.text ?? "").join(""),
          role: item.role as string | undefined,
          taskId: item.taskId as string | undefined
        }));
      // The steer is alice's own line, in her words; the reply is the worker's.
      expect(messages).toEqual([
        { text: STEER, role: "user", taskId },
        { text: REPLY, role: "assistant", taskId }
      ]);
    } finally {
      await h.dispose();
    }
  }, 20_000);
});

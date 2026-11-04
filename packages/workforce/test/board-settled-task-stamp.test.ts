/**
 * A task session that files a piece waits on it, and the piece's ending
 * reaches the session as a notice (`onTaskSettled`). That request runs for
 * the waiting task: it lands the ending as a line under the piece's worker,
 * wakes the worker's turn, and that turn's answer becomes the task's output.
 * The line and the reply are stamped with the waiting task's id, so a task
 * view that reads the session's stored items after a reload (`itemsForTask`)
 * still finds them. A notice never passes the door, so the door's stamp
 * doesn't reach it; the steer turn's own mark is `board-steer-task-stamp.test.ts`.
 *
 * Red state produced before this was trusted: without the notice turn's mark,
 * the line and the reply are stored with no `taskId`.
 *
 * The host is the conversation board's (`./conversation-board-harness`):
 * `boss` files a task for `lead`, a coordinator, whose task turn files a piece
 * for `eng.tasker`.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import type { GeneratorModel } from "@flow-state-dev/core/types";
import { bootBoardHost, messageOf } from "./conversation-board-harness";

const PIECE = "Book the venue";
const REPLY = "The venue is booked.";

/**
 * The judgment turn, step by step: lead's task turn files the piece on its
 * first call, and every later call answers. The turn the piece's ending wakes
 * answers {@link REPLY}; the rest answer "Noted.".
 */
function judgmentModel(): GeneratorModel {
  let filed = false;
  return {
    modelId: "settled-notice-judgment",
    async generate() {
      throw new Error("the judgment turn is driven step by step");
    },
    async generateStep(options) {
      if (!filed) {
        filed = true;
        return {
          toolCalls: [{ toolCallId: "f1", toolName: "createTask", args: { goal: PIECE, assignee: "eng.tasker" } }],
          finishReason: "tool-calls"
        };
      }
      const seen = JSON.stringify(options.messages);
      const onPieceEnding = seen.includes(`completed by eng.tasker`) && seen.includes("You are lead.");
      return { text: onPieceEnding ? REPLY : "Noted.", finishReason: "stop" };
    }
  };
}

describe("a settled piece's notice in its task's session", () => {
  it("stores its line and the turn's reply under the waiting task, so the task's view finds them after a reload", async () => {
    const h = bootBoardHost({ judgmentModel: judgmentModel() });
    try {
      const conv = await h.conversation("alice", "boss");
      const filing = await h.filingOf("alice", conv);
      const filed = await h.act("alice", conv, "createTask_tasks", { goal: "Ship the release", assignee: "lead" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const taskId = (filed.output as { taskId: string }).taskId;
      await h.settled();

      // The notice's turn answered for the task: its reply is the task's output.
      const row = (await h.row("alice", filing, taskId)) as Task;
      expect(row).toMatchObject({ status: "completed", output: REPLY });

      // What a reload reads: the task session's stored requests, nothing the app remembered.
      const requests = await h.requestsOf(row.run!.sessionId);
      const notices = requests.filter((request) => request.actionName === "onTaskSettled");
      expect(notices, "the piece's notice ran in the task's session").toHaveLength(1);
      const messages = ((notices[0] as unknown as { items?: any[] }).items ?? [])
        .filter((item) => item.type === "message")
        .map((item) => ({
          text: (item.content ?? []).map((part: { text?: string }) => part.text ?? "").join(""),
          taskId: item.taskId as string | undefined
        }));
      expect(messages).toEqual([
        { text: expect.stringContaining(`Task "${PIECE}"`), taskId },
        { text: REPLY, taskId }
      ]);

      // The filing conversation runs no task: its notice of the task's ending
      // stays unstamped, or the chat would hide it as a task's own work.
      const above = (await h.requestsOf(conv)).filter((request) => request.actionName === "onTaskSettled");
      expect(above).toHaveLength(1);
      const aboveItems = ((above[0] as unknown as { items?: any[] }).items ?? []).filter((item) => item.type === "message");
      expect(aboveItems.length).toBeGreaterThan(0);
      expect(aboveItems.map((item) => item.taskId)).toEqual(aboveItems.map(() => undefined));
    } finally {
      await h.dispose();
    }
  }, 20_000);
});

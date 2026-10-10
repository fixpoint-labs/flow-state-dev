/**
 * Orchestration's task-turn test (`isTaskTurn`, FIX-1816 BR-5a) reads the
 * task session's `taskId` under `TASK_SESSION_TASK_KEY`. Workforce's hand-over
 * writes that field as `TASK_ID_STATE_KEY`, and its worker flows refuse it
 * from any caller. Both hold here: the names agree, and a caller can't open a
 * session that claims to work a task.
 */
import { describe, expect, it } from "vitest";
import { TASK_SESSION_TASK_KEY } from "@flow-state-dev/orchestration";
import { TASK_ID_STATE_KEY } from "../src/workers/keys";
import { bootBoardHost } from "./conversation-board-harness";

describe("the task session's taskId, as the task-turn test reads it", () => {
  it("is the field Workforce's hand-over writes", () => {
    expect(TASK_ID_STATE_KEY).toBe(TASK_SESSION_TASK_KEY);
  });

  it("can't be set by a caller opening a worker session", async () => {
    const host = bootBoardHost();
    try {
      const created = await host.create("alice", "agent", { state: { workerId: "otto", [TASK_ID_STATE_KEY]: "task_forged" } });
      expect(created.status).toBe(400);
    } finally {
      await host.dispose();
    }
  });
});

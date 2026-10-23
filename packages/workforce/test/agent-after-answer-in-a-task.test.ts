/**
 * The agent worker's after-answer step in a task (FIX-2088 D1 and its
 * amendment).
 *
 * - **A task whose result goes to its filer:** a capture that fails fails the
 *   attempt, like any background step, and the task runs again.
 * - **A task whose result goes to the conversation:** it has one attempt, so a
 *   failed capture is logged and the task ends with its answer, as a
 *   conversation turn does. Without this a delegate's right answer would
 *   become a failure line over a missed memory write.
 *
 * On the real engine, through the board host: a `front` conversation files a
 * task for `otto`, an agent worker whose after-answer step throws on its first
 * run in each task session.
 */
import { describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";
import { TASK_ID_STATE_KEY } from "../src/workers/keys";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** An after-answer step that fails its first run in each task session, as a capture that times out once does. */
function flakyCapture() {
  const failed = new Set<string>();
  return handler({
    name: "flaky-capture",
    inputSchema: z.unknown(),
    execute: (_input, ctx) => {
      const taskId = (ctx.session.state as Record<string, unknown> | undefined)?.[TASK_ID_STATE_KEY];
      if (typeof taskId !== "string" || failed.has(taskId)) return;
      failed.add(taskId);
      throw new Error("capture timed out");
    }
  });
}

const file = async (host: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await host.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  const output = result.output as { ok: boolean; taskId?: string };
  expect(output.ok).toBe(true);
  return output.taskId!;
};

function host(): BoardHost {
  return bootBoardHost({
    agentAnswer: mockGenerator({ script: [{ when: () => true, then: { text: "Otto's answer." } }] }),
    agent: { afterAnswer: flakyCapture() }
  });
}

describe("the after-answer step in a task (FIX-2088 D1)", () => {
  it("fails the attempt of a task whose result goes to its filer, and the task runs again", async () => {
    const h = host();
    try {
      const conv = await h.conversation("alice", "front");
      const filing = await h.filingOf("alice", conv);
      const taskId = await file(h, conv, { goal: "Look into refunds", assignee: "otto" });
      await h.settled();

      const row = await h.row("alice", filing, taskId);
      expect(row).toMatchObject({ status: "completed", attempts: 2, output: "Otto's answer." });
      // The failed attempt's feedback names the app's own block, not the wrapper around it.
      expect(row?.feedback).toContain('Background work "flaky-capture" failed: capture timed out');
    } finally {
      await h.dispose();
    }
  });

  it("logs a failed capture in a task whose result goes to the conversation, and the task ends with its answer", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = host();
    try {
      const conv = await h.conversation("alice", "front");
      const filing = await h.filingOf("alice", conv);
      const taskId = await file(h, conv, { goal: "Look into refunds", assignee: "otto", resultTo: "conversation" });
      await h.settled();

      const row = await h.row("alice", filing, taskId);
      expect(row).toMatchObject({ status: "completed", attempts: 1, output: "Otto's answer." });
      expect(row?.feedback).toBeUndefined();
      expect(logged.mock.calls.some((call) => call.join(" ").includes("capture timed out"))).toBe(true);
    } finally {
      logged.mockRestore();
      await h.dispose();
    }
  });
});

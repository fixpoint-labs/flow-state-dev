/**
 * An ask on a conversation's board (FIX-1816 S9, V7): the coordinator's turn
 * files a task with `waitForResponse` and parks; the task's ending reaches the
 * conversation through the same notice every ending sends, and there it
 * resumes the parked turn with the answer, waking no judgment turn and landing
 * no line. A task filed without waiting still wakes a turn (FIX-1794's notices
 * are unchanged; their own suite is `conversation-board-notices.test.ts`).
 *
 * Nothing here calls the waker: the task session's notice, or a later touch
 * of the board by the person, is what resumes the turn.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** What each tool call returned, in the messages a model call is handed. */
function toolResults(messages: unknown): string {
  const out: string[] = [];
  for (const m of (messages ?? []) as Array<Record<string, unknown>>) {
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    for (const part of m.content as Array<Record<string, unknown>>) {
      if (part.type === "tool-result") out.push(JSON.stringify(part.output));
    }
  }
  return out.join(" | ");
}

/**
 * The coordinator's judgment as a step model: its first step asks with a
 * waiting `addTask` for `goal`, and the step after the answer replies with
 * `reply(answer)`. Every call is kept in `seen`.
 */
function askingJudgment(goal: string, reply: (results: string) => string) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "asking-judgment",
    async generate() {
      throw new Error("the judgment turn is driven step by step");
    },
    async generateStep(options) {
      seen.push(options);
      const results = toolResults(options.messages);
      if (results === "") {
        return {
          toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal, assignee: "eng.tasker", waitForResponse: true } }],
          finishReason: "tool-calls"
        };
      }
      return { text: reply(results), finishReason: "stop" };
    }
  };
  return { model, seen };
}

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 5000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
};

const statusOf = async (host: BoardHost, requestId: string) =>
  (await (await host.state.getRuntime()).stores.request.get(requestId))?.status;

/** A durable host whose router has built its durability sweeper, so `addTask` offers the wait. */
async function askingHost(judgment: ReturnType<typeof mockGenerator> | GeneratorModel) {
  const host = bootBoardHost(
    "generateStep" in judgment ? { judgmentModel: judgment as GeneratorModel, durable: true } : { judgment, durable: true }
  );
  await host.state.getRouter();
  return host;
}

describe("an asked task's ending resumes the turn that asked (V7)", { timeout: 30_000 }, () => {
  it("resumes the parked turn with the answer, and wakes no other turn and lands no line", async () => {
    const judgment = askingJudgment("Count licenses", (results) =>
      results.includes("eng.tasker did: Count licenses") ? "There are twelve." : `unexpected: ${results}`
    );
    const host = await askingHost(judgment.model);
    try {
      const conv = await host.conversation("alice", "lead");
      const asked = await host.act("alice", conv, "run", { message: "how many licenses do we have?" });
      expect(asked.error, messageOf(asked.error)).toBeUndefined();
      expect(await statusOf(host, asked.requestId!)).toBe("suspended");

      // The task runs, its session tells the conversation, and the notice resumes the turn.
      expect(await until(async () => (await statusOf(host, asked.requestId!)) === "completed")).toBe(true);
      await host.settled();

      // The same turn carried on with the answer as its tool's result: two steps, one turn.
      expect(judgment.seen).toHaveLength(2);
      expect(toolResults(judgment.seen[1]!.messages)).toContain('"answer":"eng.tasker did: Count licenses"');
      const replies = (await host.messages(conv)).map((m) => m.text);
      expect(replies.filter((text) => text === "There are twelve.")).toHaveLength(1);
      // No line: the answer was the call's result, not a post.
      expect(replies.filter((text) => text.includes("completed by eng.tasker"))).toEqual([]);
      // No second turn was woken.
      const turns = (await host.requestsOf(conv)).filter((r) => r.actionName === "run");
      expect(turns.map((r) => r.id)).toEqual([asked.requestId]);

      const [row] = await host.rows("alice");
      expect(row).toMatchObject({ status: "completed" });
      expect(row!.resumeOwed ?? false).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("a notice lost after the ending is paid by the person's next touch of the board, once (BR-11)", async () => {
    const judgment = askingJudgment("Count seats", (results) =>
      results.includes("eng.tasker did: Count seats") ? "Forty seats." : `unexpected: ${results}`
    );
    const host = await askingHost(judgment.model);
    try {
      const conv = await host.conversation("alice", "lead");
      // Every notice's send is lost, as a process dying after the ending's write would lose it.
      const lost = await host.loseDispatches("onTaskSettled");
      const asked = await host.act("alice", conv, "run", { message: "how many seats?" });
      expect(await until(async () => (await host.rows("alice"))[0]?.status === "completed")).toBe(true);
      await host.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      expect(await statusOf(host, asked.requestId!)).toBe("suspended");
      expect((await host.rows("alice"))[0]!.resumeOwed).toBe(true);
      lost.restore();

      // The person looks at the conversation's task list: a touch of the board.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      expect(await until(async () => (await statusOf(host, asked.requestId!)) === "completed")).toBe(true);
      await host.settled();
      // And again: nothing is owed, nothing resumes twice.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      await host.settled();

      expect(judgment.seen).toHaveLength(2);
      expect((await host.messages(conv)).filter((m) => m.text === "Forty seats.")).toHaveLength(1);
      expect((await host.rows("alice"))[0]!.resumeOwed ?? false).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("a task filed without waiting still wakes the judgment turn when it ends", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "addTask", args: { goal: "Count laptops", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Nine laptops." } }
      ]
    });
    const host = await askingHost(judgment);
    try {
      const conv = await host.conversation("alice", "lead");
      const filed = await host.act("alice", conv, "run", { message: "count laptops" });
      expect(await statusOf(host, filed.requestId!)).toBe("completed");
      await host.settled();
      // The filing's turn, then a second turn the notice woke (the mock runs a turn's tool loop in one call).
      expect(await until(() => judgment.calls.length === 2)).toBe(true);
      await host.settled();
      expect(JSON.stringify(judgment.calls[1]!.input)).toContain("completed by eng.tasker");
    } finally {
      await host.dispose();
    }
  });
});

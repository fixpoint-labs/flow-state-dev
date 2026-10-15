/**
 * A wait on a conversation's board (FIX-1816 S9, V7): the coordinator's turn
 * dispatches a task with `wait` and parks; the task's ending reaches the
 * conversation through the same notice every ending sends, and there it
 * resumes the parked turn with the answer, waking no judgment turn and landing
 * no line. A task filed without waiting still wakes a turn (FIX-1794's notices
 * are unchanged; their own suite is `conversation-board-notices.test.ts`).
 *
 * Nothing here calls the waker: the task session's notice, or a later touch
 * of the board by the user, is what resumes the turn.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorModel, GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { mockGenerator } from "@flow-state-dev/testing";
import { runAction } from "@flow-state-dev/engine";
import { bootBoardHost, messageOf, ORG, type BoardHost } from "./conversation-board-harness";

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
 * The coordinator's judgment as a step model: its first step waits with a
 * waiting `dispatchTask` for `goal`, and the step after the answer replies with
 * `reply(answer)`. Every call is kept in `seen`.
 */
function waitingJudgment(goal: string, reply: (results: string) => string) {
  const seen: GeneratorModelCallOptions[] = [];
  const model: GeneratorModel = {
    modelId: "waiting-judgment",
    async generate() {
      throw new Error("the judgment turn is driven step by step");
    },
    async generateStep(options) {
      seen.push(options);
      const results = toolResults(options.messages);
      if (results === "") {
        return {
          toolCalls: [{ toolCallId: "a1", toolName: "dispatchTask", args: { goal, assignee: "eng.tasker", wait: true } }],
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

/** A durable host whose router has built its durability sweeper, so `dispatchTask` offers the wait. */
async function waitingHost(judgment: ReturnType<typeof mockGenerator> | GeneratorModel) {
  const host = bootBoardHost(
    "generateStep" in judgment ? { judgmentModel: judgment as GeneratorModel, durable: true } : { judgment, durable: true }
  );
  await host.state.getRouter();
  return host;
}

describe("a waited-on task's ending resumes the turn that waits on it (V7)", { timeout: 30_000 }, () => {
  it("resumes the parked turn with the answer, and wakes no other turn and lands no line", async () => {
    const judgment = waitingJudgment("Count licenses", (results) =>
      results.includes("eng.tasker did: Count licenses") ? "There are twelve." : `unexpected: ${results}`
    );
    const host = await waitingHost(judgment.model);
    try {
      const conv = await host.conversation("alice", "lead");
      const waiting = await host.act("alice", conv, "run", { message: "how many licenses do we have?" });
      expect(waiting.error, messageOf(waiting.error)).toBeUndefined();
      expect(await statusOf(host, waiting.requestId!)).toBe("suspended");

      // The task runs, its session tells the conversation, and the notice resumes the turn.
      expect(await until(async () => (await statusOf(host, waiting.requestId!)) === "completed")).toBe(true);
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
      expect(turns.map((r) => r.id)).toEqual([waiting.requestId]);

      const [row] = await host.rows("alice");
      expect(row).toMatchObject({ status: "completed" });
      expect(row!.resumeOwed ?? false).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("a notice lost after the ending is paid by the user's next touch of the board, once (BR-11)", async () => {
    const judgment = waitingJudgment("Count workers", (results) =>
      results.includes("eng.tasker did: Count workers") ? "Forty workers." : `unexpected: ${results}`
    );
    const host = await waitingHost(judgment.model);
    try {
      const conv = await host.conversation("alice", "lead");
      // Every notice's send is lost, as a process dying after the ending's write would lose it.
      const lost = await host.loseDispatches("onTaskSettled");
      const waiting = await host.act("alice", conv, "run", { message: "how many workers?" });
      expect(await until(async () => (await host.rows("alice"))[0]?.status === "completed")).toBe(true);
      await host.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      expect(await statusOf(host, waiting.requestId!)).toBe("suspended");
      expect((await host.rows("alice"))[0]!.resumeOwed).toBe(true);
      lost.restore();

      // The user looks at the conversation's task list: a touch of the board.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      expect(await until(async () => (await statusOf(host, waiting.requestId!)) === "completed")).toBe(true);
      await host.settled();
      // And again: nothing is owed, nothing resumes twice.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      await host.settled();

      expect(judgment.seen).toHaveLength(2);
      expect((await host.messages(conv)).filter((m) => m.text === "Forty workers.")).toHaveLength(1);
      expect((await host.rows("alice"))[0]!.resumeOwed ?? false).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  for (const [label, failOnce] of [
    ["throws", (): Promise<never> => Promise.reject(new Error("the store blinked"))],
    ["is turned away as busy", () => Promise.resolve({ ok: false as const, refused: "busy" as const, detail: "another resume holds the turn" })]
  ] as const) {
    it(`a resume that ${label} on the notice is retried by the user's next touch, once (BR-11)`, async () => {
      const judgment = waitingJudgment("Count desks", (results) =>
        results.includes("eng.tasker did: Count desks") ? "Thirty desks." : `unexpected: ${results}`
      );
      const host = await waitingHost(judgment.model);
      try {
        // The host's wait resume fails the first time it is called, then works.
        const requestHost = (await host.state.getRuntime()).runtimeConfig.requestHost as { waitResume: (input: unknown) => Promise<unknown> };
        const real = requestHost.waitResume;
        let calls = 0;
        requestHost.waitResume = (input) => (++calls === 1 ? failOnce() : real(input));

        const conv = await host.conversation("alice", "lead");
        const waiting = await host.act("alice", conv, "run", { message: "how many desks?" });
        expect(await until(async () => (await host.rows("alice"))[0]?.status === "completed")).toBe(true);
        await host.settled();
        expect(calls).toBeGreaterThanOrEqual(1);
        expect(await statusOf(host, waiting.requestId!)).toBe("suspended");
        expect((await host.rows("alice"))[0]!.resumeOwed).toBe(true);

        // The user looks at the task list: a touch of the board, never a turn.
        expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
        expect(await until(async () => (await statusOf(host, waiting.requestId!)) === "completed")).toBe(true);
        await host.settled();
        expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
        await host.settled();

        expect(judgment.seen).toHaveLength(2);
        expect((await host.messages(conv)).filter((m) => m.text === "Thirty desks.")).toHaveLength(1);
        const [row] = await host.rows("alice");
        expect(row!.resumeOwed ?? false).toBe(false);
        const owed = Object.entries(row!.metadata ?? {}).filter(([key, value]) => key.startsWith("noticeOwed:") && value !== null);
        expect(owed).toEqual([]);
      } finally {
        await host.dispose();
      }
    });
  }

  it("a board run whose resume throws still delivers another row's owed notice", async () => {
    const judgment = waitingJudgment("Count chairs", () => "unused");
    const host = await waitingHost(judgment.model);
    try {
      // Every resume fails: the waited-on row keeps owing its turn.
      const requestHost = (await host.state.getRuntime()).runtimeConfig.requestHost as { waitResume: (input: unknown) => Promise<unknown> };
      requestHost.waitResume = () => Promise.reject(new Error("the store blinked"));

      const conv = await host.conversation("alice", "lead");
      await host.act("alice", conv, "run", { message: "how many chairs?" });
      expect(await until(async () => (await host.rows("alice"))[0]?.status === "completed")).toBe(true);
      await host.settled();
      expect((await host.rows("alice"))[0]!.resumeOwed).toBe(true);

      // A second task, filed without waiting, whose notice is lost on the way: it is owed only on its row.
      const lost = await host.loseDispatches("onTaskSettled");
      const filed = await host.act("alice", conv, "dispatchTask_tasks", { goal: "Count tables", assignee: "eng.tasker" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const tables = (filed.output as { taskId: string }).taskId;
      expect(await until(async () => (await host.rows("alice")).find((r) => r.id === tables)?.status === "completed")).toBe(true);
      await host.settled();
      lost.restore();
      const owedOn = async (id: string) =>
        Object.entries((await host.rows("alice")).find((r) => r.id === id)!.metadata ?? {}).filter(
          ([key, value]) => key.startsWith("noticeOwed:") && value !== null
        );
      expect(await owedOn(tables)).toHaveLength(1);

      // A run of the board, with no touch before it: its after-run step resumes, which throws, and then replays.
      const runtime = await host.state.getRuntime();
      const run = await runAction({
        flow: host.instances.coordinator!,
        actionName: "runTaskBoard",
        input: {},
        userId: "alice",
        orgId: ORG,
        sessionId: conv,
        source: "internal",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      } as never);
      expect(run.error, messageOf(run.error)).toBeUndefined();
      await host.settled();
      expect(await owedOn(tables)).toEqual([]);
      expect((await host.rows("alice")).find((r) => r.id !== tables)!.resumeOwed).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  it("a task filed without waiting still wakes the judgment turn when it ends", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "dispatchTask", args: { goal: "Count laptops", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Nine laptops." } }
      ]
    });
    const host = await waitingHost(judgment);
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

describe("a task session's turn that asks to wait", { timeout: 30_000 }, () => {
  it("is refused, and told how its task can wait: file without `wait` and end the turn", async () => {
    const seen: GeneratorModelCallOptions[] = [];
    const judgment: GeneratorModel = {
      modelId: "task-turn-judgment",
      async generate() {
        throw new Error("driven step by step");
      },
      async generateStep(options) {
        seen.push(options);
        const asked = JSON.stringify(options.messages ?? []);
        if (toolResults(options.messages) === "" && asked.includes("Ship the release") && !asked.includes("completed by")) {
          return {
            toolCalls: [{ toolCallId: "w1", toolName: "dispatchTask", args: { goal: "Check the build", assignee: "eng.tasker", wait: true } }],
            finishReason: "tool-calls"
          };
        }
        return { text: "Done.", finishReason: "stop" };
      }
    };
    const host = await waitingHost(judgment);
    try {
      // boss hands lead a task; lead's task turn, which files for its own delegate, asks to wait.
      const conv = await host.conversation("alice", "boss");
      const filed = await host.act("alice", conv, "dispatchTask_tasks", { goal: "Ship the release", assignee: "lead" });
      expect(filed.output).toMatchObject({ ok: true });
      await host.settled();
      const refusal = seen.map((call) => toolResults(call.messages)).find((results) => results.includes("wait_unavailable"));
      expect(refusal).toBeDefined();
      expect(refusal).toContain("file it without `wait`, then end this turn");
      expect(refusal).toContain("its ending wakes this task");
      expect((await host.rows("alice")).filter((row) => row.goal === "Check the build")).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
});

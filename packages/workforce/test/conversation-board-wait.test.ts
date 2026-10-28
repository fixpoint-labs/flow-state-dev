/**
 * A wait on a conversation's board (FIX-1816 S9, V7; `getTask` since
 * FIX-2082): the coordinator's turn files a task with `createTask`, then waits
 * on it with `getTask({ id, wait: true })` and parks; the task's ending reaches
 * the conversation through the same notice every ending sends, and there it
 * resumes the parked turn with the task as it ended, waking no judgment turn
 * and landing no line. A task filed without waiting still wakes a turn
 * (FIX-1794's notices are unchanged; their own suite is
 * `conversation-board-notices.test.ts`).
 *
 * The task is held open (`[hold:<name>]`) until the turn has parked, so every
 * test here parks rather than reading an ending that won the race. Nothing
 * calls the waker: the task session's notice, or a later touch of the board
 * by the user, is what resumes the turn.
 */
import { describe, expect, it } from "vitest";
import { NOTICE_DUE_MS } from "@flow-state-dev/orchestration/tasks";
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

/** The id the turn's `createTask` returned, in the tool results so far. */
const filedId = (results: string) => /"taskId":"([^"]+)"/.exec(results)?.[1];

/**
 * The coordinator's judgment as a step model: its first step files `goal`
 * with `createTask`, its second waits on that task with `getTask`'s `wait`,
 * and the step after the read replies with `reply(results)`. Every call is
 * kept in `seen`.
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
          toolCalls: [{ toolCallId: "f1", toolName: "createTask", args: { goal, assignee: "eng.tasker" } }],
          finishReason: "tool-calls"
        };
      }
      if (!results.includes('"task":')) {
        return {
          toolCalls: [{ toolCallId: "w1", toolName: "getTask", args: { id: filedId(results), wait: true } }],
          finishReason: "tool-calls"
        };
      }
      return { text: reply(results), finishReason: "stop" };
    }
  };
  return { model, seen };
}

/** A gate a `[hold:<name>]` task waits on, and the call that opens it. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
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

/** The host's wait resume, as a test replaces it. */
type WaitResume = (input: unknown) => Promise<unknown>;

/**
 * A durable host whose router has built its durability sweeper, so `getTask`
 * offers the wait. A `[hold:g]` task waits on `held` until the test opens it.
 *
 * @param resume Replaces the host's wait resume, given the real one. Put on
 *   the shared request host before the router is built: the router serves
 *   HTTP requests from its own copy of the request host, made then, so a
 *   resume replaced after it reaches only the requests run in process, and
 *   an HTTP-started board pass would still resume with the real one.
 */
async function waitingHost(judgment: ReturnType<typeof mockGenerator> | GeneratorModel, held = gate(), resume?: (real: WaitResume) => WaitResume) {
  const holds = new Map([["g", held.opened]]);
  const host = bootBoardHost(
    "generateStep" in judgment
      ? { judgmentModel: judgment as GeneratorModel, durable: true, holds }
      : { judgment, durable: true, holds }
  );
  if (resume !== undefined) {
    const requestHost = (await host.state.getRuntime()).runtimeConfig.requestHost as { waitResume: WaitResume };
    requestHost.waitResume = resume(requestHost.waitResume);
  }
  await host.state.getRouter();
  return host;
}

/** Until the request parks on its wait, then open the gate its task is held on. */
async function parkThenRelease(host: BoardHost, requestId: string, held: ReturnType<typeof gate>) {
  expect(await until(async () => (await statusOf(host, requestId)) === "suspended")).toBe(true);
  held.release();
}

describe("a waited-on task's ending resumes the turn that waits on it (V7)", { timeout: 30_000 }, () => {
  it("resumes the parked turn with the task as it ended, and wakes no other turn and lands no line", async () => {
    const judgment = waitingJudgment("Count licenses [hold:g]", (results) =>
      results.includes('"status":"completed"') && results.includes("eng.tasker did: Count licenses")
        ? "There are twelve."
        : `unexpected: ${results}`
    );
    const held = gate();
    const host = await waitingHost(judgment.model, held);
    try {
      const conv = await host.conversation("alice", "lead");
      const waiting = await host.act("alice", conv, "respond", { message: "how many licenses do we have?" });
      expect(waiting.error, messageOf(waiting.error)).toBeUndefined();
      expect(await statusOf(host, waiting.requestId!)).toBe("suspended");
      held.release();

      // The task runs, its session tells the conversation, and the notice resumes the turn.
      expect(await until(async () => (await statusOf(host, waiting.requestId!)) === "completed")).toBe(true);
      await host.settled();

      // The same turn carried on with the ended task as its read's result: three steps, one turn.
      expect(judgment.seen).toHaveLength(3);
      expect(toolResults(judgment.seen[2]!.messages)).toContain('"output":"eng.tasker did: Count licenses');
      const replies = (await host.messages(conv)).map((m) => m.text);
      expect(replies.filter((text) => text === "There are twelve.")).toHaveLength(1);
      // No line: the answer was the call's result, not a post.
      expect(replies.filter((text) => text.includes("completed by eng.tasker"))).toEqual([]);
      // No second turn was woken.
      const turns = (await host.requestsOf(conv)).filter((r) => r.actionName === "respond");
      expect(turns.map((r) => r.id)).toEqual([waiting.requestId]);

      const [row] = await host.rows("alice");
      expect(row).toMatchObject({ status: "completed" });
      expect(row!.resumeOwed ?? false).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it("a waited-on task's ending starts no onTaskSettled: the conversation's pass resumes the turn, once (FIX-2078)", async () => {
    const judgment = waitingJudgment("Count workers [hold:g]", (results) =>
      results.includes("eng.tasker did: Count workers") ? "Forty workers." : `unexpected: ${results}`
    );
    const held = gate();
    const host = await waitingHost(judgment.model, held);
    try {
      const conv = await host.conversation("alice", "lead");
      const waiting = await host.act("alice", conv, "respond", { message: "how many workers?" });
      await parkThenRelease(host, waiting.requestId!, held);
      expect(await until(async () => (await statusOf(host, waiting.requestId!)) === "completed", 8_000)).toBe(true);
      await host.settled();
      // A touch after: nothing is owed, nothing resumes twice.
      expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
      await host.settled();

      const settled = (await host.requestsOf(conv)).filter((r) => r.actionName === "onTaskSettled");
      expect(settled).toEqual([]);
      expect(judgment.seen).toHaveLength(3);
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
    it(`a resume that ${label} is retried at its due time, with no touch, once (BR-11, FIX-2078)`, async () => {
      const judgment = waitingJudgment("Count desks [hold:g]", (results) =>
        results.includes("eng.tasker did: Count desks") ? "Thirty desks." : `unexpected: ${results}`
      );
      const held = gate();
      // The host's wait resume fails the first time it is called, then works.
      let calls = 0;
      const host = await waitingHost(judgment.model, held, (real) => (input) => (++calls === 1 ? failOnce() : real(input)));
      try {

        const conv = await host.conversation("alice", "lead");
        const waiting = await host.act("alice", conv, "respond", { message: "how many desks?" });
        await parkThenRelease(host, waiting.requestId!, held);
        expect(await until(async () => (await host.rows("alice"))[0]?.status === "completed")).toBe(true);
        expect(await until(() => calls >= 1)).toBe(true);

        // Nothing touches the board: the pass's wake, moved to the resume's due
        // time, fires again and the second resume works. Never a turn.
        expect(await until(async () => (await statusOf(host, waiting.requestId!)) === "completed", 8_000)).toBe(true);
        await host.settled();
        expect((await host.act("alice", conv, "listTasks_tasks", {})).error).toBeUndefined();
        await host.settled();

        expect(judgment.seen).toHaveLength(3);
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
    const judgment = waitingJudgment("Count chairs [hold:g]", () => "unused");
    // The second task's notice wakes the judgment turn too. That turn says a
    // line and files nothing: run on the waiting script, it filed chairs again
    // and waited on them, a second waiting turn whose fate hung on timing.
    const model: GeneratorModel = {
      ...judgment.model,
      async generateStep(options) {
        if (JSON.stringify(options.messages).includes("Count tables")) return { text: "Noted.", finishReason: "stop" };
        return judgment.model.generateStep!(options);
      }
    };
    const held = gate();
    // Every resume fails, on every request the host serves: the waited-on row keeps owing its turn.
    const host = await waitingHost(model, held, () => () => Promise.reject(new Error("the store blinked")));
    try {

      const conv = await host.conversation("alice", "lead");
      const waiting = await host.act("alice", conv, "respond", { message: "how many chairs?" });
      await parkThenRelease(host, waiting.requestId!, held);
      expect(await until(async () => (await host.rows("alice"))[0]?.status === "completed")).toBe(true);
      await host.settled();
      const chairs = (await host.rows("alice"))[0]!.id;
      expect((await host.rows("alice"))[0]!.resumeOwed).toBe(true);

      // A second task, filed without waiting, whose notice is lost on the way: it is owed only on its row.
      const lost = await host.loseDispatches("onTaskSettled");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: "Count tables", assignee: "eng.tasker" });
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

      // A run of the board, with no touch before it, once the lost notice is past
      // due: its repairs resume, which throws, and then resend it (FIX-2078).
      await new Promise((resolve) => setTimeout(resolve, NOTICE_DUE_MS + 200));
      const runtime = await host.state.getRuntime();
      const run = await runAction({
        flow: host.instances.coordinator!,
        actionName: "dispatch",
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
      // The waited-on row still owes its resume, and no other row was filed.
      expect((await host.rows("alice")).map((r) => r.id).sort()).toEqual([chairs, tables].sort());
      expect((await host.rows("alice")).find((r) => r.id === chairs)!.resumeOwed).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  it("a task filed without waiting still wakes the judgment turn when it ends", async () => {
    const judgment = mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "createTask", args: { goal: "Count laptops", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Nine laptops." } }
      ]
    });
    const host = await waitingHost(judgment);
    try {
      const conv = await host.conversation("alice", "lead");
      const filed = await host.act("alice", conv, "respond", { message: "count laptops" });
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

describe("a task session's turn that waits on a task it filed (FIX-2082)", { timeout: 30_000 }, () => {
  it("waits, reads the task as it ended, and answers its own task from it", async () => {
    const seen: GeneratorModelCallOptions[] = [];
    const judgment: GeneratorModel = {
      modelId: "task-turn-judgment",
      async generate() {
        throw new Error("driven step by step");
      },
      async generateStep(options) {
        seen.push(options);
        const asked = JSON.stringify(options.messages ?? []);
        const results = toolResults(options.messages);
        if (!asked.includes("Ship the release") || asked.includes("completed by")) return { text: "Done.", finishReason: "stop" };
        if (results === "") {
          return {
            toolCalls: [{ toolCallId: "f1", toolName: "createTask", args: { goal: "Check the build", assignee: "eng.tasker" } }],
            finishReason: "tool-calls"
          };
        }
        if (!results.includes('"task":')) {
          return { toolCalls: [{ toolCallId: "w1", toolName: "getTask", args: { id: filedId(results), wait: true } }], finishReason: "tool-calls" };
        }
        return { text: results.includes("eng.tasker did: Check the build") ? "The build is green." : `unexpected: ${results}`, finishReason: "stop" };
      }
    };
    const host = await waitingHost(judgment);
    try {
      // boss hands lead a task; lead's task turn files for its own delegate and waits on it.
      const conv = await host.conversation("alice", "boss");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: "Ship the release", assignee: "lead" });
      expect(filed.output).toMatchObject({ ok: true });
      const shipped = async () => (await host.rows("alice")).find((row) => row.goal === "Ship the release")?.status === "completed";
      expect(await until(shipped, 10_000)).toBe(true);
      await host.settled();

      const rows = await host.rows("alice");
      expect(rows.find((row) => row.goal === "Check the build")).toMatchObject({ status: "completed" });
      // lead answered its task from the task it waited on, in the turn that waited.
      expect(rows.find((row) => row.goal === "Ship the release")).toMatchObject({ status: "completed", output: "The build is green." });
      const read = seen.map((call) => toolResults(call.messages)).find((results) => results.includes('"task":'));
      expect(read).toContain('"status":"completed"');
      expect(read).not.toContain("wait_unavailable");
    } finally {
      await host.dispose();
    }
  });
});

describe("a wait beside the notice turn of the task it waits on (FIX-2123)", { timeout: 30_000 }, () => {
  it("answers that the task's ending arrives as a notice, and the conversation hears the ending once, from that notice", async () => {
    // `respond` holds the conversation's line and never waits, so a second
    // reply starts beside the notice turn that is already reading the ending.
    let noticeTurns = 0;
    let openNotice!: () => void;
    const noticeHeld = new Promise<void>((resolve) => (openNotice = resolve));
    let filed: string | undefined;
    let secondAnswer: string | undefined;
    const judgment: GeneratorModel = {
      modelId: "beside-the-notice",
      async generate() {
        throw new Error("driven step by step");
      },
      async generateStep(options) {
        const messages = (options.messages ?? []) as Array<{ role: string; content: unknown }>;
        const lastUser = messages.map((m) => m.role).lastIndexOf("user");
        const asked = JSON.stringify(messages[lastUser]?.content ?? "");
        const since = toolResults(messages.slice(lastUser + 1));
        if (asked.includes("completed by eng.tasker")) {
          noticeTurns += 1;
          await noticeHeld;
          return { text: "Nine laptops, I hear.", finishReason: "stop" };
        }
        if (asked.includes("check again")) {
          if (since === "") return { toolCalls: [{ toolCallId: "w1", toolName: "getTask", args: { id: filed, wait: true } }], finishReason: "tool-calls" };
          secondAnswer = since;
          return { text: "Noted.", finishReason: "stop" };
        }
        if (since === "") {
          return { toolCalls: [{ toolCallId: "f1", toolName: "createTask", args: { goal: "Count laptops", assignee: "eng.tasker" } }], finishReason: "tool-calls" };
        }
        filed = filedId(since);
        return { text: "Filed.", finishReason: "stop" };
      }
    };
    const host = await waitingHost(judgment);
    try {
      const conv = await host.conversation("alice", "lead");
      const first = await host.post("alice", conv, "respond", { message: "count laptops" });
      expect(await until(async () => (await statusOf(host, first)) === "completed")).toBe(true);
      // The task ends, and its notice turn runs once the filing reply has ended: held open here.
      expect(await until(() => noticeTurns === 1, 10_000)).toBe(true);

      const second = await host.post("alice", conv, "respond", { message: "check again" });
      expect(await until(async () => (await statusOf(host, second)) === "completed", 10_000)).toBe(true);
      expect(secondAnswer).toContain(filed!);
      expect(secondAnswer).toContain('"arrivesAsNotice":true');
      expect(secondAnswer).toContain("as a notice");
      expect(secondAnswer).not.toContain("eng.tasker did");

      openNotice();
      await host.settled();
      expect(noticeTurns).toBe(1);
    } finally {
      openNotice();
      await host.dispose();
    }
  });
});

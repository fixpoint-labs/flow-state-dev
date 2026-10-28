/**
 * A message addressed to a task or to one of the user's conversations
 * (FIX-2160): `sendMessage({ to: { task } })` lands in the session that
 * works the task, and `{ to: { session } }` in that conversation, each checked
 * on its own record before anything is written.
 *
 * Why it matters: a worker asking about a task belongs in the task's own
 * history, not the worker's default conversation, and a pasted session id is
 * input a model hands over, so the server must refuse every session that is
 * not one of the user's conversations before a row exists. A coding task that
 * still runs is refused too: its only answer would resume the session its
 * work is in.
 *
 * Read from the store and what reached each session, never from the tool's
 * return alone.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import { WORKER_MESSAGES_PATTERN } from "../src/messages/message-log";
import { sendMessageInputSchema } from "../src/messages/message-tool";

const ORG = "acme";

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

/**
 * The first turn whose input mentions `marker` makes the tool calls `calls()`
 * returns then (so a test can name an id it learns after booting); later calls
 * in that turn say "Sent.".
 */
function callsOnce(marker: string, calls: () => Array<Record<string, unknown>>): MockGeneratorScriptEntry[] {
  let called = false;
  const step = { toolCalls: [] as Array<{ toolCallId: string; toolName: string; args: unknown }> };
  return [
    { when: (input: unknown) => called && textOf(input).includes(marker), then: { text: "Sent." } },
    {
      when: (input: unknown) => {
        if (called || !textOf(input).includes(marker)) return false;
        called = true;
        step.toolCalls = calls().map((args, i) => ({ toolCallId: `${marker}-${i}`, toolName: "sendMessage", args }));
        return true;
      },
      then: step
    }
  ];
}

const fallback: MockGeneratorScriptEntry = { when: () => true, then: { text: "" } };

function team(): WorkerManifest[] {
  const worker = (id: string, declared: Record<string, unknown>, body = ""): WorkerManifest => ({ id, declared, body, skills: [] });
  return [...boardWorkers(), worker("chief", { flow: "coordinator", delegates: ["otto"] }, "Hand the work to otto."), worker("curious", { description: "Wonders about things." }, "You find things out.")];
}

async function logRows(h: BoardHost, userId: string) {
  const runtime = await h.state.getRuntime();
  const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
  return Object.values(entries).map((value) => value.state as Record<string, any>);
}

async function itemsOf(h: BoardHost, sessionId: string): Promise<any[]> {
  return (await h.requestsOf(sessionId)).flatMap((request) => (request as unknown as { items?: any[] }).items ?? []);
}

async function receivedIn(h: BoardHost, sessionId: string): Promise<Record<string, unknown>[]> {
  return (await itemsOf(h, sessionId)).filter((item) => item.type === "component" && item.component === "workforce:received").map((item) => item.data);
}

async function toolOutputs(h: BoardHost, sessionId: string): Promise<string[]> {
  return (await itemsOf(h, sessionId)).filter((item) => item.type === "tool_output").map((item) => JSON.stringify(item.output ?? item.error));
}

/** File `goal` to `assignee` from `filer`'s conversation with `userId`, and let the board settle. */
async function fileTask(h: BoardHost, userId: string, filer: string, goal: string, assignee: string) {
  const conversation = await h.conversation(userId, filer);
  const filed = await h.act(userId, conversation, "createTask_tasks", { goal, assignee });
  expect(filed.error, messageOf(filed.error)).toBeUndefined();
  return conversation;
}

const until = async (check: () => Promise<boolean>, ms = 10_000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out");
};

describe("a message to a task", () => {
  it("lands in the session that worked the task, after it finished, wakes that session's turn, and leaves the task as it was", async () => {
    const ids: { task?: string } = {};
    const agentAnswer = mockGenerator({
      script: [
        { when: (input) => textOf(input).includes("Message msg_") && textOf(input).includes("How did the report go?"), then: { text: "It went well." } },
        { when: (input) => textOf(input).includes("Write the report"), then: { text: "Report written." } },
        ...callsOnce("Please ask about the report", () => [{ to: { task: ids.task }, text: "How did the report go?" }]),
        fallback
      ]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer });
    try {
      await fileTask(h, "alice", "chief", "Write the report", "otto");
      await h.settled();
      const [task] = await h.rows("alice");
      expect(task!.status).toBe("completed");
      ids.task = task!.id;
      const taskSession = task!.run!.sessionId;

      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", curious.id, "respond", { message: "Please ask about the report" }, "agent");
      await h.settled();

      const rows = await logRows(h, "alice");
      expect(rows).toEqual([
        expect.objectContaining({ from: "curious", to: "otto", addressedBy: "task", toTask: task!.id, toSession: taskSession, status: "delivered" })
      ]);
      expect(await receivedIn(h, taskSession)).toEqual([expect.objectContaining({ from: "curious", text: "How did the report go?" })]);
      expect((await h.messages(taskSession)).at(-1)?.text, "the message woke the task session's turn").toBe("It went well.");
      // Otto's own conversation was never opened: the message went to the task's history.
      expect(await h.client("alice").findWorkerSession({ worker: "otto" })).toBeUndefined();
      const [after] = await h.rows("alice");
      expect({ status: after!.status, attempts: after!.attempts, output: after!.output }).toEqual({
        status: task!.status,
        attempts: task!.attempts,
        output: task!.output
      });
    } finally {
      await h.dispose();
    }
  });

  it("waits for the task's open turn to end before its own turn runs", async () => {
    // The task's turn is held in its model call while the message is sent.
    const ids: { task?: string } = {};
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inTaskTurn = new Promise<void>((resolve) => (entered = resolve));
    let held = false;
    const agentAnswer = mockGenerator({
      script: [
        { when: (input) => textOf(input).includes("Message msg_"), then: { text: "Heard." } },
        { when: (input) => textOf(input).includes("Write the report"), then: { text: "Report written." } },
        ...callsOnce("Please ask about the report", () => [{ to: { task: ids.task }, text: "How did the report go?" }]),
        fallback
      ]
    });
    const h = bootBoardHost({
      judgment: mockGenerator({ script: [fallback] }),
      standard: team(),
      agentAnswer,
      afterModelCall: async (name) => {
        if (name !== "agent-answer" || held) return;
        held = true;
        entered();
        await gate;
      }
    });
    try {
      await fileTask(h, "alice", "chief", "Write the report", "otto");
      await inTaskTurn;
      const [task] = await h.rows("alice");
      ids.task = task!.id;
      const taskSession = task!.run!.sessionId;

      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", curious.id, "respond", { message: "Please ask about the report" }, "agent");
      await until(async () => (await logRows(h, "alice")).length === 1);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await receivedIn(h, taskSession), "nothing of the message runs while the task's turn is open").toEqual([]);

      release();
      await h.settled();
      const requests = (await h.requestsOf(taskSession)) as unknown as Array<{ actionName: string; completedAtMs: number; items?: Array<{ ts: number }> }>;
      const work = requests.find((q) => q.actionName !== "onMessageReceived")!;
      const heard = requests.find((q) => q.actionName === "onMessageReceived")!;
      expect(await receivedIn(h, taskSession)).toEqual([expect.objectContaining({ from: "curious", text: "How did the report go?" })]);
      expect(Math.min(...(heard.items ?? []).map((item) => item.ts))).toBeGreaterThanOrEqual(work.completedAtMs);
    } finally {
      release();
      await h.dispose();
    }
  });

  it("lands though a failed add left the same id's marker in another conversation", async () => {
    const ids: { task?: string } = {};
    const agentAnswer = mockGenerator({
      script: [
        { when: (input) => textOf(input).includes("Write the notes"), then: { text: "Notes written." } },
        ...callsOnce("Please ask about the notes", () => [{ to: { task: ids.task }, text: "How are the notes?" }]),
        fallback
      ]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer });
    try {
      await fileTask(h, "alice", "chief", "Write the notes", "otto");
      await h.settled();
      const [task] = await h.rows("alice");
      ids.task = task!.id;
      // A marker is written before its row: plant the one an add that then failed would leave.
      const runtime = await h.state.getRuntime();
      const cell = `alice:~org:${ORG}`;
      const markers = await runtime.stores.resourceState.getByPrefix("user", cell, "tasks__ids");
      const [key] = Object.keys(markers).filter((k) => decodeURIComponent(k.split("/")[1] ?? "") === task!.id);
      expect(key, "the task's own marker").toBeDefined();
      const ghost = "conv_failed_add";
      const planted = await runtime.stores.resourceState.set("user", cell, `${key!.slice(0, key!.lastIndexOf("/") + 1)}${ghost}`, { partition: ghost } as never, "absent");
      expect(planted.ok).toBe(true);

      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", curious.id, "respond", { message: "Please ask about the notes" }, "agent");
      await h.settled();
      expect(await logRows(h, "alice")).toEqual([expect.objectContaining({ addressedBy: "task", toSession: task!.run!.sessionId, status: "delivered" })]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses an unknown id and another user's task alike, no_task_session, writing nothing", async () => {
    const ids: { bobs?: string } = {};
    const agentAnswer = mockGenerator({
      script: [
        ...callsOnce("Please ask the tasks", () => [
          { to: { task: "task_nope" }, text: "Hi?" },
          { to: { task: ids.bobs }, text: "Hi Bob's task?" }
        ]),
        fallback
      ]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer });
    try {
      await fileTask(h, "bob", "lead", "Bob's work", "eng.tasker");
      await h.settled();
      ids.bobs = (await h.rows("bob"))[0]!.id;

      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", curious.id, "respond", { message: "Please ask the tasks" }, "agent");
      await h.settled();

      const outputs = await toolOutputs(h, curious.id);
      expect(outputs).toHaveLength(2);
      for (const output of outputs) expect(output).toMatch(/no_task_session/);
      expect(await logRows(h, "alice")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a coding task still running, task_running, before the row; once it ends the same message is delivered", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const ids: { task?: string } = {};
    const agentAnswer = mockGenerator({
      script: [
        // The later turn first: its input holds the earlier line too, in history.
        ...callsOnce("Please ask once it ended", () => [{ to: { task: ids.task }, text: "Status?" }]),
        ...callsOnce("Please ask while it runs", () => [{ to: { task: ids.task }, text: "Status?" }]),
        fallback
      ]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer, questions: new Map([["g", held]]) });
    try {
      await fileTask(h, "alice", "lead", "[hold:g] The long job", "eng.tasker");
      // Running: claimed, and its run linked to the session it works in.
      await until(async () => (await h.rows("alice"))[0]?.run?.sessionId !== undefined);
      ids.task = (await h.rows("alice"))[0]!.id;

      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", curious.id, "respond", { message: "Please ask while it runs" }, "agent");
      await until(async () => (await toolOutputs(h, curious.id)).length === 1);
      expect((await toolOutputs(h, curious.id))[0]).toMatch(/task_running/);
      expect(await logRows(h, "alice")).toEqual([]);

      release();
      await h.settled();
      const task = (await h.rows("alice"))[0]!;
      expect(task.status).toBe("completed");
      await h.post("alice", curious.id, "respond", { message: "Please ask once it ended" }, "agent");
      await h.settled();
      expect(await logRows(h, "alice")).toEqual([expect.objectContaining({ to: "eng.tasker", addressedBy: "task", toSession: task.run!.sessionId, status: "delivered" })]);
      expect(await receivedIn(h, task.run!.sessionId)).toEqual([expect.objectContaining({ from: "curious", text: "Status?" })]);
    } finally {
      release();
      await h.dispose();
    }
  });
});

describe("a message to a conversation by its id", () => {
  it("lands in that conversation of the user's, as its own item", async () => {
    const ids: { lead?: string } = {};
    const agentAnswer = mockGenerator({
      script: [...callsOnce("Please tell the lead's conversation", () => [{ to: { session: ids.lead }, text: "Alice wants this here too." }]), fallback]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer });
    try {
      ids.lead = await h.conversation("alice", "lead", "s_alice_lead_second");
      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", curious.id, "respond", { message: "Please tell the lead's conversation" }, "agent");
      await h.settled();

      expect(await logRows(h, "alice")).toEqual([
        expect.objectContaining({ from: "curious", to: "lead", addressedBy: "session", toSession: ids.lead, status: "delivered" })
      ]);
      expect(await receivedIn(h, ids.lead)).toEqual([expect.objectContaining({ from: "curious", text: "Alice wants this here too." })]);
    } finally {
      await h.dispose();
    }
  });

  it("lets a worker's other conversation answer it, back in the conversation that asked", async () => {
    // The second conversation answers by name, as every answer does: to the
    // worker that sent the question, which here is the same worker.
    const ids: { second?: string } = {};
    let answered = false;
    const answer = { toolCalls: [{ toolCallId: "answer-self", toolName: "sendMessage", args: {} as Record<string, unknown> }] };
    const agentAnswer = mockGenerator({
      script: [
        ...callsOnce("Ask your other conversation", () => [{ to: { session: ids.second }, text: "Which name did we pick?" }]),
        { when: (input: unknown) => answered && textOf(input).includes("Which name did we pick?"), then: { text: "" } },
        {
          when: (input: unknown) => {
            const text = textOf(input);
            const message = /Message (msg_\w+) from curious/.exec(text);
            if (answered || message === null || text.includes("Ask your other conversation")) return false;
            answered = true;
            answer.toolCalls[0]!.args = { to: "curious", text: "Bluebird.", inReplyTo: message[1] };
            return true;
          },
          then: answer
        },
        fallback
      ]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer });
    try {
      const second = await h.create("alice", "agent", { sessionId: "s_alice_curious_second", state: { workerId: "curious" } });
      expect(second.status, JSON.stringify(second.body)).toBeLessThan(300);
      ids.second = second.body.session!.id;
      const first = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      await h.post("alice", first.id, "respond", { message: "Ask your other conversation" }, "agent");
      await h.settled();

      const rows = await logRows(h, "alice");
      const question = rows.find((row) => row.inReplyTo === undefined);
      expect(question).toMatchObject({ from: "curious", to: "curious", toSession: ids.second, status: "delivered" });
      expect(rows.find((row) => row.inReplyTo !== undefined), JSON.stringify(await toolOutputs(h, ids.second))).toMatchObject({
        from: "curious",
        to: "curious",
        inReplyTo: question!.id,
        toSession: first.id,
        status: "delivered"
      });
      expect(await receivedIn(h, first.id)).toEqual([expect.objectContaining({ from: "curious", text: "Bluebird.", inReplyTo: question!.id })]);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a task's session, a missing one, another user's, a coder's and its own, by name, writing nothing", async () => {
    const ids: { taskSession?: string; bobs?: string; tasker?: string; own?: string } = {};
    const agentAnswer = mockGenerator({
      script: [
        ...callsOnce("Please try every session", () => [
          { to: { session: ids.taskSession }, text: "1" },
          { to: { session: "s_missing" }, text: "2" },
          { to: { session: ids.bobs }, text: "3" },
          { to: { session: ids.tasker }, text: "4" },
          { to: { session: ids.own }, text: "5" }
        ]),
        fallback
      ]
    });
    const h = bootBoardHost({ judgment: mockGenerator({ script: [fallback] }), standard: team(), agentAnswer });
    try {
      await fileTask(h, "alice", "chief", "Write the report", "otto");
      await fileTask(h, "alice", "lead", "Tasker work", "eng.tasker");
      await h.settled();
      const rows = await h.rows("alice");
      ids.taskSession = rows.find((row) => row.assignee === "otto")!.run!.sessionId;
      ids.tasker = rows.find((row) => row.assignee === "eng.tasker")!.run!.sessionId;
      ids.bobs = await h.conversation("bob", "lead");
      const curious = await h.client("alice").ensureWorkerSession({ worker: "curious" });
      ids.own = curious.id;

      await h.post("alice", curious.id, "respond", { message: "Please try every session" }, "agent");
      await h.settled();

      const outputs = await toolOutputs(h, curious.id);
      expect(outputs).toHaveLength(5);
      expect(outputs[0]).toMatch(/not_a_conversation/);
      expect(outputs[1]).toMatch(/no_session/);
      expect(outputs[2]).toMatch(/no_session/);
      // A coder's task session carries a task's markers too: it is a task's, not a conversation.
      expect(outputs[3]).toMatch(/not_a_conversation/);
      expect(outputs[4]).toMatch(/not_yourself/);
      expect(await logRows(h, "alice")).toEqual([]);
      expect(await logRows(h, "bob")).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the tool's input", () => {
  it("takes a worker's id, { task } or { session }, and nothing else in to", () => {
    expect(sendMessageInputSchema.safeParse({ to: { task: "t1" }, text: "Hi." }).success).toBe(true);
    expect(sendMessageInputSchema.safeParse({ to: { session: "s1" }, text: "Hi." }).success).toBe(true);
    expect(sendMessageInputSchema.safeParse({ to: { task: "t1", session: "s1" }, text: "Hi." }).success).toBe(false);
    expect(sendMessageInputSchema.safeParse({ to: { worker: "lead" }, text: "Hi." }).success).toBe(false);
  });
});

/**
 * The worker sessions view (FIX-2158's rule; FIX-2725 moved it from the
 * client's `listWorkerSessions` onto the roster flow's view) and the session
 * turns view. Real engine; the caller is a verified user. Reads the view and
 * where a request ran, never a stored key, and seeds nothing by hand.
 * Project-coordinator sessions are in `project-coordinator.test.ts`, the host that names one.
 */
import { describe, expect, it, vi } from "vitest";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { MESSAGE_RECEIVED_ENTRY } from "../src/messages/keys";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import { sessionTurnsViewRef, workerSessionsViewRef } from "../src/workers/session-views-ref";
import { TURN_ACTIONS } from "../src/workers/turn-actions";
import { RESPOND_ACTION } from "../src/worker-door";

/** A scripted model input as text, with its escapes dropped. */
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

const fallback: MockGeneratorScriptEntry = { when: () => true, then: { text: "" } };

/** The board's workers, and an agent worker that messages otto when asked to. */
function workers(): WorkerManifest[] {
  return [...boardWorkers(), { id: "helper-a", declared: { description: "Passes things on." }, body: "You help.", skills: [] }];
}

/** helper-a's first turn asked to "tell otto" messages otto once. */
function tellsOtto(): MockGeneratorScriptEntry[] {
  let sent = false;
  return [
    {
      when: (input: unknown) => {
        if (sent || !textOf(input).includes("Tell otto hello")) return false;
        sent = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: "tell-otto", toolName: "sendMessage", args: { to: "otto", text: "Hello otto." } }] }
    },
    fallback
  ];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A session with `worker` on the agent flow, created by `userId` at a random id. */
async function open(h: BoardHost, userId: string, worker = "otto"): Promise<string> {
  const created = await h.create(userId, "agent", { state: { workerId: worker } });
  if (created.status !== 201) throw new Error(`creating ${worker}'s session failed: ${JSON.stringify(created.body)}`);
  return created.body.session!.id;
}

/** Run one turn in `sessionId` and wait for it, so the session's latest activity is now. */
async function use(h: BoardHost, userId: string, sessionId: string): Promise<void> {
  await sleep(5);
  await h.post(userId, sessionId, "respond", { message: "Hi." }, "agent");
  await h.settled();
}

describe("a user's conversations with one worker", () => {
  it("no-create · lists a session opened at a random id before the first ensure, marks none default, and creates nothing", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const alice = h.client("alice");
      const random = await open(h, "alice");
      const listed = await h.workerSessions("alice", "otto");
      expect(listed.map((entry) => [entry.id, entry.isDefault])).toEqual([[random, false]]);
      // Q2: no title yet reads "Untitled", never a guess from its words.
      expect(listed[0]?.title).toBe("Untitled");
      expect(listed[0]?.state).toEqual({ workerId: "otto" });
      expect(await alice.findWorkerSession({ worker: "otto" })).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });

  it("three-sessions · lists the default conversation first and marked, then the others by latest activity", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const alice = h.client("alice");
      const main = await alice.ensureWorkerSession({ worker: "otto" });
      const first = await open(h, "alice");
      const second = await open(h, "alice");
      // The first-created one is used last, so a creation-order list fails;
      // both are used after the default, so a plain activity order fails too.
      await use(h, "alice", main.id);
      await use(h, "alice", second);
      await use(h, "alice", first);
      const listed = await h.workerSessions("alice", "otto");
      expect(listed.map((entry) => [entry.id, entry.isDefault])).toEqual([
        [main.id, true],
        [first, false],
        [second, false]
      ]);
      expect((await alice.findWorkerSession({ worker: "otto" }))?.id).toBe(main.id);
    } finally {
      await h.dispose();
    }
  });

  it("own-only · another user on the same worker id gets only their own session", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await open(h, "alice");
      const bobs = await open(h, "bob");
      expect((await h.workerSessions("bob", "otto")).map((entry) => entry.id)).toEqual([bobs]);
      expect(await h.workerSessions("alice", "otto")).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });

  it("no-task-runs · leaves out the session a task handed to the worker runs in", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const alice = h.client("alice");
      const main = await alice.ensureWorkerSession({ worker: "otto" });
      const front = await h.conversation("alice", "front");
      const filed = await h.act("alice", front, "createTask_tasks", { goal: "Check the logs", assignee: "otto" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const taskId = (filed.output as { taskId: string }).taskId;
      await h.settled();
      const run = await alice.findWorkerSession({ worker: "otto", taskId, filingSessionId: await h.filingOf("alice", front) });
      expect(run, "the task ran in its own session").toBeDefined();
      const listed = (await h.workerSessions("alice", "otto")).map((entry) => entry.id);
      expect(listed).toEqual([main.id]);
      expect(listed).not.toContain(run!.id);
    } finally {
      await h.dispose();
    }
  });

  it("default-behind-100 · lists the default first and marked though 100 newer conversations fill a page", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const main = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      for (let at = 0; at < 100; at += 1) {
        await sleep(1);
        await open(h, "alice");
      }
      // FIX-2754: the default is read by id, so finding it reads no page past the first.
      const store = (await h.state.getRuntime()).stores.session;
      const reads = vi.spyOn(store, "list");
      const listed = await h.workerSessions("alice", "otto");
      expect(listed[0] && [listed[0].id, listed[0].isDefault]).toEqual([main.id, true]);
      expect(listed).toHaveLength(100);
      expect(listed.filter((entry) => entry.isDefault)).toHaveLength(1);
      const pages = reads.mock.calls.filter(([options]) => options?.state?.workerId === "otto").map(([options]) => options?.offset ?? 0);
      expect(pages).toEqual([0]);
    } finally {
      await h.dispose();
    }
  }, 60_000);

  it("message-in-default · a message another worker addresses to the worker starts in the default, though the others were used since", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: tellsOtto() }) });
    try {
      const alice = h.client("alice");
      const main = await alice.ensureWorkerSession({ worker: "otto" });
      const first = await open(h, "alice");
      const second = await open(h, "alice");
      await use(h, "alice", first);
      await use(h, "alice", second);
      const helper = await open(h, "alice", "helper-a");
      await h.post("alice", helper, "respond", { message: "Tell otto hello" }, "agent");
      await h.settled();
      const received = (await (await h.state.getRuntime()).stores.request.list({})).filter(
        (request) => request.actionName === MESSAGE_RECEIVED_ENTRY
      );
      expect(received.map((request) => request.sessionId)).toEqual([main.id]);
      const [top] = await h.workerSessions("alice", "otto");
      expect([top?.id, top?.isDefault]).toEqual([main.id, true]);
    } finally {
      await h.dispose();
    }
  });

  it("throws when the worker isn't on the user's roster", async () => {
    const h = bootBoardHost({ standard: workers() });
    try {
      await expect(h.workerSessions("alice", "nobody")).rejects.toThrow();
    } finally {
      await h.dispose();
    }
  });

  it("waiting · names each failed task of a session's board by id and attempt, and none of a running one", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      // A coordinator conversation: its board files to its delegate.
      const lead = await h.conversation("alice", "lead");
      // A held task waits on nothing of the user's; a failed one does.
      const held = await h.act("alice", lead, "createTask_tasks", { goal: "Later", assignee: "eng.tasker", held: true });
      expect(held.error, messageOf(held.error)).toBeUndefined();
      expect((await h.workerSessions("alice", "lead")).map((entry) => [entry.id, entry.waiting])).toEqual([[lead, []]]);
      const heldId = (held.output as { taskId: string }).taskId;
      const [stored] = (await h.rows("alice")).filter((task) => task.id === heldId);
      expect(stored, "the task is on the session's board").toBeDefined();
      const { partition: _partition, ...task } = stored!;
      await h.writeRow("alice", decodeURIComponent(stored!.partition), { ...task, status: "errored", attempts: 2 } as never);
      const [listed] = await h.workerSessions("alice", "lead");
      expect(listed?.waiting).toEqual([{ taskId: heldId, attempt: 2 }]);
    } finally {
      await h.dispose();
    }
  });
});

describe("an empty board read for a named conversation", () => {
  it("empty-board · is heard on the conversation's board notices, so a first task filed reaches the list", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const lead = await h.conversation("alice", "lead");
      // A user view runs in no session: its board read names the conversation it read for.
      const answer = await h.fsd("alice").view(workerSessionsViewRef(), { worker: "lead" });
      expect(answer.value.map((entry) => [entry.id, entry.waiting])).toEqual([[lead, []]]);
      expect(answer.hears).toContainEqual({ topic: { scope: "session", id: lead, resource: "tasks" }, kinds: ["board"] });
      // The list, on the user topic's `run` (beside the roster's own resource reads).
      expect(answer.hears.find((hearing) => hearing.topic.scope === "user" && hearing.topic.resource === undefined)?.kinds).toContain("run");
      // Its turns are heard on its request notices; nothing hears its streamed items.
      expect(answer.hears).toContainEqual({ topic: { scope: "session", id: lead }, kinds: ["request", "state"] });
      expect(answer.hears.flatMap((hearing) => hearing.kinds)).not.toContain("items");
    } finally {
      await h.dispose();
    }
  });
});

describe("a session's turns", () => {
  it("turns · answers each turn's status, oldest first, and only turn actions", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const main = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await use(h, "alice", main.id);
      await use(h, "alice", main.id);
      const { value } = await h.fsd("alice").view(sessionTurnsViewRef(), { sessionId: main.id });
      expect(value.map((turn) => [turn.action, turn.status])).toEqual([
        [RESPOND_ACTION, "completed"],
        [RESPOND_ACTION, "completed"]
      ]);
      expect(value[0]!.startedAt).toBeLessThanOrEqual(value[1]!.startedAt);
      // When each ended: a completed turn's end is its completion.
      expect(value.map((turn) => turn.endedAt)).toEqual(value.map((turn) => turn.completedAt));
      expect(value.every((turn) => TURN_ACTIONS.includes(turn.action))).toBe(true);
      // Another user's session answers nothing.
      expect((await h.fsd("bob").view(sessionTurnsViewRef(), { sessionId: main.id })).value).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  // FIX-2771: an app's idle age is its last turn's, never the session's updatedAt, which a board pass moves.
  it("dispatch-not-a-turn · a board dispatch moves the session's updatedAt but adds no turn, so the last turn holds", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const lead = await h.conversation("alice", "lead");
      await h.post("alice", lead, "respond", { message: "Hi." }, "coordinator");
      await h.settled();
      const before = (await h.fsd("alice").view(sessionTurnsViewRef(), { sessionId: lead })).value;
      const movedFrom = (await h.session(lead)).updatedAt;
      expect(before.map((turn) => turn.action)).toEqual([RESPOND_ACTION]);
      await sleep(5);
      // A slow task: the board's pass runs in the conversation, and the task is still running when the turns are read.
      const filed = await h.act("alice", lead, "createTask_tasks", { goal: "Check the logs [slow:1000]", assignee: "eng.tasker" });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      const dispatched = async () => (await h.requestsOf(lead)).some((request) => request.actionName === "dispatch" && request.status === "completed");
      for (let i = 0; i < 200 && !(await dispatched()); i++) await sleep(10);
      expect(await dispatched()).toBe(true);
      expect((await h.session(lead)).updatedAt).toBeGreaterThan(movedFrom);
      const after = (await h.fsd("alice").view(sessionTurnsViewRef(), { sessionId: lead })).value;
      expect(after).toEqual(before);
      await h.settled();
    } finally {
      await h.dispose();
    }
  }, 20_000);

  it("history-start · names where a turn's history window began once earlier turns left it, and null while none had", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const main = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      // The worker reads 50 past turns: the 52nd turn is the first with one out of view, and reads from the second on.
      for (let n = 0; n < 52; n++) {
        await h.post("alice", main.id, "respond", { message: `Line ${n}.` }, "agent");
        await h.settled();
      }
      const second = (await h.requestsOf(main.id))[1]!.id;
      const { value } = await h.fsd("alice").view(sessionTurnsViewRef(), { sessionId: main.id });
      expect(value.at(-1)!.historyStart).toEqual({ requestId: second });
      expect(value.slice(0, -1).every((turn) => turn.historyStart === null)).toBe(true);
    } finally {
      await h.dispose();
    }
  }, 30_000);

  // FIX-2848 D3: a screen offers Retry from this, never from its own copy of the retry route's sources.
  it("retryable · a turn the user started is one the engine runs again; a turn another worker's message started is not", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: tellsOtto() }) });
    try {
      const main = await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await use(h, "alice", main.id);
      const helper = await open(h, "alice", "helper-a");
      await h.post("alice", helper, "respond", { message: "Tell otto hello" }, "agent");
      await h.settled();
      const { value } = await h.fsd("alice").view(sessionTurnsViewRef(), { sessionId: main.id });
      expect(value.map((turn) => [turn.action, turn.source, turn.retryable])).toEqual([
        [RESPOND_ACTION, "http", true],
        [MESSAGE_RECEIVED_ENTRY, "internal", false]
      ]);
    } finally {
      await h.dispose();
    }
  });

  it("turn-set · names the four entries that run a session's turn", () => {
    expect([...TURN_ACTIONS].sort()).toEqual(["onMessageReceived", "onTaskSettled", "respond", "routeOn"]);
  });
});

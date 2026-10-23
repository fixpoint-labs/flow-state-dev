/**
 * A person's conversations with one worker (FIX-2158): `listWorkerSessions`
 * lists every top-level session the person opened with the worker, the
 * default conversation first and marked, and leaves out the sessions a task
 * runs in. A message another worker addresses to the worker still lands in
 * the default, however many sessions the person opens.
 *
 * Real engine, real HTTP router, the caller a verified user. The tests read
 * what the client returns and where a request ran, never a stored key, and
 * seed nothing in the store by hand. The project coordinator's per-project
 * sessions are left out too: that check is in `project-coordinator.test.ts`,
 * whose host names one.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { WORKER_MESSAGE_ENTRY } from "../src/messages/keys";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";

/** A scripted model input as text, with its escapes dropped. */
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

/** Any turn the script doesn't name ends with no text. */
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
      then: { toolCalls: [{ toolCallId: "tell-otto", toolName: "messageWorker", args: { to: "otto", text: "Hello otto." } }] }
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

describe("a person's conversations with one worker", () => {
  it("no-create · lists a session opened at a random id before the first ensure, marks none default, and creates nothing", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      const alice = h.client("alice");
      const random = await open(h, "alice");
      const listed = await alice.listWorkerSessions("otto");
      expect(listed.map((entry) => [entry.session.id, entry.isDefault])).toEqual([[random, false]]);
      // Listing opened no default conversation.
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
      const listed = await alice.listWorkerSessions("otto");
      expect(listed.map((entry) => [entry.session.id, entry.isDefault])).toEqual([
        [main.id, true],
        [first, false],
        [second, false]
      ]);
      // The default is the one find returns.
      expect((await alice.findWorkerSession({ worker: "otto" }))?.id).toBe(main.id);
    } finally {
      await h.dispose();
    }
  });

  it("own-only · another person on the same worker id gets only their own session", async () => {
    const h = bootBoardHost({ standard: workers(), agentAnswer: mockGenerator({ script: [fallback] }) });
    try {
      await h.client("alice").ensureWorkerSession({ worker: "otto" });
      await open(h, "alice");
      const bobs = await open(h, "bob");
      expect((await h.client("bob").listWorkerSessions("otto")).map((entry) => entry.session.id)).toEqual([bobs]);
      expect(await h.client("alice").listWorkerSessions("otto")).toHaveLength(2);
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
      const listed = (await alice.listWorkerSessions("otto")).map((entry) => entry.session.id);
      expect(listed).toEqual([main.id]);
      expect(listed).not.toContain(run!.id);
    } finally {
      await h.dispose();
    }
  });

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
        (request) => request.actionName === WORKER_MESSAGE_ENTRY
      );
      expect(received.map((request) => request.sessionId)).toEqual([main.id]);
      // The default is still first and marked in the list.
      const [top] = await alice.listWorkerSessions("otto");
      expect([top?.session.id, top?.isDefault]).toEqual([main.id, true]);
    } finally {
      await h.dispose();
    }
  });

  it("throws when the worker isn't on the person's roster", async () => {
    const h = bootBoardHost({ standard: workers() });
    try {
      await expect(h.client("alice").listWorkerSessions("nobody")).rejects.toThrow('No worker "nobody" on your roster.');
    } finally {
      await h.dispose();
    }
  });
});

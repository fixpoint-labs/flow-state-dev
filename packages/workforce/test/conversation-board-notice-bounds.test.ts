/**
 * The two bounds on a task notice's wait for a reply (BR-27), on the real
 * engine host with scripted models.
 *
 * The engine's `defer` policy waits with two limits: it waits for replies
 * that start after it only for a while (its patience), then lines up behind
 * the replies running at that moment; and only so many deferred requests wait
 * on one key in a process (its cap), the next being refused. `createFlowState`
 * takes neither, so this file shrinks both in the engine's arbiter (a cap of 2
 * and 300 ms) to reach them in a test. The production values are 32 and 30 s.
 */
import { describe, expect, it, vi } from "vitest";
import { mockGenerator } from "@flow-state-dev/testing";
import { bootBoardHost, type BoardHost } from "./conversation-board-harness";

const PATIENCE_MS = 300;

vi.mock("../../engine/src/transports/concurrency/arbiter", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../engine/src/transports/concurrency/arbiter")>();
  return {
    ...original,
    createConcurrencyArbiter: (options: Parameters<typeof original.createConcurrencyArbiter>[0] = {}) =>
      original.createConcurrencyArbiter({ ...options, maxDeferredPerKey: 2, deferPatienceMs: PATIENCE_MS })
  };
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `check` until it holds, for at most `ms`. Whether it held. */
const until = async (check: () => Promise<boolean> | boolean, ms = 3000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await sleep(10);
  }
  return check();
};

/** The lines in a conversation about `goal`. */
const linesAbout = async (host: BoardHost, conv: string, goal: string) =>
  (await host.messages(conv)).filter((message) => message.text.includes(`"${goal}"`)).map((message) => message.text);

/** The `onTaskSettled` requests a conversation has, run or waiting. */
const noticeRequests = async (host: BoardHost, conv: string) =>
  (await host.requestsOf(conv)).filter((request) => request.actionName === "onTaskSettled");

/** A gate a test opens: a held model call waits on it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe("a notice that has waited out its patience", () => {
  const script = () =>
    mockGenerator({
      script: [
        { toolCalls: [{ toolCallId: "a1", toolName: "createTask", args: { goal: "Count licenses", assignee: "eng.tasker" } }] },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Twelve licenses." } },
        { when: (input) => JSON.stringify(input).includes("and our workers"), then: { text: "Forty workers." } }
      ]
    });

  /**
   * The filing reply (the first model call) is held until `first` opens, and
   * the user's next reply (the second) until `second` opens. The next
   * message is sent `nextAfterMs` after the notice arrives.
   */
  const twoReplies = async (nextAfterMs: number) => {
    const first = gate();
    const second = gate();
    let calls = 0;
    let conv = "";
    const host: BoardHost = bootBoardHost({
      judgment: script(),
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment") return;
        const call = ++calls;
        if (call === 1) await first.opened;
        if (call === 2) await second.opened;
      }
    });
    conv = await host.conversation("alice", "lead");
    await host.post("alice", conv, "respond", { message: "count our licenses" });
    expect(await until(async () => (await noticeRequests(host, conv)).length > 0)).toBe(true);
    await sleep(nextAfterMs);
    await host.post("alice", conv, "respond", { message: "and our workers?" });
    expect(await until(() => calls === 2)).toBe(true);
    // The filing reply ends; the user's next reply is still running.
    first.open();
    const landedBesideNextReply = await until(async () => (await linesAbout(host, conv, "Count licenses")).length > 0, 500);
    second.open();
    await host.settled();
    return { host, conv, landedBesideNextReply };
  };

  it("waits for a reply that starts within its patience", async () => {
    const { host, conv, landedBesideNextReply } = await twoReplies(0);
    try {
      expect(landedBesideNextReply).toBe(false);
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });

  it("lines up behind the replies running when its patience ran out, so a reply that starts later can run beside it", async () => {
    const { host, conv, landedBesideNextReply } = await twoReplies(PATIENCE_MS * 2);
    try {
      // The engine's rule against a stream of replies holding a notice back
      // forever: past its patience, a notice waits only for the replies it
      // found, so the user's later reply is still running when it lands.
      expect(landedBesideNextReply).toBe(true);
      expect(await linesAbout(host, conv, "Count licenses")).toHaveLength(1);
    } finally {
      await host.dispose();
    }
  });
});

describe("more notices than may wait on a conversation", () => {
  it("are all heard: one refused while the line is full stays owed, and the conversation's wake sends it again (FIX-2078)", async () => {
    const goals = ["Count A", "Count B", "Count C"];
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: goals.map((goal, n) => ({
            toolCallId: `a${n}`,
            toolName: "createTask",
            args: { goal, assignee: "eng.tasker" }
          }))
        },
        { text: "Filed." },
        { when: (input) => JSON.stringify(input).includes("completed by eng.tasker"), then: { text: "Noted." } }
      ]
    });
    let calls = 0;
    let conv = "";
    let waitingWhenHeld = 0;
    const host: BoardHost = bootBoardHost({
      judgment,
      durable: true,
      // Hold the filing reply until all three tasks have ended and sent their
      // notices: two wait, and the third is refused.
      afterModelCall: async (blockName) => {
        if (blockName !== "coordinator-judgment" || ++calls !== 1) return;
        await until(async () => (await host.rows("alice")).filter((row) => row.status === "completed").length === 3);
        await sleep(200);
        waitingWhenHeld = (await noticeRequests(host, conv)).length;
      }
    });
    try {
      await host.state.getRouter();
      conv = await host.conversation("alice", "lead");
      await host.post("alice", conv, "respond", { message: "count them" });
      await host.settled();
      expect(waitingWhenHeld).toBe(2);
      // Nothing touches the board after the reply: the third notice, refused
      // while the line was full, stays owed, and the conversation's wake, due
      // two seconds after its ending, sends it again.
      expect(await until(async () => (await Promise.all(goals.map((goal) => linesAbout(host, conv, goal)))).every((lines) => lines.length === 1), 8_000)).toBe(true);
      await host.settled();
      for (const goal of goals) expect(await linesAbout(host, conv, goal)).toHaveLength(1);
      const owed = (await host.rows("alice")).flatMap((row) =>
        Object.entries(row.metadata ?? {}).filter(([key, value]) => key.startsWith("noticeOwed:") && value !== null)
      );
      expect(owed).toEqual([]);
    } finally {
      await host.dispose();
    }
  });
});

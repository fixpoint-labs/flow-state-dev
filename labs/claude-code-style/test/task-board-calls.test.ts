/**
 * The adapter's task changes go through the board's own calls:
 * orchestration's `inbox.board(at)` on the session that holds the board, so the
 * lab spells no task action of its own. A steer typed in a thread with no open
 * question is that client's `steer`, not a raw `updateTask` send, and a failed
 * row carries its error, read once per attempt from the board's `getTask`.
 */
import { describe, expect, it } from "vitest";
import type { Client } from "@flow-state-dev/client";
import { createWiredLab, type TaskRow } from "../src/adapter";

type Sent = { flow: string; action: string; input: Record<string, unknown>; sessionId: string };

/**
 * A client whose board holds `rows`. A send is answered by `answer`; only the
 * board client's routine (`flow.request(id).result`) can read its answer, by the
 * request's id, so a send through any other path fails.
 */
function fakeClient(rows: Record<string, unknown>[], answer: (sent: Sent) => Record<string, unknown> = () => ({ ok: true })) {
  const sent: Sent[] = [];
  const outputs = new Map<string, Record<string, unknown>>();
  const client = {
    subscribe: () => ({ close: () => {} }),
    sessions: {
      get: async (id: string) => ({ id, flowKind: "agent", flowId: "agent", state: {} }),
    },
    flow: (flow: string) => ({
      read: async () => ({ ok: true, tasks: rows }),
      send: async (action: string, input: Record<string, unknown>, options: { sessionId: string }) => {
        const entry = { flow, action, input, sessionId: options.sessionId };
        sent.push(entry);
        const id = `r${sent.length}`;
        outputs.set(id, answer(entry));
        // Only `getTask`, a read the adapter makes through its own `run`, reads the started request's answer.
        return action.startsWith("getTask_") ? { id, result: async () => ({ status: "completed", output: outputs.get(id) }) } : { id };
      },
      request: (id: string) => ({ result: async () => ({ status: "completed", output: outputs.get(id) }) }),
    }),
  } as unknown as Client;
  return { client, sent };
}

const RUNNING = { id: "t1", goal: "Fix the typo", status: "in_progress", attempts: 1 };

describe("the adapter's task actions", () => {
  it("sends a steer typed in a thread with no open question through the board client's steer", async () => {
    const lab = fakeClient([RUNNING]);
    await createWiredLab(lab.client).sayInThread("s1", "t1", "Use the British spelling.");
    expect(lab.sent).toEqual([{ flow: "agent", action: "updateTask_tasks", input: { id: "t1", message: "Use the British spelling." }, sessionId: "s1" }]);
  });

  it("cancels, releases and retries on the session's own board, and hands back the dependents a cancel took", async () => {
    const lab = fakeClient([RUNNING], (sent) => (sent.input.status === "cancelled" ? { ok: true, cancelled: ["t2"] } : { ok: true }));
    const actions = createWiredLab(lab.client).taskActions("s1");
    expect(await actions.cancel("t1")).toEqual(["t2"]);
    await actions.release("t1");
    await actions.retry("t1");
    await actions.steer("t1", "Faster, please.");
    expect(lab.sent.map((s) => [s.flow, s.sessionId, s.action, s.input])).toEqual([
      ["agent", "s1", "updateTask_tasks", { id: "t1", status: "cancelled" }],
      ["agent", "s1", "updateTask_tasks", { id: "t1", status: "pending" }],
      ["agent", "s1", "retryTask_tasks", { id: "t1" }],
      ["agent", "s1", "updateTask_tasks", { id: "t1", message: "Faster, please." }],
    ]);
  });

  it("rejects with the board's own words when it refuses", async () => {
    const lab = fakeClient([RUNNING], () => ({ ok: false, error: "Task t1 is already cancelled." }));
    await expect(createWiredLab(lab.client).taskActions("s1").retry("t1")).rejects.toThrow("Task t1 is already cancelled.");
  });

  it("carries a failed row's error, read once for its attempt, and none on a row that didn't fail", async () => {
    const failed = { id: "t9", goal: "Export invoices", status: "errored", attempts: 2 };
    const lab = fakeClient([RUNNING, failed], (sent) =>
      sent.action === "getTask_tasks" ? { ok: true, task: { ...failed, error: "The export timed out after 30s." } } : { ok: true },
    );
    const wired = createWiredLab(lab.client);
    const read = () =>
      new Promise<TaskRow[]>((resolve) => {
        const stop = wired.watchTasks("s1", (rows) => {
          stop();
          resolve(rows);
        });
      });
    const rows = await read();
    expect(rows.find((r) => r.id === "t9")?.error).toBe("The export timed out after 30s.");
    expect(rows.find((r) => r.id === "t1")?.error).toBeUndefined();
    await read();
    expect(lab.sent.filter((s) => s.action === "getTask_tasks")).toEqual([{ flow: "agent", action: "getTask_tasks", input: { id: "t9" }, sessionId: "s1" }]);
  });

  it("asks again for a failed row's error after a read of it failed", async () => {
    const failed = { id: "t9", goal: "Export invoices", status: "errored", attempts: 2 };
    let reads = 0;
    const lab = fakeClient([failed], (sent) => {
      if (sent.action !== "getTask_tasks") return { ok: true };
      reads += 1;
      if (reads === 1) throw new Error("Network error");
      return { ok: true, task: { ...failed, error: "The export timed out after 30s." } };
    });
    const wired = createWiredLab(lab.client);
    // The first watch's read fails on the dropped getTask, so it shows nothing.
    const first = wired.watchTasks("s1", () => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    first();
    expect(reads).toBe(1);
    const rows = await new Promise<TaskRow[]>((resolve) => {
      const stop = wired.watchTasks("s1", (next) => {
        stop();
        resolve(next);
      });
    });
    expect(rows.find((r) => r.id === "t9")?.error).toBe("The export timed out after 30s.");
  });
});

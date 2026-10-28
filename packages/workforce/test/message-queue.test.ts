/**
 * A message queues behind the user (FIX-2239, epic ER-4): in a task's session,
 * a task held on the user's question holds a message as a stop does. A
 * question has no request to wait on, so the message parks bound to the task
 * row with a short deadline, looks again at each resume, and lands once the
 * question is answered. Every write and park is read off a hand-built context.
 *
 * Why it matters: a message landing beside an open question would reach the
 * work while it waits for its user (FIX-2058 ER-2's rule that both a stop and
 * a question hold a task).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ledger = {
  collectionId: "conversations",
  rows: [] as Array<Record<string, unknown>>,
  list() {
    return this.rows;
  }
};

vi.mock("@flow-state-dev/orchestration/tasks", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/orchestration/tasks")>()),
  findTaskPartitions: async () => ["alice"]
}));
vi.mock("../src/conversation-board/ledger", async (original) => ({
  ...(await original<typeof import("../src/conversation-board/ledger")>()),
  conversationLedgerAt: async () => ledger
}));

const { queueBehindUser, QUESTION_RECHECK_MS } = await import("../src/messages/queue");

/** The coder's task, in session `s_task`, held on a question until `answered`. */
const taskRow = (answered: boolean) => ({
  id: "t1",
  status: "in_progress",
  run: { sessionId: "s_task" },
  questions: [{ id: "h1", source: { kind: "row" }, kind: "question", prompt: "Which branch?" }],
  steers: answered ? [{ id: "s1", answers: "h1", text: "main" }] : []
});

function harness(options: { userStop?: string; depth?: number; sweeper?: boolean } = {}) {
  const memo = new Map<string, unknown>();
  const parked: Array<Record<string, any>> = [];
  const row: Record<string, unknown> = { id: "msg_1" };
  const ref = {
    get state() {
      return row;
    },
    patchState: async (patch: Record<string, unknown>) => void Object.assign(row, patch),
    updateState: async (fn: (state: Record<string, unknown>) => Record<string, unknown>) => {
      const next = fn({ ...row });
      for (const key of Object.keys(row)) delete row[key];
      Object.assign(row, next);
    }
  };
  const ctx = {
    session: { identity: { id: "s_task" }, state: { taskId: "t1" } },
    request: { identity: { id: "r_msg" } },
    requestHost: {
      resumeWait: async () => ({ ok: true }),
      hasWaitSweeper: options.sweeper ?? true,
      waits: {
        deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 },
        depth: async () => options.depth ?? 2,
        userStop: async () => (options.userStop === undefined ? undefined : { requestId: options.userStop })
      }
    },
    runOnce: async <T>(key: string, fn: () => Promise<T>) => {
      if (!memo.has(key)) memo.set(key, await fn());
      return memo.get(key) as T;
    },
    // Each park resumes at its deadline: the queue looks again.
    suspend: async (park: Record<string, any>) => {
      parked.push({ ...park, queuedBehind: row.queuedBehind });
      if (parked.length === 1) ledger.rows = [taskRow(true)];
      return { answered: false, deadline: true };
    },
    resources: {},
    _messageRow: ref
  };
  return { ctx, parked, row, ref };
}

vi.mock("../src/messages/message-log", async (original) => ({
  ...(await original<typeof import("../src/messages/message-log")>()),
  messageLogOf: (ctx: { _messageRow: unknown }) => ({ getOptional: async () => ctx._messageRow })
}));

beforeEach(() => {
  ledger.rows = [taskRow(false)];
});

describe("a message to a task held on a question", () => {
  it("parks bound to the task row with a short deadline, says it is queued, and lands once the question is answered", async () => {
    const { ctx, parked, row } = harness();
    const before = Date.now();
    expect(await queueBehindUser(ctx as never, { id: "msg_1" })).toBe("admitted");
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ reason: "wait", data: { board: "conversations", taskId: "t1" } });
    expect(parked[0]!.suspensionId).toMatch(/^queue:msg_1#/);
    expect(parked[0]!.data.deadline - before).toBeGreaterThanOrEqual(QUESTION_RECHECK_MS);
    expect(parked[0]!.data.deadline - before).toBeLessThan(QUESTION_RECHECK_MS + 1_000);
    // Queued while held, and the mark is gone once it lands.
    expect(parked[0]!.queuedBehind).toBe("user");
    expect(row.queuedBehind).toBeUndefined();
  });

  it("lands at once when nothing holds the task", async () => {
    ledger.rows = [taskRow(true)];
    const { ctx, parked } = harness();
    expect(await queueBehindUser(ctx as never, { id: "msg_1" })).toBe("admitted");
    expect(parked).toEqual([]);
  });

  // A question's park looks again only when its deadline resumes it. On a host with no sweeper
  // nothing would, and the message would sit parked after the question was answered.
  it("lands as before, parking nothing, on a host with no sweeper to resume a wait at its deadline", async () => {
    const { ctx, parked, row } = harness({ sweeper: false });
    expect(await queueBehindUser(ctx as never, { id: "msg_1" })).toBe("admitted");
    expect(parked).toEqual([]);
    expect(row.queuedBehind).toBeUndefined();
  });

  it("waits on the stopped request when the session is stopped for the user, and is not admitted past five waits deep", async () => {
    const stopped = harness({ userStop: "r_stopped" });
    // The first resume finds the stop gone (the user answered), so it lands.
    stopped.ctx.requestHost.waits.userStop = (() => {
      let first = true;
      return async () => (first ? ((first = false), { requestId: "r_stopped" }) : undefined);
    })();
    ledger.rows = [];
    expect(await queueBehindUser(stopped.ctx as never, { id: "msg_1" })).toBe("admitted");
    expect(stopped.parked[0]).toMatchObject({ data: { requestId: "r_stopped" } });

    const deep = harness({ userStop: "r_stopped", depth: 6 });
    expect(await queueBehindUser(deep.ctx as never, { id: "msg_1" })).toBe("not_admitted");
    expect(deep.parked).toEqual([]);
  });
});

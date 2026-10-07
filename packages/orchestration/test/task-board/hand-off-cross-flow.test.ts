/**
 * A task-board seat that names another flow must hand the row to that
 * flow's worker, not look the entry up on the sender.
 *
 * The drain's hand-off is the path a real board takes. Omitting `flowKind`
 * from the seam spec makes the host resolve `task:"work"` on the sender —
 * `flow "task-sender" declares no task entry "work"` — and no child is
 * created. The originating row then errors on the wrong destination.
 *
 * The recipient cannot declare *only* the remotely addressed task entry:
 * `defineFlow` still requires a reachable board that hands off to it (the
 * orphan-task-entry / claim-gate guard). The legitimate setup is the same
 * logical board on both flows — same `boardId`, same user-scoped ledger —
 * so the recipient can gate the entry the way a same-flow board already
 * does, while the sender's seat names `flowKind: "task-recipient"`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, SuspensionError } from "@flow-state-dev/core";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  MIN_LEASE_DURATION_MS,
  resolveResourceCollection,
  type Task,
  type TaskDispatcher,
  type TaskWorkerInput,
} from "../../src/tasks";
import { taskBoard, taskToolActions, taskWorkerInputSchema } from "../../src/task-board";

const USER_ID = "u_cross_hand_off";
const SENDER = "task-sender";
const RECIPIENT = "task-recipient";
const BOARD_ID = "work-board";
const LEDGER_ID = "cross-flow-work";

function workWorker(ran: string[]) {
  return handler({
    name: "recipient-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { handled: input.taskId };
    },
  });
}

function sharedLedger() {
  return defineTaskCollection({ id: LEDGER_ID, scope: "user" });
}

/**
 * The recipient's own board/gate story — same boardId and ledger as the
 * sender, so the claim gate that `defineFlow` wraps around `work` can
 * verify the row the sender claimed. No initial tasks: this board exists
 * to bind the gate, not to drain.
 */
function recipientFlow(ran: string[]) {
  const worker = workWorker(ran);
  const board = taskBoard({
    name: `${RECIPIENT}-board`,
    boardId: BOARD_ID,
    collection: sharedLedger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: `${RECIPIENT}-hand-off`,
        action: "work",
        session: "per-task",
      }),
    },
  });

  return defineFlow({
    kind: RECIPIENT,
    actions: { drain: { block: board.drain } },
    task: { actions: { work: { block: worker } } },
  })({ id: RECIPIENT });
}

function senderFlow() {
  const board = taskBoard({
    name: `${SENDER}-board`,
    boardId: BOARD_ID,
    collection: sharedLedger(),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: `${SENDER}-hand-off`,
        flowKind: RECIPIENT,
        action: "work",
        session: "per-task",
      }),
    },
    initialTasks: [
      {
        id: "t1",
        goal: "do the background thing",
        assignee: "work",
        input: { note: "background" },
      },
    ],
  });

  return defineFlow({
    kind: SENDER,
    actions: { start: { block: board.drain } },
  })({ id: SENDER });
}

async function durableRow(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  const row = await stores.resourceState.get("user", `${USER_ID}:~org:${DEFAULT_ORG_ID}`, `${LEDGER_ID}/${taskId}`);
  return row?.state as Task | undefined;
}

async function until(predicate: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("a cross-flow task-board hand-off", () => {
  it("still refuses a recipient that only declares the remotely addressed task entry", () => {
    expect(() =>
      defineFlow({
        kind: RECIPIENT,
        actions: {},
        task: { actions: { work: { block: workWorker([]) } } },
      })
    ).toThrow(/declares task entry "work", but no task board reachable from the flow hands off to it/);
  });

  it("reaches the recipient worker and settles the originating row", async () => {
    const ran: string[] = [];
    const sender = senderFlow();
    const recipient = recipientFlow(ran);
    const state = createFlowState({
      flows: { [SENDER]: sender, [RECIPIENT]: recipient },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({}),
    });

    try {
      const runtime: FlowStateRuntime = await state.getRuntime();
      const parent = await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: sender,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_sender",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      });

      expect(parent.error).toBeUndefined();

      const afterParent = await durableRow(runtime.stores, "t1");
      // A refused hand-off restores the claim and recordError fails the row.
      // The wrong-destination miss looks like: flow "task-sender" declares
      // no task entry "work". In-process dispatch may finish the child
      // before this assertion, so "already completed" is success; errored
      // is the hole this test exists to close.
      if (afterParent?.status === "errored") {
        throw new Error(
          `hand-off failed the originating row before a child ran: ${afterParent.error ?? "(no error)"}`
        );
      }

      await until(async () => {
        const row = await durableRow(runtime.stores, "t1");
        return row?.status === "completed";
      }, "the recipient worker to settle the originating row");

      expect(ran).toEqual(["t1"]);
      const afterChild = await durableRow(runtime.stores, "t1");
      expect(afterChild?.status).toBe("completed");

      const children = await runtime.stores.session.list({
        userId: USER_ID,
        parentage: { parentOf: "s_sender" },
      });
      expect(children).toHaveLength(1);
      expect(children[0]?.flowKind).toBe(RECIPIENT);
    } finally {
      await state.dispose();
    }
  });
});

// ─── A ledger kept per conversation, handed to another flow ─────────────────
//
// A board in each conversation of a coordinator flow, handing its rows to an
// agent flow's task entry. A lineage stops at a flow, so the rows sit at the
// owner's user scope, which crosses it; `partitionBy` keeps one set of rows
// per conversation there. Promoted from the FIX-1794 POC (its U1, E1 and X1
// legs): without the partition, one conversation's drain takes another's task
// (U1), and a claim filter alone still lists and waits on it (E1).

const COORD = "partition-coordinator";
const AGENT = "partition-agent";
const PARTITION_BOARD = "partition-board";
const PARTITION_LEDGER = "partition-tasks";
const ALICE = "alice";
const BOB = "bob";

/**
 * What the composing layer would derive from server-written data: the
 * conversation's id plus a value minted at its birth. The test holds the
 * births so it can delete and recreate a conversation (BR-14).
 */
const births = new Map<string, number>();
const conversationKey = ({ sessionId }: { sessionId: string }): string =>
  `${sessionId}#${births.get(sessionId) ?? 0}`;

const partitionedLedger = defineTaskCollection({
  id: PARTITION_LEDGER,
  scope: "user",
  partitionBy: conversationKey,
});

/** Each run of the agent-flow entry, with where and as whom it ran. */
const agentRuns: Array<{ taskId: string; attempt: number; userId: string; sessionId: string }> = [];
/** Per-task script for the agent's worker: what each attempt does. */
const scripts = new Map<string, (attempt: number) => "complete" | "suspend" | "park" | "slow">();
/** Where a `park` script parks its row: the partition the test filed it in. */
const parkIn = new Map<string, string>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Claims under a short lease, so renewal and a lapse are observable on the wall clock. */
const shortLease: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, { leaseDurationMs: MIN_LEASE_DURATION_MS });
  },
};

/**
 * The coordinator flow. `sameFlow` hands rows to its own `work` entry instead
 * of the agent flow's: the child is then on the board's own flow, where its
 * context still names its own partition, not the board's.
 */
function partitionCoordinator(sameFlow = false) {
  const board = taskBoard({
    name: "conv_board",
    boardId: PARTITION_BOARD,
    collection: partitionedLedger,
    dispatcher: shortLease,
    // Bounded, so a drain that never reaches its exit shows as a number rather
    // than a hang (POC E1): by default a board polls 10,000 times.
    maxIterations: 40,
    idlePollMs: 10,
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: "conv-hand-off",
        ...(sameFlow ? {} : { flowKind: AGENT }),
        action: "work",
        session: "per-task",
      }),
    },
  });

  const file = handler({
    name: "conv-file",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (input, ctx) => {
      await (ctx.cap as any).conv_board.addTask({ id: input.id, goal: input.id, assignee: "work" });
      return null;
    },
  });

  const read = handler({
    name: "conv-read",
    inputSchema: z.object({}),
    outputSchema: z.object({ ids: z.array(z.string()) }),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const rows = (await (ctx.cap as any).conv_board.listTasks({})) as Array<{ id: string }>;
      return { ids: rows.map((row) => row.id).sort() };
    },
  });

  return defineFlow({
    kind: COORD,
    actions: {
      file: { inputSchema: file.inputSchema, block: file },
      drain: { block: board.drain },
      read: { inputSchema: read.inputSchema, block: read },
      // The board's task tools as public actions: `listTasks_partition-tasks`, …
      ...taskToolActions(board),
    },
    ...(sameFlow ? { task: { actions: { work: { block: agentWorker() } } } } : {}),
  })({ id: COORD });
}

/** The task entry's worker: records each run, then does what its script says. */
function agentWorker() {
  return handler({
    name: "agent-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: async (input: TaskWorkerInput, ctx) => {
      agentRuns.push({
        taskId: input.taskId,
        attempt: input.attempts,
        userId: ctx.session.identity.userId as string,
        sessionId: ctx.session.identity.id,
      });
      const step = scripts.get(input.taskId)?.(input.attempts) ?? "complete";
      if (step === "suspend") {
        // The run dies as far as the board can tell: no recorder runs and its
        // renewal stops, so the lease lapses with the row in progress.
        throw new SuspensionError({ suspensionId: `gone-${input.taskId}`, reason: "human_approval" });
      }
      if (step === "slow") await sleep(MIN_LEASE_DURATION_MS * 2);
      if (step === "park") {
        // The worker parks its row in the partition that filed it, which is
        // never the one this (child) session's own context would name.
        const tasks = await getOrCreateTaskCollection({
          ctx,
          backing: "resource",
          collectionId: PARTITION_LEDGER,
          collection: resolveResourceCollection(ctx, PARTITION_LEDGER)!,
          partition: parkIn.get(input.taskId),
        });
        await tasks.awaitReview(input.taskId, "needs a person");
      }
      return { handled: input.taskId };
    },
  });
}

function partitionAgent() {
  const worker = agentWorker();

  // The agent flow gates its entry with the same board over the same ledger.
  // It never drains, and it never computes a partition: the hand-off names it.
  const board = taskBoard({
    name: "agent_board",
    boardId: PARTITION_BOARD,
    collection: partitionedLedger,
    workers: {
      work: dispatcher<TaskWorkerInput>({ name: "agent-hand-off", action: "work", session: "per-task" }),
    },
  });

  return defineFlow({
    kind: AGENT,
    actions: { drain: { block: board.drain } },
    task: { actions: { work: { block: worker } } },
  })({ id: AGENT });
}

async function bootPartitioned(sameFlow = false) {
  agentRuns.length = 0;
  scripts.clear();
  parkIn.clear();
  births.clear();
  const coordinator = partitionCoordinator(sameFlow);
  const agent = partitionAgent();
  const state = createFlowState({
    flows: { [COORD]: coordinator, [AGENT]: agent },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const runtime: FlowStateRuntime = await state.getRuntime();
  const stores = runtime.stores;

  const act = (
    userId: string,
    sessionId: string,
    actionName: string,
    input: unknown = {},
    flow: typeof coordinator = coordinator
  ) =>
    runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input,
      userId,
      sessionId,
      stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });

  /** The row as stored: `<ledger>/<partition segment>/<task id>`, in the user's cell in the org. */
  const row = async (userId: string, partition: string, taskId: string) =>
    (
      await stores.resourceState.get(
        "user",
        `${userId}:~org:${DEFAULT_ORG_ID}`,
        `${PARTITION_LEDGER}/${encodeUserSegment(partition)}/${taskId}`
      )
    )?.state as Task | undefined;

  const ids = async (userId: string, sessionId: string): Promise<string[]> => {
    const result = await act(userId, sessionId, "read");
    expect(result.error).toBeUndefined();
    return (result.output as { ids: string[] }).ids;
  };

  /** Run a drain and return its last loop record: did it reach its exit? */
  const drained = async (userId: string, sessionId: string) => {
    const result = await act(userId, sessionId, "drain");
    expect(result.error).toBeUndefined();
    return (result.output as Array<{ shouldContinue: boolean; reason: string }>).at(-1);
  };

  return { state, stores, coordinator, agent, act, row, ids, drained };
}

describe("a ledger kept per conversation, handed to a task session", () => {
  it("U1 · one conversation's drain claims, lists and waits on only its own task", async () => {
    const h = await bootPartitioned();
    try {
      expect((await h.act(ALICE, "conv_a", "file", { id: "a1" })).error).toBeUndefined();
      expect((await h.act(ALICE, "conv_b", "file", { id: "b1" })).error).toBeUndefined();

      // E1's wake: the drain reaches its exit rather than polling on a row it
      // can never claim.
      expect((await h.drained(ALICE, "conv_a"))?.shouldContinue).toBe(false);
      await until(async () => (await h.row(ALICE, "conv_a#0", "a1"))?.status === "completed", "a1");

      // U1: conv_b's task was not taken. It waits, pending, for its own conversation.
      expect((await h.row(ALICE, "conv_b#0", "b1"))?.status).toBe("pending");
      expect(agentRuns.map((run) => run.taskId)).toEqual(["a1"]);
      // E1's read: each conversation lists its own row only.
      expect(await h.ids(ALICE, "conv_a")).toEqual(["a1"]);
      expect(await h.ids(ALICE, "conv_b")).toEqual(["b1"]);
      // And so do the board's task tools, sent as actions.
      const listed = await h.act(ALICE, "conv_a", "listTasks_partition-tasks");
      expect(listed.error).toBeUndefined();
      expect(JSON.stringify(listed.output)).toContain('"a1"');
      expect(JSON.stringify(listed.output)).not.toContain('"b1"');
      // A cancel naming conv_b's task from conv_a reaches nothing.
      await h.act(ALICE, "conv_a", "cancelTask_partition-tasks", { taskId: "b1" });
      expect((await h.row(ALICE, "conv_b#0", "b1"))?.status).toBe("pending");

      // The task session ran on the agent flow, as alice, a child of conv_a.
      const a1 = agentRuns[0]!;
      expect(a1.userId).toBe(ALICE);
      expect(await h.stores.session.get(a1.sessionId)).toMatchObject({
        userId: ALICE,
        flowKind: AGENT,
        parentSessionId: "conv_a",
      });

      // conv_b's own drain runs conv_b's task, in a child of conv_b.
      expect((await h.drained(ALICE, "conv_b"))?.shouldContinue).toBe(false);
      await until(async () => (await h.row(ALICE, "conv_b#0", "b1"))?.status === "completed", "b1");
      const b1 = agentRuns.find((run) => run.taskId === "b1")!;
      expect((await h.stores.session.get(b1.sessionId))?.parentSessionId).toBe("conv_b");
    } finally {
      await h.state.dispose();
    }
  });

  it("U1 on one flow · a same-flow hand-off reads its row in the board's partition, not its own", async () => {
    const h = await bootPartitioned(true);
    try {
      await h.act(ALICE, "conv_a", "file", { id: "a1" });
      await h.act(ALICE, "conv_b", "file", { id: "b1" });
      expect((await h.drained(ALICE, "conv_a"))?.shouldContinue).toBe(false);
      await until(async () => (await h.row(ALICE, "conv_a#0", "a1"))?.status === "completed", "a1");
      expect((await h.row(ALICE, "conv_b#0", "b1"))?.status).toBe("pending");
      expect(agentRuns.map((run) => run.taskId)).toEqual(["a1"]);
      expect((await h.stores.session.get(agentRuns[0]!.sessionId))).toMatchObject({
        flowKind: COORD,
        parentSessionId: "conv_a",
      });
      expect(await h.ids(ALICE, "conv_a")).toEqual(["a1"]);
    } finally {
      await h.state.dispose();
    }
  });

  it("keeps two conversations' rows of one task id apart", async () => {
    const h = await bootPartitioned();
    try {
      await h.act(ALICE, "conv_a", "file", { id: "same" });
      await h.act(ALICE, "conv_b", "file", { id: "same" });
      await h.drained(ALICE, "conv_a");
      await until(async () => (await h.row(ALICE, "conv_a#0", "same"))?.status === "completed", "conv_a's row");
      expect((await h.row(ALICE, "conv_b#0", "same"))?.status).toBe("pending");
    } finally {
      await h.state.dispose();
    }
  });

  it("X1 · BR-13 · bob's conversation on the same declaration reads and drains only bob's rows", async () => {
    const h = await bootPartitioned();
    try {
      await h.act(ALICE, "conv_a", "file", { id: "a1" });
      await h.act(BOB, "conv_bob", "file", { id: "x1" });

      expect(await h.ids(BOB, "conv_bob")).toEqual(["x1"]);
      await h.drained(BOB, "conv_bob");
      await until(async () => (await h.row(BOB, "conv_bob#0", "x1"))?.status === "completed", "x1");
      expect((await h.row(ALICE, "conv_a#0", "a1"))?.status).toBe("pending");
      expect(agentRuns.map((run) => run.userId)).toEqual([BOB]);
    } finally {
      await h.state.dispose();
    }
  });

  it("BR-14 · a conversation deleted and created again under the same id starts with an empty board", async () => {
    const h = await bootPartitioned();
    try {
      await h.act(ALICE, "conv_a", "file", { id: "old" });
      // The conversation is recreated: same id, a new birth.
      births.set("conv_a", 1);
      expect(await h.ids(ALICE, "conv_a")).toEqual([]);
      expect((await h.drained(ALICE, "conv_a"))?.shouldContinue).toBe(false);
      expect(agentRuns).toEqual([]);
      // The old row stays in the store, unread and unclaimed.
      expect((await h.row(ALICE, "conv_a#0", "old"))?.status).toBe("pending");
    } finally {
      await h.state.dispose();
    }
  });

  it("V2 · the agent-flow task entry is not a public action", async () => {
    const h = await bootPartitioned();
    try {
      await expect(h.act(ALICE, "conv_x", "work", {}, h.agent)).rejects.toThrow(
        /does not define action "work"/
      );
      expect(agentRuns).toEqual([]);
    } finally {
      await h.state.dispose();
    }
  });

  it("V2 · a cross-flow task session renews its row's lease in the named partition", async () => {
    const h = await bootPartitioned();
    try {
      scripts.set("slow", () => "slow");
      await h.act(ALICE, "conv_a", "file", { id: "slow" });
      await h.drained(ALICE, "conv_a");
      await until(async () => (await h.row(ALICE, "conv_a#0", "slow"))?.run !== undefined, "the run link");
      const first = (await h.row(ALICE, "conv_a#0", "slow"))!.leaseUntil!;
      // Past the first lease: only the task session's renewal keeps it ahead.
      await sleep(MIN_LEASE_DURATION_MS * 1.2);
      const renewed = await h.row(ALICE, "conv_a#0", "slow");
      expect(renewed?.status).toBe("in_progress");
      expect(renewed!.leaseUntil!).toBeGreaterThan(first);
      await until(async () => (await h.row(ALICE, "conv_a#0", "slow"))?.status === "completed", "slow");
      expect(agentRuns.map((run) => run.taskId)).toEqual(["slow"]);
    } finally {
      await h.state.dispose();
    }
  }, 20_000);

  it("V2 · a cross-flow task session parks its row in the named partition", async () => {
    const h = await bootPartitioned();
    try {
      scripts.set("ask", () => "park");
      parkIn.set("ask", "conv_a#0");
      await h.act(ALICE, "conv_a", "file", { id: "ask" });
      await h.drained(ALICE, "conv_a");
      await until(async () => (await h.row(ALICE, "conv_a#0", "ask"))?.status === "parked", "the park");
      // The recorders leave a parked row parked.
      await sleep(100);
      expect((await h.row(ALICE, "conv_a#0", "ask"))?.status).toBe("parked");
    } finally {
      await h.state.dispose();
    }
  });

  it("V2 · BR-15 · a dead cross-flow run's row is taken back by its own board, not another conversation's", async () => {
    const h = await bootPartitioned();
    try {
      scripts.set("t", (attempt) => (attempt === 1 ? "suspend" : "complete"));
      await h.act(ALICE, "conv_a", "file", { id: "t" });
      await h.act(ALICE, "conv_a", "drain");
      await until(() => agentRuns.length === 1, "the first attempt");
      // Let the dead attempt's lease lapse.
      await sleep(MIN_LEASE_DURATION_MS * 1.5);

      // Another conversation's drain never reaches the row.
      await h.drained(ALICE, "conv_b");
      expect(agentRuns).toHaveLength(1);
      expect((await h.row(ALICE, "conv_a#0", "t"))?.status).toBe("in_progress");

      // Its own board takes it back and runs it once more.
      await h.act(ALICE, "conv_a", "drain");
      await until(async () => (await h.row(ALICE, "conv_a#0", "t"))?.status === "completed", "the reclaim");
      expect(agentRuns.map((run) => run.attempt)).toEqual([1, 2]);
      const settled = (await h.row(ALICE, "conv_a#0", "t"))!;
      expect(settled.attempts).toBe(2);
      expect(settled.abandonments).toBe(1);
    } finally {
      await h.state.dispose();
    }
  }, 20_000);
});

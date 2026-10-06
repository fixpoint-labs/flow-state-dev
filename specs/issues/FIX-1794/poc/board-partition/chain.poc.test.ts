/**
 * FIX-1794 POC · a board whose rows cross a flow, on TODAY's Layer 1.
 * Experimental evidence, not a maintained test: run it with `run.sh`, which
 * copies it into packages/orchestration/test for the run.
 *
 * Two flows, as the chain has them: a coordinator flow that keeps a board in
 * each conversation, and an agent flow whose task entry works the rows. A lineage
 * stops at a flow (the epic POC's C1), so the ledger is at the owner's user scope,
 * which crosses flows today (`hand-off-cross-flow.test.ts`).
 *
 * Legs:
 *   U1  control     two of alice's conversations on one UNPARTITIONED user ledger:
 *                   does one conversation's drain claim the other's row?
 *   E1  layer 2     the same, with today's claim narrow (the `runOwnerDispatcher`
 *                   shape) keyed on the conversation that filed the row: what does
 *                   it hold, and what does it leave open?
 *   F1  follow-up   the agent-flow task session replies `{ from: true }`: does the
 *                   reply land in the conversation that holds the board, as alice?
 *   X1  two users   bob's conversation on the same declaration: does it see alice's rows?
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  defineTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskDispatcher,
  type TaskWorkerInput,
} from "../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../src/task-board";

const COORD = "coordinator-poc";
const AGENT = "agent-poc";
const BOARD_ID = "chain-board";
const LEDGER = "chain-tasks";
const ALICE = "alice";
const BOB = "bob";

/** One declaration, shared by both flows: one ledger at the owner's user scope. */
const ledger = defineTaskCollection({ id: LEDGER, scope: "user" });

/** Where each run of the agent-flow task entry, and each reply, is written down. */
const ran: Array<{ taskId: string; userId: string; sessionId: string }> = [];
const replies: Array<{ taskId: string; userId: string; sessionId: string }> = [];

const who = (ctx: any) => ({
  userId: ctx.session.identity.userId as string,
  sessionId: ctx.session.identity.id as string,
});

/**
 * Today's claim narrow, as `runOwnerDispatcher` uses it: a row is claimable
 * only by the conversation recorded on it at filing. The record is a metadata
 * field the filing writes from the session's own id.
 */
const ownConversationOnly: TaskDispatcher = {
  async claim(collection: TaskCollectionRef, workerId: string, ctx: any) {
    const mine = ctx.session.identity.id as string;
    return collection.claim(workerId, {
      eligibility: (task: Task) => (task.metadata as { conversation?: string } | undefined)?.conversation === mine,
    });
  },
};

function coordinatorFlow(narrow: boolean) {
  const board = taskBoard({
    name: "chain_board",
    boardId: BOARD_ID,
    collection: ledger,
    // Bounded so the narrow's open drain shows up as a number, not a hang: by
    // default a board polls 10,000 times, 50 ms apart.
    ...(narrow ? { dispatcher: ownConversationOnly, maxIterations: 40, idlePollMs: 10 } : {}),
    workers: {
      work: dispatcher<TaskWorkerInput>({
        name: "coord-hand-off",
        flowKind: AGENT,
        action: "work",
        session: "per-task",
      }),
    },
  });

  /** File one row, recording the conversation from the session (never from input). */
  const file = handler({
    name: "file",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.null(),
    uses: [board.capability],
    execute: async (input, ctx: any) => {
      await ctx.cap.chain_board.addTask({
        id: input.id,
        goal: input.id,
        assignee: "work",
        metadata: { conversation: who(ctx).sessionId },
      });
      return null;
    },
  });

  /** What the conversation's own board read returns. */
  const read = handler({
    name: "read",
    inputSchema: z.object({}),
    outputSchema: z.object({ ids: z.array(z.string()) }),
    uses: [board.capability],
    execute: async (_input, ctx: any) => {
      const rows = (await ctx.cap.chain_board.listTasks({})) as Array<{ id: string }>;
      return { ids: rows.map((r) => r.id).sort() };
    },
  });

  /** The follow-up door: the task session's reply lands here. */
  const settled = handler({
    name: "settled",
    inputSchema: z.object({ taskId: z.string() }),
    outputSchema: z.null(),
    execute: async (input, ctx: any) => {
      replies.push({ taskId: input.taskId, ...who(ctx) });
      return null;
    },
  });

  return defineFlow({
    kind: COORD,
    actions: {
      file: { inputSchema: file.inputSchema, block: file },
      drain: { block: board.drain },
      read: { inputSchema: read.inputSchema, block: read },
    },
    internal: { actions: { settled: { block: settled } } },
  })({ id: COORD });
}

function agentFlow() {
  /** Reply to whoever dispatched this run, at the seam-stamped sender. */
  const reply = dispatcher({
    name: "reply-to-board",
    flowKind: COORD,
    action: "settled",
    inputSchema: z.object({ taskId: z.string() }),
    session: { from: true },
  });

  const record = handler({
    name: "agent-work",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ taskId: z.string() }),
    execute: async (input: TaskWorkerInput, ctx: any) => {
      ran.push({ taskId: input.taskId, ...who(ctx) });
      return { taskId: input.taskId };
    },
  });

  // The worker, then the reply: composed as a sequencer (BP-011), not called.
  const worker = sequencer({ name: "agent-work-and-reply", inputSchema: taskWorkerInputSchema })
    .step(record)
    .step(reply);

  // The recipient gates its entry with the same board over the same ledger, as
  // `hand-off-cross-flow.test.ts` does. It never drains.
  const board = taskBoard({
    name: "agent_board",
    boardId: BOARD_ID,
    collection: ledger,
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

async function boot(narrow: boolean) {
  ran.length = 0;
  replies.length = 0;
  const coordinator = coordinatorFlow(narrow);
  const agent = agentFlow();
  const state = createFlowState({
    flows: { [COORD]: coordinator, [AGENT]: agent },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({}),
  });
  const runtime: FlowStateRuntime = await state.getRuntime();
  const stores: StoreRegistry = runtime.stores;

  const act = async (userId: string, sessionId: string, actionName: string, input: unknown = {}) => {
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: coordinator,
      actionName,
      input,
      userId,
      sessionId,
      stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    });
    return result;
  };

  const row = async (userId: string, id: string) =>
    (await stores.resourceState.get("user", userId, `${LEDGER}/${id}`))?.state as Task | undefined;

  const until = async (predicate: () => Promise<boolean> | boolean, label: string) => {
    for (let i = 0; i < 300; i++) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  return { state, stores, act, row, until };
}

// ─── U1 · the control: one unpartitioned ledger for all of alice's conversations ───

describe("U1 · control · two conversations on one unpartitioned user-scoped ledger", () => {
  it("U1 conversation A's drain claims and hands off conversation B's row", async () => {
    const h = await boot(false);
    try {
      expect((await h.act(ALICE, "conv_a", "file", { id: "a1" })).error).toBeUndefined();
      expect((await h.act(ALICE, "conv_b", "file", { id: "b1" })).error).toBeUndefined();

      // Only conversation A drains.
      expect((await h.act(ALICE, "conv_a", "drain")).error).toBeUndefined();
      await h.until(async () => (await h.row(ALICE, "b1"))?.status === "completed", "b1 to complete");

      // B's row ran, from A's drain: its task session is a child of conv_a, not conv_b.
      const b1 = ran.find((r) => r.taskId === "b1");
      expect(b1).toBeDefined();
      const parentOfB1 = (await h.stores.session.get(b1!.sessionId))?.parentSessionId;
      expect(parentOfB1).toBe("conv_a");
      // And B's reply went to A, the conversation that never filed it.
      await h.until(() => replies.some((r) => r.taskId === "b1"), "b1's reply");
      expect(replies.find((r) => r.taskId === "b1")?.sessionId).toBe("conv_a");

      // A's board read lists B's row too.
      const read = await h.act(ALICE, "conv_a", "read");
      expect((read.output as { ids: string[] }).ids).toEqual(["a1", "b1"]);
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── E1 · today's claim narrow, keyed on the filing conversation ───

describe("E1 · Layer 2 · a claim narrow keyed on the conversation that filed the row", () => {
  it("E1 A's drain claims only A's row, but A's board still reads B's, and B's row waits for B", async () => {
    const h = await boot(true);
    try {
      await h.act(ALICE, "conv_a", "file", { id: "a1" });
      await h.act(ALICE, "conv_b", "file", { id: "b1" });

      const drained = await h.act(ALICE, "conv_a", "drain");
      expect(drained.error).toBeUndefined();
      // The narrow holds the claim, not the wake: B's pending row is claimable
      // to the substrate, so A's drain never reaches its exit. It polled until
      // its iteration budget ran out, still "idle" and still asking to go on.
      // At the default budget that is 10,000 polls, 50 ms apart.
      const loop = drained.output as Array<{ shouldContinue: boolean; reason: string }>;
      expect(loop.at(-1)).toEqual({ shouldContinue: true, reason: "idle" });
      await h.until(async () => (await h.row(ALICE, "a1"))?.status === "completed", "a1 to complete");

      // The narrow holds the claim: B's row is untouched by A's drain.
      expect((await h.row(ALICE, "b1"))?.status).toBe("pending");
      expect(ran.map((r) => r.taskId)).toEqual(["a1"]);

      // It does not narrow the read: A's board lists B's row.
      const read = await h.act(ALICE, "conv_a", "read");
      expect((read.output as { ids: string[] }).ids).toEqual(["a1", "b1"]);

      // B's own drain runs B's row.
      await h.act(ALICE, "conv_b", "drain");
      await h.until(async () => (await h.row(ALICE, "b1"))?.status === "completed", "b1 to complete");
      expect(ran.find((r) => r.taskId === "b1")).toBeDefined();
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── F1 · the follow-up path back across the flow ───

describe("F1 · the task session's reply lands in the conversation that holds the board", () => {
  it("F1 the agent-flow task session runs as alice, and `{ from: true }` reaches conv_a as alice", async () => {
    const h = await boot(true);
    try {
      await h.act(ALICE, "conv_a", "file", { id: "a1" });
      await h.act(ALICE, "conv_a", "drain");
      await h.until(() => replies.some((r) => r.taskId === "a1"), "a1's reply");

      const run = ran.find((r) => r.taskId === "a1")!;
      expect(run.userId).toBe(ALICE);
      const child = await h.stores.session.get(run.sessionId);
      expect(child).toMatchObject({ userId: ALICE, flowKind: AGENT, parentSessionId: "conv_a" });
      // The child roots its own lineage: the board cannot be shared down it.
      expect(child?.lineageId).not.toBe((await h.stores.session.get("conv_a"))?.lineageId);

      expect(replies.find((r) => r.taskId === "a1")).toEqual({ taskId: "a1", userId: ALICE, sessionId: "conv_a" });
    } finally {
      await h.state.dispose();
    }
  });
});

// ─── X1 · another user ───

describe("X1 · bob on the same declaration sees none of alice's rows", () => {
  it("X1 bob's board reads and drains only bob's user scope", async () => {
    const h = await boot(false);
    try {
      await h.act(ALICE, "conv_a", "file", { id: "a1" });
      await h.act(BOB, "conv_bob", "file", { id: "x1" });

      const read = await h.act(BOB, "conv_bob", "read");
      expect((read.output as { ids: string[] }).ids).toEqual(["x1"]);

      await h.act(BOB, "conv_bob", "drain");
      await h.until(async () => (await h.row(BOB, "x1"))?.status === "completed", "x1 to complete");
      expect((await h.row(ALICE, "a1"))?.status).toBe("pending");
      expect(ran.every((r) => r.userId === BOB)).toBe(true);
    } finally {
      await h.state.dispose();
    }
  });
});

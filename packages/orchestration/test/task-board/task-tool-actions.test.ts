/**
 * `taskToolActions` — a durable board's eight task tools, as flow actions.
 *
 * What the actions are for is changing a task from OUTSIDE the request that
 * filed it: a person in the DevTool cancelling a stuck row, or bumping a
 * priority. So every leg below files its row in one request and acts on it in
 * a later one, through the engine's own action path — a test that filed and
 * acted inside one block would pass against a request-scoped ledger that
 * forgets the row the moment the request ends, which is the case the backing
 * check exists to refuse.
 *
 * The result a caller reads is the tool's own `{ ok, error }` on the root
 * trace of the request it dispatched; a refused verb writes nothing, so there
 * is no change item to read it from instead. The trace leg pins that.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  ticketForClaim,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskWorker,
} from "../../src/tasks";
import { taskBoard, taskToolActions, taskToolSuffix } from "../../src/task-board";

const TOOLS = [
  "addTask",
  "assignTask",
  "completeTask",
  "failTask",
  "blockTask",
  "cancelTask",
  "updateTask",
  "listTasks",
] as const;

let seq = 0;

const noopWorker = handler({
  name: "noop-worker",
  inputSchema: z.unknown(),
  outputSchema: z.null(),
  execute: () => null,
}) as TaskWorker;

/**
 * A flow holding one durable board's actions, plus two helpers that stand in
 * for a worker: `claimOne` takes a row the way a drain does and hands back the
 * ticket it minted, and `settleAsWorker` presents that ticket.
 */
async function host(options: { declareResource?: boolean } = {}) {
  seq += 1;
  const id = `todos${seq}`;
  const todos = defineTaskCollection({ id, scope: "session" });
  const board = taskBoard({ name: `board${seq}`, collection: todos, workers: noopWorker });

  const ledger = (ctx: BlockContext): Promise<TaskCollectionRef> =>
    getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: id,
      collection: resolveResourceCollection(ctx, id)!,
    });

  const claimOne = handler({
    name: "claim-one",
    inputSchema: z.object({}),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (_input, ctx) => {
      const tasks = await ledger(ctx);
      const task = await tasks.claim("worker-1");
      return task === null ? null : ticketForClaim(id, task);
    },
  });

  const settleAsWorker = handler({
    name: "settle-as-worker",
    inputSchema: z.object({ taskId: z.string(), claim: z.unknown() }),
    outputSchema: z.unknown(),
    uses: [board.capability],
    execute: async (input, ctx) => {
      const tasks = await ledger(ctx);
      return tasks.complete(input.taskId, "worker's result", {
        ifAllowed: true,
        claim: input.claim as TaskClaimTicket,
      });
    },
  });

  const flow = defineFlow({
    kind: `ops${seq}`,
    ...(options.declareResource === false ? {} : { resources: { [id]: todos } }),
    actions: {
      drain: { block: board.drain },
      claimOne: { block: claimOne },
      settleAsWorker: { block: settleAsWorker },
      ...taskToolActions(board),
    },
  } as never);

  const instance = flow();
  const state = createFlowState({
    flows: { [instance.kind]: instance },
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  const runtime = await state.getRuntime();

  const act = async (actionName: string, input: unknown) =>
    (await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: instance,
      actionName,
      input,
      userId: "u_ops",
      sessionId: "s_ops",
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig },
    } as never)) as { output?: any; error?: unknown; requestId?: string };

  /** The stored row, read from the store rather than through any action. */
  const row = async (taskId: string) =>
    (await runtime.stores.resourceState.get("session", "s_ops", `${id}/${taskId}`))?.state as
      | Record<string, unknown>
      | undefined;

  /** File a row in its own request, so every later action acts across requests. */
  const file = async (goal = "a row"): Promise<string> => {
    const added = await act(`addTask_${id}`, { goal });
    expect(added.output).toMatchObject({ ok: true });
    return added.output.taskId as string;
  };

  return { id, board, instance, act, row, file, runtime, dispose: () => state.dispose() };
}

describe("taskToolActions — the set", () => {
  it("names the eight tools for the board, and nothing else", async () => {
    const h = await host();
    try {
      const names = Object.keys(taskToolActions(h.board)).sort();
      expect(names).toEqual(TOOLS.map((tool) => `${tool}_${h.id}`).sort());
    } finally {
      await h.dispose();
    }
  });

  it("qualifies a dotted board id the way a channel's tools already are", () => {
    // The same qualifier a model sees on a channel board, so the DevTool can
    // scope an action to its board by one rule.
    expect(taskToolSuffix("eng.feature.work")).toBe("eng_feature_work");
    expect(taskToolSuffix("support.help.escalations")).toBe("support_help_escalations");
  });

  it("refuses a request-backed board by naming its backing", () => {
    const board = taskBoard({ name: "scratch", workers: noopWorker });
    expect(() => taskToolActions(board)).toThrow(/request-backed/);
  });

  it("refuses a sequencer-backed board by naming its backing", () => {
    const board = taskBoard({
      name: "seq",
      collection: { backing: "sequencer", collectionId: "seq" },
      workers: noopWorker,
    });
    expect(() => taskToolActions(board)).toThrow(/sequencer-backed/);
  });

  it("claims and drains nothing (FIX-1457 ER-1)", async () => {
    const h = await host();
    try {
      const taskId = await h.file();
      await h.act(`updateTask_${h.id}`, { taskId, patch: { priority: 3 } });
      const stored = await h.row(taskId);
      expect(stored?.status).toBe("pending");
      expect(stored?.attempts ?? 0).toBe(0);
    } finally {
      await h.dispose();
    }
  });
});

describe("taskToolActions — each verb on a row an earlier request filed", () => {
  it("reaches the ledger when the flow does not declare the collection", async () => {
    // Each action composes the board's capability, which installs the
    // collection. Without it a filed row lands somewhere a later request
    // cannot find it, and the next action answers `task_not_found`.
    const h = await host({ declareResource: false });
    try {
      const taskId = await h.file();
      expect((await h.act(`cancelTask_${h.id}`, { taskId })).output).toEqual({ ok: true });
    } finally {
      await h.dispose();
    }
  });


  it("cancels", async () => {
    const h = await host();
    try {
      const taskId = await h.file();
      const result = await h.act(`cancelTask_${h.id}`, { taskId, reason: "not needed" });
      expect(result.output).toEqual({ ok: true });
      expect((await h.row(taskId))?.status).toBe("cancelled");
    } finally {
      await h.dispose();
    }
  });

  it("updates, assigns and blocks", async () => {
    const h = await host();
    try {
      const a = await h.file("a");
      expect((await h.act(`updateTask_${h.id}`, { taskId: a, patch: { priority: 7, addLabel: "hot" } })).output).toEqual({ ok: true });
      expect(await h.row(a)).toMatchObject({ priority: 7, labels: ["hot"] });

      expect((await h.act(`assignTask_${h.id}`, { taskId: a, assignee: "someone" })).output).toEqual({ ok: true });
      expect((await h.row(a))?.assignee).toBe("someone");

      expect((await h.act(`blockTask_${h.id}`, { taskId: a, reason: "waiting" })).output).toEqual({ ok: true });
      expect((await h.row(a))?.status).toBe("blocked");
    } finally {
      await h.dispose();
    }
  });

  it("fails and completes a started row", async () => {
    // `failTask` and `completeTask` settle work that started; a pending row
    // refuses both, which is the verb's rule and not this surface's.
    const h = await host();
    try {
      const b = await h.file("b");
      await h.act("claimOne", {});
      expect((await h.act(`failTask_${h.id}`, { taskId: b, error: "broke" })).output).toEqual({ ok: true });
      // A row filed with no retry budget goes terminal on its first failure.
      expect(await h.row(b)).toMatchObject({ status: "errored", error: "broke" });

      const c = await h.file("c");
      await h.act("claimOne", {});
      expect((await h.act(`completeTask_${h.id}`, { taskId: c, output: { done: 1 } })).output).toEqual({ ok: true });
      expect(await h.row(c)).toMatchObject({ status: "completed", output: { done: 1 } });
    } finally {
      await h.dispose();
    }
  });

  it("lists", async () => {
    const h = await host();
    try {
      const taskId = await h.file("listed");
      const listed = await h.act(`listTasks_${h.id}`, {});
      expect(listed.output).toMatchObject({ ok: true, tasks: [{ id: taskId, goal: "listed" }] });
    } finally {
      await h.dispose();
    }
  });
});

describe("taskToolActions — refusals are values, and the caller can read them", () => {
  it("refuses a settled row, writes nothing, and leaves the answer on the root trace", async () => {
    const h = await host();
    try {
      const taskId = await h.file();
      expect((await h.act(`cancelTask_${h.id}`, { taskId })).output).toEqual({ ok: true });
      const before = await h.row(taskId);

      const refused = await h.act(`cancelTask_${h.id}`, { taskId });
      expect(refused.output).toMatchObject({ ok: false });
      expect(String(refused.output.error)).toMatch(/terminal/);
      expect(await h.row(taskId)).toEqual(before);

      // The dispatch answers with a request id and no output, and a refusal
      // emits no change item — so the root trace is the one place a caller
      // like the DevTool can read the refusal from.
      const requests = (await h.runtime.stores.request.list({ sessionId: "s_ops", withItems: true })) as Array<{
        actionName: string;
        items?: Array<{ type: string; blockInstanceId?: string; output?: unknown; component?: string }>;
      }>;
      const [last] = requests.filter((r) => r.actionName === `cancelTask_${h.id}`);
      const root = last?.items?.find((item) => item.type === "block_trace" && item.blockInstanceId?.endsWith(":root:0"));
      expect(root?.output).toEqual({ kind: "inline", value: refused.output });
      expect(last?.items?.some((item) => item.component === "task-change")).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("names a missing task rather than throwing", async () => {
    const h = await host();
    try {
      const result = await h.act(`cancelTask_${h.id}`, { taskId: "nope" });
      expect(result.output).toMatchObject({ ok: false, error: "task_not_found" });
    } finally {
      await h.dispose();
    }
  });
});

describe("taskToolActions — an action settles over a worker's claim (BR-25)", () => {
  it("lands a completion on a row a worker holds, and the worker's own result is then refused", async () => {
    const h = await host();
    try {
      const taskId = await h.file();
      const claim = (await h.act("claimOne", {})).output as TaskClaimTicket;
      expect(claim.taskId).toBe(taskId);
      expect((await h.row(taskId))?.status).toBe("in_progress");

      const settled = await h.act(`completeTask_${h.id}`, { taskId, output: "from the row" });
      expect(settled.output).toEqual({ ok: true });

      const late = await h.act("settleAsWorker", { taskId, claim });
      // Declined as `terminal`, not `lost-claim`: the substrate reports the
      // row being settled ahead of the claim going stale. Either way the
      // worker's result is refused and dropped, which is the rule.
      expect(late.output).toEqual({ outcome: "declined", reason: "terminal", status: "completed" });
      expect(await h.row(taskId)).toMatchObject({ status: "completed", output: "from the row" });
    } finally {
      await h.dispose();
    }
  });
});

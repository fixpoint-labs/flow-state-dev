/**
 * FIX-1668 — a handed-off row names the run working it, and only that run.
 *
 * The board's claim gate writes `run` (session, request, attempt) from inside
 * the child run, before the worker's first step. This scenario drives the real
 * drain and replays each captured dispatch through the `task` source, the way
 * the host would, so the gate runs as the child's own action root with the
 * child's real session and request.
 *
 * Pinned here, at full `runAction` composition:
 *
 * - BR-1 / BR-2 — the link names the session the run is actually in, whatever
 *   the seat's session policy: per-task, per-worker (two rows, one session, two
 *   requests) and a custom key. Never the claiming parent's coordinate.
 * - BR-4 — every refusal arm of the gate writes nothing: the row is exactly as
 *   the drain left it.
 * - BR-7 — a lapsed lease taken back at the gate still gets its link, and the
 *   link still reaches the change stream.
 * - BR-8 — an inline board writes none.
 * - BR-15 / V6 — `run_linked` is published on the run's own stream carrying
 *   `run` and not `claimedBy`; the drain's stream gets no copy.
 *
 * The recorded dispatch starts nothing, which is what lets each child be
 * replayed deliberately — and what lets a row be tampered with in between.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  committedLeaseSpan,
  defineTaskCollection,
  type Task,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import {
  taskBoard,
  taskWorkerInputSchema,
  type TaskSessionPolicy,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

const TASK_SOURCE = "task";
const USER_ID = "u_run_link";
/** The user's cell in the default org, where every flow keeps their user data. */
const USER_ID_CELL = `${USER_ID}:~org:${DEFAULT_ORG_ID}`;
const PARENT = "s_parent";

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

type RecordedDispatch = { sessionId: string; actionName: string; input: unknown };

function buildFlow(options: {
  kind: string;
  mode: "inline" | "hand-off";
  session?: TaskSessionPolicy<TaskWorkerInput>;
  taskIds?: string[];
}) {
  const ran: { taskId: string; sessionId: string; requestId: string }[] = [];
  const worker = handler({
    name: "run-link-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput, ctx) => {
      // What the run itself sees — the ids the link must equal.
      ran.push({
        taskId: input.taskId,
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
      });
      return { handled: input.taskId };
    },
  });

  const board = taskBoard({
    name: `${options.kind}-board`,
    boardId: `${options.kind}-board`,
    collection: defineTaskCollection({ id: `${options.kind}-ledger`, scope: "user" }),
    workers: {
      background:
        options.mode === "hand-off"
          ? dispatcher<TaskWorkerInput>({
              name: `${options.kind}-hand-off`,
              action: "background",
              session: options.session ?? "per-task",
            })
          : worker,
    },
    initialTasks: (options.taskIds ?? ["t1"]).map((id) => ({
      id,
      goal: `do ${id}`,
      assignee: "background",
      input: { note: id },
    })),
  });

  const flow = defineFlow({
    kind: options.kind,
    actions: { start: { block: board.drain } },
    ...(options.mode === "hand-off" ? { task: { actions: { background: { block: worker } } } } : {}),
  })({ id: options.kind });

  return { flow, ran };
}

async function durableRow(stores: StoreRegistry, kind: string, taskId: string) {
  const row = await stores.resourceState.get("user", USER_ID_CELL, `${kind}-ledger/${taskId}`);
  return row?.state as Task | undefined;
}

async function rewriteRow(stores: StoreRegistry, kind: string, taskId: string, patch: Partial<Task>) {
  const key = `${kind}-ledger/${taskId}`;
  const current = await stores.resourceState.get("user", USER_ID_CELL, key);
  await stores.resourceState.set(
    "user",
    USER_ID_CELL,
    key,
    { ...(current!.state as object), ...patch } as never,
    "any"
  );
}

/**
 * Every `task-change` item a request published, in order, read off its
 * persisted event stream.
 *
 * Not off the run's final item list: a `task-change` item is keyed by row, so
 * the settlement's item replaces the link's there. The stream is what a
 * subscriber actually receives, one `item.done` per change.
 */
async function taskChanges(stores: StoreRegistry, requestId: string | undefined) {
  const events = await stores.request.getEvents(requestId!);
  return events
    .map((event) => event as { type?: string; item?: { type?: string; component?: string; data?: unknown } })
    .filter(
      (event) =>
        event.type === "item.done" &&
        event.item?.type === "component" &&
        event.item.component === "task-change"
    )
    .map((event) => event.item!.data as { kind: string; taskId: string; task: Task & Record<string, unknown> });
}

/** Drain the board with a recording dispatcher; nothing is started. */
async function drain(stores: StoreRegistry, flow: ReturnType<typeof buildFlow>["flow"]) {
  const dispatched: RecordedDispatch[] = [];
  const parent = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId: PARENT,
    stores,
    runtimeConfig: {
      ...baseRuntimeConfig(),
      requestHost: {
        dispatchOperation: async (spec) => {
          dispatched.push({ sessionId: spec.sessionId, actionName: spec.action, input: spec.input });
          return { requestId: `child_req_${dispatched.length}` };
        },
      },
    },
  });
  expect(parent.error).toBeUndefined();
  return { parent, dispatched };
}

/** Replay one captured dispatch through the `task` source, as the host would. */
function replay(stores: StoreRegistry, flow: ReturnType<typeof buildFlow>["flow"], d: RecordedDispatch) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: d.actionName as never,
    input: d.input,
    userId: USER_ID,
    sessionId: d.sessionId,
    source: TASK_SOURCE,
    stores,
    runtimeConfig: baseRuntimeConfig(),
  });
}

describe("a handed-off row names the run working it", () => {
  it("per-task: the run's own session and request, published on its own stream only", async () => {
    const stores = createInMemoryStores();
    const kind = "run-link-per-task";
    const { flow, ran } = buildFlow({ kind, mode: "hand-off" });

    const { parent, dispatched } = await drain(stores, flow);
    // Between hand-off and the run's start the row names no run.
    expect((await durableRow(stores, kind, "t1"))?.run).toBeUndefined();

    const child = await replay(stores, flow, dispatched[0]!);
    expect(child.error).toBeUndefined();

    const row = await durableRow(stores, kind, "t1");
    expect(ran).toHaveLength(1);
    expect(row?.run).toEqual({
      sessionId: ran[0]!.sessionId,
      requestId: ran[0]!.requestId,
      attempt: row?.attempts,
    });
    // Not the claiming conversation's coordinate, which the row also carries
    // while the claim is open.
    expect(row?.run?.sessionId).not.toBe(PARENT);
    // Kept past completion: a finished task names the run that worked it.
    expect(row?.status).toBe("completed");

    // V6: one `run_linked` on the run's own stream, carrying the link and not
    // the claim's server-only coordinate...
    const linked = (await taskChanges(stores, child.requestId)).filter((c) => c.kind === "run_linked");
    expect(linked).toHaveLength(1);
    expect(linked[0]!.task.run).toEqual(row?.run);
    expect(linked[0]!.task).not.toHaveProperty("claimedBy");
    // ...and the last change on that stream still carries it.
    expect((await taskChanges(stores, child.requestId)).at(-1)?.task.run).toEqual(row?.run);
    // The drain's stream gets no copy.
    expect((await taskChanges(stores, parent.requestId)).some((c) => c.kind === "run_linked")).toBe(false);
  });

  it("per-worker: two rows in one session name that session and two different requests", async () => {
    const stores = createInMemoryStores();
    const kind = "run-link-per-worker";
    const { flow, ran } = buildFlow({ kind, mode: "hand-off", session: "per-worker", taskIds: ["t1", "t2"] });

    const { dispatched } = await drain(stores, flow);
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]!.sessionId).toBe(dispatched[1]!.sessionId);
    for (const d of dispatched) expect((await replay(stores, flow, d)).error).toBeUndefined();

    const t1 = await durableRow(stores, kind, "t1");
    const t2 = await durableRow(stores, kind, "t2");
    expect(t1?.run?.sessionId).toBe(t2?.run?.sessionId);
    expect(t1?.run?.requestId).not.toBe(t2?.run?.requestId);
    for (const [row, seen] of [
      [t1, ran.find((r) => r.taskId === "t1")],
      [t2, ran.find((r) => r.taskId === "t2")],
    ] as const) {
      expect(row?.run).toEqual({ sessionId: seen!.sessionId, requestId: seen!.requestId, attempt: 1 });
    }
  });

  it("a custom key: the link names the keyed session", async () => {
    const stores = createInMemoryStores();
    const kind = "run-link-key";
    const { flow, ran } = buildFlow({
      kind,
      mode: "hand-off",
      session: { key: (task) => `issue:${task.taskId}` },
    });

    const { dispatched } = await drain(stores, flow);
    expect((await replay(stores, flow, dispatched[0]!)).error).toBeUndefined();

    expect((await durableRow(stores, kind, "t1"))?.run).toEqual({
      sessionId: ran[0]!.sessionId,
      requestId: ran[0]!.requestId,
      attempt: 1,
    });
  });

  it("a lapsed lease taken back at the gate is still linked, and still announced", async () => {
    const stores = createInMemoryStores();
    const kind = "run-link-lapsed";
    const { flow, ran } = buildFlow({ kind, mode: "hand-off" });

    const { dispatched } = await drain(stores, flow);
    const claimed = (await durableRow(stores, kind, "t1"))!;
    const span = committedLeaseSpan(claimed)!;
    await rewriteRow(stores, kind, "t1", {
      updatedAt: claimed.updatedAt - span,
      leaseUntil: claimed.updatedAt,
    });

    const child = await replay(stores, flow, dispatched[0]!);
    expect(child.error).toBeUndefined();
    expect(ran).toHaveLength(1);

    const row = await durableRow(stores, kind, "t1");
    // Same attempt: the takeover renewed the claim rather than making a new one.
    expect(row?.run).toEqual({ sessionId: ran[0]!.sessionId, requestId: ran[0]!.requestId, attempt: 1 });
    // The renewal publishes nothing, so the link's own write must reach the stream.
    expect((await taskChanges(stores, child.requestId)).filter((c) => c.kind === "run_linked")).toHaveLength(1);
  });

  it("an inline board writes no link", async () => {
    const stores = createInMemoryStores();
    const kind = "run-link-inline";
    const { flow, ran } = buildFlow({ kind, mode: "inline" });

    const { parent, dispatched } = await drain(stores, flow);
    expect(dispatched).toHaveLength(0);
    expect(ran).toHaveLength(1);
    expect((await durableRow(stores, kind, "t1"))?.status).toBe("completed");
    expect((await durableRow(stores, kind, "t1"))?.run).toBeUndefined();
    expect((await taskChanges(stores, parent.requestId)).some((c) => c.kind === "run_linked")).toBe(false);
  });
});

describe("a gate that refuses the dispatch writes no link", () => {
  const arms: Array<[string, (row: Task) => Partial<Task>]> = [
    ["the attempt was superseded", (row) => ({ attempts: row.attempts + 1 })],
    ["the row was recreated", (row) => ({ incarnationId: `${row.incarnationId}-recreated` })],
    ["the row is no longer in progress", () => ({ status: "cancelled" })],
    ["the row routes to another seat", () => ({ assignee: "someone-else" })],
  ];

  it.each(arms)("%s", async (_label, tamper) => {
    const stores = createInMemoryStores();
    const kind = "run-link-refused";
    const { flow, ran } = buildFlow({ kind, mode: "hand-off" });

    const { dispatched } = await drain(stores, flow);
    const claimed = (await durableRow(stores, kind, "t1"))!;
    await rewriteRow(stores, kind, "t1", tamper(claimed));
    const before = await durableRow(stores, kind, "t1");

    const child = await replay(stores, flow, dispatched[0]!);

    expect(ran).toEqual([]);
    // Exactly as it was: no link, and nothing else moved either.
    expect(await durableRow(stores, kind, "t1")).toEqual(before);
    expect(before?.run).toBeUndefined();
    expect((await taskChanges(stores, child.requestId)).some((c) => c.kind === "run_linked")).toBe(false);
  });

  it("no such row", async () => {
    const stores = createInMemoryStores();
    const kind = "run-link-deleted";
    const { flow, ran } = buildFlow({ kind, mode: "hand-off" });

    const { dispatched } = await drain(stores, flow);
    await stores.resourceState.delete("user", USER_ID_CELL, `${kind}-ledger/t1`, "any");

    const child = await replay(stores, flow, dispatched[0]!);

    expect(ran).toEqual([]);
    expect(await durableRow(stores, kind, "t1")).toBeUndefined();
    expect((await taskChanges(stores, child.requestId)).some((c) => c.kind === "run_linked")).toBe(false);
  });
});

/**
 * FIX-2056 end-state POC, part 1 · what today's claim gate answers when it
 * settles a dispatched task. Experimental evidence, not a maintained test: run
 * it with `run.sh`, which copies it into packages/orchestration/test.
 *
 * Real engine: `createFlowState` with in-memory stores, a real `taskBoard`
 * dispatching to a `task` entry in a child session, the real claim gate
 * around it. Each assertion pins what is TRUE TODAY, so these pass on the base
 * commit and a child that changes the gate turns them red.
 *
 * The question these legs feed: the gate settles a row at the entry's last
 * step. Which of rule 6's facts can it see from there?
 *
 *   G1 background work   a `.sideChain()` still running when the row settles
 *   G2 a filed task      the entry files a row on the same board and returns
 *   G3 two suspensions   a person (`human_input`) and a wait (`external_event`)
 *   G4 a task waits      the request working a task asks today's wait primitive
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type Task,
  type TaskWorkerInput,
} from "../src/tasks";
import { dispatchAndWait, taskBoard, taskWorkerInputSchema } from "../src/task-board";

const USER_ID = "u_fix2056";
const LEDGER_ID = "fix2056-gate";

type Leg = "background" | "files" | "person" | "wait" | "waits";
const legOf = (input: TaskWorkerInput) => ((input.input ?? {}) as { leg: Leg }).leg;

/** When the side chain finished, per task id. */
const backgroundDoneAt = new Map<string, number>();

const work = handler({
  name: "fix2056-work",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ ok: z.boolean(), refused: z.string().optional() }),
  execute: async (input: TaskWorkerInput, ctx) => {
    const leg = legOf(input);
    if (leg === "waits") {
      const ref = resolveResourceCollection(ctx, LEDGER_ID);
      const tasks = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: LEDGER_ID, collection: ref! });
      // The target is never read: the task-turn refusal comes before any filing.
      const result = await dispatchAndWait(ctx, tasks, {} as never);
      return result.ok ? { ok: true } : { ok: false, refused: result.error };
    }
    if (leg === "files") {
      const ref = resolveResourceCollection(ctx, LEDGER_ID);
      const tasks = await getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: LEDGER_ID, collection: ref! });
      // Assigned to nobody the board dispatches, so it stays pending: an open filed task.
      await tasks.addTask({ id: `${input.taskId}-child`, goal: "filed by the task", assignee: "nobody" });
    }
    if (leg === "person" || leg === "wait") {
      await ctx.suspend!({
        reason: leg === "person" ? "human_input" : "external_event",
        message: leg,
        resumeSchema: z.unknown(),
      });
    }
    return { ok: true };
  },
});

const background = handler({
  name: "fix2056-background",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async (_input, ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const taskId = (ctx.session.state as { taskId?: string }).taskId ?? "unknown";
    backgroundDoneAt.set(taskId, Date.now());
    return null;
  },
});

const entry = sequencer({ name: "fix2056-entry", inputSchema: taskWorkerInputSchema, durable: true })
  .step(work)
  .sideChain(background);

function flowFor(rows: Array<{ id: string; leg: Leg }>) {
  const board = taskBoard({
    name: "fix2056",
    boardId: LEDGER_ID,
    collection: defineTaskCollection({ id: LEDGER_ID, scope: "user" }),
    workers: {
      em: dispatcher({ name: "fix2056-dispatch", type: "task", action: "work", session: { by: (t) => ({ key: `own|${t.taskId}` }) } }),
    },
    initialTasks: rows.map((r) => ({ id: r.id, goal: r.leg, assignee: "em", input: { leg: r.leg } })),
  });
  return defineFlow({
    kind: "fix2056-gate",
    actions: { start: { block: board.drain } },
    task: { actions: { work: { block: entry, durable: true } } },
  })({ id: "fix2056-gate" });
}

async function row(stores: StoreRegistry, taskId: string): Promise<Task | undefined> {
  return (await stores.resourceState.get("user", `${USER_ID}:~org:${DEFAULT_ORG_ID}`, `${LEDGER_ID}/${taskId}`))
    ?.state as Task | undefined;
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function boot(rows: Array<{ id: string; leg: Leg }>) {
  const flow = flowFor(rows);
  const state = createFlowState({
    flows: { [flow.id]: flow },
    stores: { default: { primary: inMemoryStores() } },
    durable: true,
    modelResolver: createMockModelResolver({}),
  });
  const runtime: FlowStateRuntime = await state.getRuntime();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "start",
    input: {},
    userId: USER_ID,
    sessionId: "s_board",
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
  });
  expect(result.error).toBeUndefined();
  return runtime;
}

describe("today's claim gate · what it can see when it settles", () => {
  it("G1 · settles the row before the request's background work ends", async () => {
    const runtime = await boot([{ id: "t-bg", leg: "background" }]);
    await until(async () => (await row(runtime.stores, "t-bg"))?.status === "completed", "t-bg settled");
    const settled = (await row(runtime.stores, "t-bg"))!;
    await until(async () => backgroundDoneAt.has("t-bg") || backgroundDoneAt.has("unknown"), "background done");
    const doneAt = backgroundDoneAt.get("t-bg") ?? backgroundDoneAt.get("unknown")!;
    // The ending was written while the side chain was still sleeping.
    expect(settled.completedAt).toBeLessThan(doneAt);
    console.log(`G1 completedAt=${settled.completedAt} backgroundDoneAt=${doneAt} gap=${doneAt - settled.completedAt!}ms`);
  });

  it("G2 · settles the row while a task it filed is still open", async () => {
    const runtime = await boot([{ id: "t-files", leg: "files" }]);
    await until(async () => (await row(runtime.stores, "t-files"))?.status === "completed", "t-files settled");
    const child = await row(runtime.stores, "t-files-child");
    expect(child?.status).toBe("pending");
    console.log(`G2 parent=completed child=${child?.status}`);
  });

  it("G3 · a person's stop and a wait leave the same row, with nothing telling them apart", async () => {
    const runtime = await boot([
      { id: "t-person", leg: "person" },
      { id: "t-wait", leg: "wait" },
    ]);
    // Give both children time to reach their suspension.
    await new Promise((resolve) => setTimeout(resolve, 600));
    const person = (await row(runtime.stores, "t-person"))!;
    const wait = (await row(runtime.stores, "t-wait"))!;
    expect(person.status).toBe("in_progress");
    expect(wait.status).toBe("in_progress");
    const shape = (t: Task) => Object.keys(t).filter((k) => !["id", "goal", "input", "createdAt", "updatedAt", "leaseUntil", "incarnationId", "runLink", "claimedAt"].includes(k)).sort();
    expect(shape(person)).toEqual(shape(wait));
    console.log(`G3 person=${person.status} wait=${wait.status} same-fields=${JSON.stringify(shape(person))}`);
  });

  it("G4 · refuses a request working a task any wait on another task", async () => {
    const runtime = await boot([{ id: "t-waits", leg: "waits" }]);
    await until(async () => (await row(runtime.stores, "t-waits"))?.status === "completed", "t-waits settled");
    const output = (await row(runtime.stores, "t-waits"))!.output;
    expect(output).toEqual({ ok: false, refused: "wait_unavailable" });
    console.log(`G4 ${JSON.stringify(output)}`);
  });
});

/**
 * A dependent cancelled by its dependency's failure is heard by its filer
 * exactly once, even when the request that wrote the failure never saw the
 * dependent (FIX-2136).
 *
 * The failure is written by a request that read the board before the
 * dependent was filed, as a worker's run in its own task session does when
 * its filer files the dependent mid-run. That request's cascade can't cancel
 * a row it never read, so the failure's notice leaves its sender naming no
 * dependent, and a cascaded cancel owes no notice of its own (FIX-2080 D2).
 * The filer must still hear of the cancel once: the notice it acts on names
 * the dependent, and the dependent sends nothing of its own, however many
 * touches of the board follow.
 *
 * Each runs on the in-memory stores and on SQLite.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction, type StoreAdapter } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";
import { taskSettledEntry, type TaskSettledInput } from "../../src";
import { defineTaskCollection, getOrCreateTaskCollection, resolveResourceCollection, type Task, type TaskCollectionRef } from "../../src/tasks";
import { withCascadeNamed } from "../../src/tasks/notice/task-settled-entry";

const USER = "u_filer";
/** The session that files both tasks: the one that must hear the failure. */
const FILER = "s_filer";
/** The session the research runs in, as a worker's task session does. */
const WORKER = "s_worker";
const BOARD = "work";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const STORES: ReadonlyArray<readonly [string, () => Promise<StoreAdapter>]> = [
  ["in-memory", async () => inMemoryStores()],
  [
    "sqlite",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fsd-cascade-unseen-"));
      dirs.push(dir);
      return sqliteStores({ filename: join(dir, "store.db") });
    }
  ]
];

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) throw new Error("the board is not declared");
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

/**
 * The flow. `file` files a task; `failClaimed` is the worker's run: it reads
 * the board and claims the research, then waits on `gate` before failing it,
 * so a dependent filed meanwhile is one its view never held; `touch` is
 * another request's touch of the board.
 */
function cascadeFlow(heard: TaskSettledInput[], gate: { wait: Promise<void>; claimed: () => void }): FlowInstance {
  const file = handler({
    name: "file",
    inputSchema: z.object({ goal: z.string(), deps: z.array(z.string()).optional() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const board = await boardOf(ctx as unknown as BlockContext);
      const task = await board.createTask({
        goal: input.goal,
        assignee: "researcher",
        maxAttempts: 1,
        ...(input.deps !== undefined ? { deps: input.deps } : {})
      });
      return task.id;
    }
  });
  const failClaimed = handler({
    name: "fail-claimed",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      const board = await boardOf(ctx as unknown as BlockContext);
      const claimed = await board.claim("researcher-worker");
      if (claimed === null) throw new Error("nothing to claim");
      gate.claimed();
      await gate.wait;
      await board.fail(claimed.id, "the research service is down");
      return claimed.id;
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => (await boardOf(ctx as unknown as BlockContext)).payOwedCascades?.()
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) =>
      (await boardOf(ctx as unknown as BlockContext)).list().map((t) => ({ id: t.id, status: t.status, causedBy: t.causedBy }))
  });
  return defineFlow({
    kind: "cascade-board",
    // User-scoped, so the worker's session reaches the rows its filer's session files.
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "user", delivery: {} }) },
    actions: {
      file: { block: file },
      failClaimed: { block: failClaimed },
      touch: { block: touch },
      list: { block: list }
    },
    internal: {
      actions: {
        onTaskSettled: taskSettledEntry({
          block: handler({
            name: "record-heard",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async (notice: TaskSettledInput) => {
              heard.push(notice);
              return {};
            }
          })
        })
      }
    }
  })({ id: "cascade-board" });
}

describe("a touch that fails part way", () => {
  it("still names the dependent it cancelled before failing, read off the board, not the notice as sent", async () => {
    const filer = { sessionId: FILER };
    const research = { id: "t_research", status: "errored", filer } as unknown as Task;
    const rows: Task[] = [
      research,
      { id: "t_post", status: "pending", deps: [research.id], filer } as unknown as Task
    ];
    const ref = {
      partition: undefined,
      list: () => rows,
      // Cancels the dependent, then the rest of the touch fails.
      payOwedCascades: async () => {
        rows[1] = { ...rows[1]!, status: "cancelled", causedBy: research.id };
        throw new Error("store unavailable");
      }
    } as unknown as TaskCollectionRef;
    const sent: TaskSettledInput = { boardId: BOARD, taskId: research.id, attempt: 1, ending: "errored", error: "down", cancelled: ["t_stale"] };
    const notice = await withCascadeNamed({ ref, delivery: {} }, research, sent);
    expect(notice.cancelled).toEqual(["t_post"]);
  });
});

describe.each(STORES)("a failure-cascaded dependent is heard once by its filer (%s)", { timeout: 30_000 }, (_name, stores) => {
  it("when the request that wrote the failure never saw the dependent", async () => {
    const heard: TaskSettledInput[] = [];
    let release!: () => void;
    let claimed!: () => void;
    const claimedYet = new Promise<void>((resolve) => (claimed = resolve));
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)), claimed: () => claimed() };
    const flow = cascadeFlow(heard, gate);
    const state = createFlowState({ flows: { "cascade-board": flow }, stores: { default: { primary: await stores() } }, durable: true });
    await state.getRouter();
    const runtime = await state.getRuntime();
    const act = async (actionName: string, sessionId: string, input: unknown = {}) => {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName,
        input,
        userId: USER,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      });
      if (result.error !== undefined) throw new Error(`${actionName} failed: ${JSON.stringify(result.error)}`);
      return result.output;
    };
    try {
      const research = (await act("file", FILER, { goal: "find the key fact" })) as string;
      // The worker's run reads the board and claims the research...
      const failing = act("failClaimed", WORKER);
      await claimedYet;
      // ...then its filer files the dependent, which that run's view never holds.
      const dependent = (await act("file", FILER, { goal: "write the post", deps: [research] })) as string;
      release();
      await failing;

      // Past the notice's due time and the cascade's, with another request's touch between.
      await new Promise((r) => setTimeout(r, 2_500));
      await act("touch", WORKER);
      await new Promise((r) => setTimeout(r, 2_500));

      const rows = (await act("list", FILER)) as Array<{ id: string; status: string; causedBy?: string }>;
      expect(rows.find((row) => row.id === dependent)).toMatchObject({ status: "cancelled", causedBy: research });
      // Heard once: the failure's notice names the dependent, and the dependent sends none of its own.
      expect(heard.filter((notice) => notice.taskId === research)).toEqual([
        expect.objectContaining({ ending: "errored", cancelled: [dependent] })
      ]);
      expect(heard.filter((notice) => notice.taskId === dependent)).toEqual([]);
    } finally {
      release();
      await state.dispose();
    }
  });
});

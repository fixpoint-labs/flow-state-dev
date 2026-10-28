/**
 * A filing's dependency check reads each dependency as stored now, not as
 * the filing request first read the board (FIX-2114): a dependency that
 * failed in another request while this one ran is refused `dependency_ended`,
 * as one that failed before it is, and nothing is stored.
 *
 * Without this the filing is accepted and a cascade cancels it moments later.
 * The failure's notice went out before the dependent existed, so it can't
 * name it, and the dependent's cancel, caused by a row its filer filed too,
 * owes no notice of its own: its filer never hears of it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  TaskFilingRefusedError,
  type TaskCollectionRef
} from "../../src/tasks";
import { heard } from "../fixtures/heard";

const USER = "u_filer";
const SESSION = "s_filer";
const BOARD = "deps";

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, BOARD)!;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

/**
 * `fileAfter` reads the board, lets `meanwhile` run as another request, then
 * files a row depending on `dep`: alone (`createTask`), or in a batch (`createTasks`).
 */
function depsFlow(meanwhile: { run?: () => Promise<unknown> }): FlowInstance {
  return defineFlow({
    kind: "deps-board",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session", delivery: {} }) },
    actions: {
      file: {
        block: handler({
          name: "file",
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.any(),
          execute: async (input, ctx) => (await (await boardOf(ctx as never)).createTask({ id: input.id, goal: input.id, assignee: "w" })).id
        })
      },
      fail: {
        block: handler({
          name: "fail",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.any(),
          execute: async (_input, ctx) => {
            const board = await boardOf(ctx as never);
            const claimed = await board.claim("w-worker");
            await board.fail(claimed!.id, "the source was unreachable");
            return board.get(claimed!.id)?.status;
          }
        })
      },
      fileAfter: {
        block: handler({
          name: "file-after",
          inputSchema: z.object({ dep: z.string(), batch: z.boolean().optional() }),
          outputSchema: z.any(),
          execute: async (input, ctx) => {
            const board = await boardOf(ctx as never);
            // This request's view of the board: the dependency still pending.
            const before = board.get(input.dep)?.status;
            await meanwhile.run?.();
            try {
              const dependent = { id: "dependent", goal: "dependent", assignee: "w", deps: [input.dep] };
              if (input.batch === true) await board.createTasks([{ id: "sibling", goal: "sibling", assignee: "w" }, dependent]);
              else await board.createTask(dependent);
              return { before, filed: true };
            } catch (error) {
              if (!(error instanceof TaskFilingRefusedError)) throw error;
              return { before, filed: false, rule: error.rule };
            }
          }
        })
      },
      list: {
        block: handler({
          name: "list",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.any(),
          execute: async (_input, ctx) => (await boardOf(ctx as never)).list().map((t) => ({ id: t.id, status: t.status }))
        })
      }
    },
    internal: { actions: { ...heard } }
  })({ id: "deps-board" });
}

describe("a filing reads its dependencies as stored now", () => {
  it.each([
    ["one filing (createTask)", false],
    ["a batch (createTasks)", true]
  ])("refuses a dependency that failed in another request while %s ran, and stores nothing", async (_how, batch) => {
    const meanwhile: { run?: () => Promise<unknown> } = {};
    const flow = depsFlow(meanwhile);
    const state = createFlowState({ flows: { [flow.id]: flow }, stores: { default: { primary: inMemoryStores() } } } as never);
    const act = async (actionName: string, input: unknown = {}) => {
      const runtime = await state.getRuntime();
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName,
        input,
        userId: USER,
        sessionId: SESSION,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      });
      if (result.error !== undefined) throw new Error(`${actionName} failed: ${JSON.stringify(result.error)}`);
      return result.output;
    };
    try {
      await act("file", { id: "research" });
      meanwhile.run = () => act("fail");
      const answer = await act("fileAfter", { dep: "research", batch });
      expect(answer).toEqual({ before: "pending", filed: false, rule: "dependency_ended" });
      expect(await act("list")).toEqual([{ id: "research", status: "errored" }]);
    } finally {
      await state.dispose();
    }
  });
});

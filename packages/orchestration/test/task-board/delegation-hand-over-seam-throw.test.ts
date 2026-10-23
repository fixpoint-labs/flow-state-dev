/**
 * A seam throw past the release is not a plan failure here: the drain waits
 * on no row, so it ends, and the row keeps its lease. The fault is the child
 * session's birth, after the release.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { defineTaskCollection, type Task, type TaskDispatcher, type TaskWorkerInput } from "../../src/tasks";
import { MIN_LEASE_DURATION_MS } from "../../src/tasks/collection/internal";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import { heard } from "../fixtures/heard";

const USER_ID = "u_delegation_throw";
const SESSION = "filer";
/** Claims under the shortest lease, so its lapse is observable on the wall clock: the board has no lease knob. */
const shortLease: TaskDispatcher = {
  async claim(collection, workerId) {
    return collection.claim(workerId, { leaseDurationMs: MIN_LEASE_DURATION_MS });
  }
};

const LEDGER = Object.assign(defineTaskCollection({ id: "delegation-throw", scope: "user" }), { id: "delegation-throw" });

describe("a delegation board whose seam throws once the claim is released", () => {
  it("ends its drain, leaves the row on its lease, and a later drain runs it once the lease lapses", async () => {
    const ran: string[] = [];
    const worker = handler({
      name: "delegation-throw-work",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.string(),
      execute: (input: TaskWorkerInput, ctx) => {
        ran.push(ctx.session.identity.id);
        return `${input.goal} done`;
      }
    });
    const board = taskBoard({
      name: "delegation-throw-board",
      boardId: LEDGER.id,
      mode: "delegation",
      collection: LEDGER,
      dispatcher: shortLease,
      workers: { work: dispatcher<TaskWorkerInput>({ name: "delegation-throw-dispatch", action: "work", session: "per-task" }) },
      initialTasks: [{ id: "t1", goal: "Review", assignee: "work", input: {} }]
    });
    const flow = defineFlow({
      kind: "delegation-throw",
      actions: { start: { block: board.drain } },
      internal: { actions: { ...heard } },
      task: { actions: { work: { block: worker } } }
    })({ id: "delegation-throw" });
    const state = createFlowState({
      flows: { [flow.id]: flow },
      stores: { default: { primary: inMemoryStores() } },
      durable: true
    });
    try {
      const runtime = await state.getRuntime();
      // The first child session's birth fails: the seam throws past the release.
      let failBirth = true;
      const sessions = runtime.stores.session;
      const set = sessions.set.bind(sessions);
      sessions.set = (async (...args: Parameters<typeof set>) => {
        const record = args[1] as { parentSessionId?: string } | undefined;
        if (failBirth && record?.parentSessionId === SESSION) {
          failBirth = false;
          throw new Error("the session store is unavailable");
        }
        return set(...args);
      }) as typeof sessions.set;
      const drain = () =>
        Promise.race([
          runAction({
            orgId: DEFAULT_ORG_ID,
            flow,
            actionName: "start",
            input: {},
            userId: USER_ID,
            sessionId: SESSION,
            stores: runtime.stores,
            runtimeConfig: runtime.runtimeConfig
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the drain never ended")), 8_000))
        ]);
      const rowNow = async () =>
        (await runtime.stores.resourceState.get("user", `${USER_ID}:~org:${DEFAULT_ORG_ID}`, `${LEDGER.id}/t1`))
          ?.state as Task | undefined;

      const first = await drain();
      expect(failBirth).toBe(false);
      expect(first.error).toBeUndefined();
      expect(await rowNow()).toMatchObject({ status: "in_progress" });
      expect(ran).toEqual([]);

      await new Promise((resolve) => setTimeout(resolve, MIN_LEASE_DURATION_MS + 200));
      const second = await drain();
      expect(second.error).toBeUndefined();
      for (let i = 0; i < 200 && (await rowNow())?.status !== "completed"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await rowNow()).toMatchObject({ status: "completed", output: "Review done" });
      expect(ran).toHaveLength(1);
      expect(ran[0]).not.toBe(SESSION);
    } finally {
      await state.dispose();
    }
  }, 20_000);
});

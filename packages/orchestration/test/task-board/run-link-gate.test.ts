/**
 * The claim gate writes the run link, and what happens when that write does
 * not go cleanly (FIX-1668 D1, BR-1, BR-5, BR-6, BR-13).
 *
 * The gate runs here as a real action root under `runAction`, so its context
 * carries a real session and request — the ids the link must name. Its
 * collection is injected, which is the only way to put a store failure at the
 * exact moment of the link write:
 *
 * - **declined** — the claim moved between the gate's read and its write. The
 *   attempt stops as a stale claim and the worker never runs.
 * - **throws before commit** — the store is down. The attempt stops before the
 *   worker, and the row is NOT settled errored: the ticket was not yet on
 *   state, so the rescue's recorder has nothing to settle, and the board's
 *   lapse path hands the row out again.
 * - **commits, then throws** — the change item cannot be published after the
 *   write landed. The attempt stops, the link stays naming this run (whose
 *   request reads failed), and the next claim clears it.
 * - **fails after the claim is on state** — the rescue finds the ticket and
 *   settles the attempt as a gate failure. The row goes back for retry still
 *   naming this run, and the retry's claim clears it.
 *
 * The end-to-end hand-off (real drain, real child sessions, every seat policy)
 * is `integration-tests/src/scenarios/task-board-run-link.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { ActionCore } from "@flow-state-dev/core/types";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { createTaskGate, taskWorkerInputSchema } from "../../src/task-board";
import {
  createResourceBackedTaskCollection,
  type TaskChangeEvent,
  type TaskCollectionRef,
  type TaskWorkerInput,
} from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

const USER_ID = "u_run_link_gate";
const BOARD_ID = "run-link-board";
const LEDGER = "run-link-ledger";
const SEAT = "coder";

type Fault = "none" | "decline" | "throw" | "commit-then-throw" | "state-write-throws";

/**
 * One ledger shared by every collection built over it — the parent's claim and
 * the gate's read see the same rows, as they do on a durable board.
 */
async function harness(fault: Fault) {
  const store = createFakeResourceCollection();
  let clock = 1000;
  const events: TaskChangeEvent[] = [];
  const ran: string[] = [];
  let stateFaultFired = false;

  const ledger = (onChange?: (event: TaskChangeEvent) => void) =>
    createResourceBackedTaskCollection({
      collectionId: LEDGER,
      collection: store,
      now: () => clock,
      onChange,
      claimIdentity: { sessionId: "s_parent", requestId: "req_parent" },
    });

  // The parent's side: one row, claimed, as a drain leaves it before hand-off.
  const parent = await ledger();
  // Two attempts, so a gate failure the rescue settles goes back for retry
  // rather than ending the row.
  await parent.addTask({ id: "t1", goal: "do it", assignee: SEAT, input: {}, maxAttempts: 2 });
  const claimed = (await parent.claim("drain", { leaseDurationMs: 10_000 }))!;

  const inject = (inner: TaskCollectionRef): TaskCollectionRef => {
    if (fault !== "decline" && fault !== "throw") return inner;
    return {
      ...inner,
      linkRun: async (id, run, options) => {
        if (fault === "throw") throw new Error("ledger store unavailable");
        // A reclaim lands between the gate's read and its write.
        clock += 10_001;
        await (await ledger()).claim("rival", { leaseDurationMs: 10_000 });
        return inner.linkRun(id, run, options);
      },
    };
  };

  const worker = handler({
    name: "run-link-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { ok: true };
    },
  });

  const gate = createTaskGate({
    name: BOARD_ID,
    boardId: BOARD_ID,
    // "fail", so a gate that stops the attempt fails the run's request and
    // the result says why. Under "skip" the same stop completes the request
    // with the error as its output; the row is handled identically.
    onError: "fail",
    collection: async (ctx) => {
      // The gate fails once the claim-state write has landed: the rescue finds
      // the ticket on state, a case the link write's position does not cover.
      // `ctx.sequencer` is rebuilt on every read, so the fault rides the gate's
      // next statement, the task-scope mark, which runs only after that write
      // resolves. To the rescue the two are the same failure.
      if (fault === "state-write-throws" && ctx !== undefined && !stateFaultFired) {
        ctx._markTaskScope = () => {
          stateFaultFired = true;
          throw new Error("claim state could not be saved");
        };
      }
      return inject(
        await ledger((event) => {
          events.push(event);
          if (fault === "commit-then-throw" && event.kind === "run_linked") {
            throw new Error("change item could not be published");
          }
        })
      );
    },
  });
  const entry = gate({ block: worker } as unknown as ActionCore, "implement");
  const flow = defineFlow({ kind: "run-link-gate", actions: { implement: entry } } as never)({
    id: "run-link-gate",
  });

  const stores = createInMemoryStores();
  const run = () =>
    runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "implement",
      input: {
        boardId: BOARD_ID,
        seat: SEAT,
        taskId: "t1",
        attempt: claimed.attempts,
        createdAt: claimed.createdAt,
        incarnationId: claimed.incarnationId,
        payload: { taskId: "t1", goal: "do it", attempts: claimed.attempts, input: {} },
      },
      userId: USER_ID,
      sessionId: "s_run",
      stores,
      runtimeConfig: { modelResolver: createMockModelResolver({}) },
    });

  return {
    run,
    ran,
    events,
    stores,
    row: async () => (await ledger()).get("t1"),
    advance: (ms: number) => {
      clock += ms;
    },
    reclaim: async () => (await ledger()).claim("drain", { leaseDurationMs: 10_000 }),
  };
}

describe("the claim gate writes the run link", () => {
  it("names this run's session, request and attempt before the worker runs", async () => {
    const h = await harness("none");

    const result = await h.run();

    expect(result.error).toBeUndefined();
    expect(h.ran).toEqual(["t1"]);
    const row = await h.row();
    // From the run's own context — not the claiming parent's coordinate,
    // which the row also carries and which must not leak into the link.
    expect(row?.run).toEqual({ sessionId: "s_run", requestId: result.requestId, attempt: 1 });
    expect(h.events[0]?.task.claimedBy?.sessionId).toBe("s_parent");
    // Written before the worker, so the settlement comes after it.
    const kinds = h.events.map((e) => e.kind);
    expect(kinds).toEqual(["run_linked", "completed"]);
    // A settled task keeps naming the run that worked it.
    expect(row?.status).toBe("completed");
  });

  it("stops as a stale claim when the link write is declined, and the worker never runs", async () => {
    const h = await harness("decline");

    const result = await h.run();

    // The gate's stale-claim stop, named for the link.
    expect(String((result.error as Error).message)).toMatch(
      /task dispatch for "t1" is stale: the run link was refused \(lost-claim\)/
    );
    expect(h.ran).toEqual([]);
    // The rival's claim holds the row, with no link from this run on it.
    const row = await h.row();
    expect(row?.attempts).toBe(2);
    expect(row?.run).toBeUndefined();
  });

  it("stops before the worker when the link write throws, without settling the row errored", async () => {
    const h = await harness("throw");

    const result = await h.run();

    expect(String((result.error as Error | undefined)?.message)).toMatch(/ledger store unavailable/);
    expect(h.ran).toEqual([]);
    // The ticket was not yet on state, so the rescue's recorder had nothing to
    // settle: the row stays claimed for the board's lapse path.
    const row = await h.row();
    expect(row?.status).toBe("in_progress");
    expect(row?.error).toBeUndefined();
    expect(row?.run).toBeUndefined();
  });

  it("keeps a committed link when the gate fails after it, until the next claim clears it", async () => {
    const h = await harness("commit-then-throw");

    const result = await h.run();

    expect(String((result.error as Error | undefined)?.message)).toMatch(
      /change item could not be published/
    );
    expect(h.ran).toEqual([]);
    // The link is true: it names the run the attempt entered, and that run's
    // request reads failed, which is where a reader would look to see why.
    const row = await h.row();
    expect(row?.run).toEqual({ sessionId: "s_run", requestId: result.requestId, attempt: 1 });
    expect(row?.status).toBe("in_progress");
    const request = await h.stores.request.get(result.requestId!);
    expect(request?.status).toBe("failed");

    // The board's lapse path recovers the row; that claim clears the link.
    h.advance(10_001);
    const recovered = await h.reclaim();
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.run).toBeUndefined();
  });

  it("keeps the link when the claim-state write fails after it, and the next claim clears it", async () => {
    const h = await harness("state-write-throws");

    const result = await h.run();

    expect(String((result.error as Error | undefined)?.message)).toMatch(
      /claim state could not be saved/
    );
    expect(h.ran).toEqual([]);
    // The ticket reached state, so the rescue settled the attempt as the gate
    // failure it is. With an attempt left the row goes back for retry, and the
    // link still names the run that attempt entered.
    const row = await h.row();
    expect(row?.status).toBe("pending");
    expect(row?.feedback).toMatch(/claim state could not be saved/);
    expect(row?.run).toEqual({ sessionId: "s_run", requestId: result.requestId, attempt: 1 });
    const request = await h.stores.request.get(result.requestId!);
    expect(request?.status).toBe("failed");

    // The retry's claim clears it.
    const recovered = await h.reclaim();
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.run).toBeUndefined();
  });
});

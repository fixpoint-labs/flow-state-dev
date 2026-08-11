/**
 * FIX-982 — the launching request must return while its detached work runs.
 *
 * A board that declares a worker `dispatch: { mode: "detached" }` runs it in a
 * Workstream (a child session) instead of inline. Everything about that
 * hand-off already worked: the drain claims the row, spawns the child, clears
 * its own claim, and the row stays `in_progress` for the Workstream to settle.
 * What did not work was the *exit question*. `boardQuiescence` counted that
 * `in_progress` row as work still in flight, so the drain looped back to
 * `claimTask`, found nothing claimable, and parked in `idleWait` until the
 * child settled — which is the launching request waiting on the background
 * work it just detached, i.e. the entire feature undone.
 *
 * ## Why this scenario and not a unit test
 *
 * The classifier is unit-tested in `orchestration`'s `quiescence.test.ts`, and
 * those tests fail without the fix. What they cannot show is the claim this
 * issue is actually about: that the **request completes**. That is a property
 * of full `runAction` composition — the drain's loop, its `idleWait`, the
 * spawn's state clear, and the recorder that declines to settle a row it no
 * longer holds all have to line up for the request to return with the row
 * still open. Every unit test on this branch passed while the request hung.
 *
 * ## Why `runAction` directly rather than `testFlow`
 *
 * `startDetached` refuses `no-start-operation` unless the host wired one, and
 * `testFlow` exposes no `runtimeConfig.requestHost`. Driving `runAction` is
 * what lets the start operation be a **recorder** — it captures the dispatch
 * envelope and returns, starting nothing. So the child is not merely slow here,
 * it has not begun, which is the strongest form of "the parent returned first":
 * no timing assumption, no race, and the assertion cannot pass by the child
 * happening to finish early.
 *
 * The second run then replays that captured envelope through the workstream
 * source, which is how the row gets settled — proving the hand-off left real,
 * runnable work behind rather than an orphaned row.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  type Task,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

/**
 * The transport provenance a detached dispatch carries. `resolveActionCore`
 * treats it as terminal — it resolves the flow's one workstream core and never
 * falls through to `flow.actions` — which is what makes the replay below enter
 * the same path the real host would.
 *
 * Spelled literally because the constant is internal to `engine`. It is a wire
 * value, so pinning it here is the point rather than a shortcut.
 */
const WORKSTREAM_SOURCE = "workstream";

const USER_ID = "u_handoff";

/**
 * No block here calls a model, but `createExecutionContext` still builds a
 * resolver — and it throws when the ambient `FSDEV_DEFAULT_MODEL` has no
 * declared intent to apply to. A mock resolver keeps that env-dependent failure
 * out of a scenario that is about the drain's exit question.
 */
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

/** What a detached start was asked to do. Recorded, never executed. */
type RecordedDispatch = {
  sessionId: string;
  actionName: string;
  input: unknown;
};

/**
 * Build the flow under test.
 *
 * `mode` is the only difference between the subject and its control, so an
 * assertion that fires for one and not the other is attributable to detachment
 * and to nothing else about the board.
 */
function buildFlow(options: { kind: string; mode: "inline" | "detached" }) {
  const ran: string[] = [];

  const background = handler({
    name: "background-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    execute: (input: TaskWorkerInput) => {
      ran.push(input.taskId);
      return { handled: input.taskId };
    },
  });

  const board = taskBoard({
    name: `${options.kind}-board`,
    boardId: `${options.kind}-board`,
    // Durable and user-scoped. A detached board must be durable (its rows
    // outlive the claiming request), and user scope is what makes the same
    // ledger reachable from inside the Workstream — a session-scoped one is
    // not, by construction.
    collection: defineTaskCollection({ id: `${options.kind}-ledger`, scope: "user" }),
    workers: {
      background: { worker: background, dispatch: { mode: options.mode } },
    },
    initialTasks: [
      {
        id: "t1",
        goal: "do the background thing",
        assignee: "background",
        // `input` is set deliberately, and a detached board currently REQUIRES
        // it: `packWorkerInput` copies `input: task.input` unconditionally (it
        // spreads `title` and `context` conditionally, but not this), so a task
        // created without one packs `input: undefined` and the spawn's
        // JSON-safety gate rejects the payload by name. Left as-is here so this
        // scenario tests the drain's exit question rather than that gate; the
        // packing bug is tracked separately.
        input: { note: "background" },
      },
    ],
  });

  const flow = defineFlow({
    kind: options.kind,
    actions: { start: { block: board.drain } },
  })({ id: options.kind });

  return { flow, ran };
}

/**
 * The durable row, read straight from the store rather than through any
 * participating execution's collection ref.
 *
 * That matters more here than usual: the whole question is what the row looks
 * like *after* the parent returned, and a returned execution's in-memory mirror
 * is a snapshot of what it believed, not of what the Workstream will read.
 */
async function durableRow(
  stores: StoreRegistry,
  kind: string,
  taskId: string
): Promise<Task | undefined> {
  const row = await stores.resourceState.get(
    "user",
    USER_ID,
    `${kind}-ledger/${taskId}`
  );
  return row?.state as Task | undefined;
}

/**
 * Rewrite one durable row's fields in place, the way something outside this
 * board would have.
 *
 * The ABA case below needs a row no API on the board can produce on demand: a
 * different incarnation of the same task id, at the same attempt, wearing the
 * same creation stamp. Reaching the store directly is what makes it
 * deterministic — the alternative is deleting and recreating in a loop and
 * hoping the millisecond clock collides, which is the very unreliability the
 * gate's nonce exists to remove.
 *
 * Safe only BETWEEN runs. A running request holds its own hydrated view of the
 * resource, so a write that goes around it is neither seen nor preserved.
 */
async function rewriteRow(
  stores: StoreRegistry,
  kind: string,
  taskId: string,
  patch: Partial<Task>
): Promise<void> {
  const key = `${kind}-ledger/${taskId}`;
  const current = await stores.resourceState.get("user", USER_ID, key);
  await stores.resourceState.set(
    "user",
    USER_ID,
    key,
    { ...(current!.state as object), ...patch } as never,
    "any"
  );
}

describe("a detached board's launching request returns while the work is outstanding", () => {
  it("completes the parent with the row still in progress, then settles it in the Workstream", async () => {
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow({ kind: "handoff-detached", mode: "detached" });

    const dispatched: RecordedDispatch[] = [];

    const parent = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores,
      runtimeConfig: {
        ...baseRuntimeConfig(),
        requestHost: {
          // Records and returns. Nothing is started, so the child cannot
          // possibly have finished — if the parent returns, it returned first.
          startOperation: async (spec) => {
            dispatched.push({
              sessionId: spec.sessionId,
              actionName: spec.actionName,
              input: spec.input,
            });
            return { requestId: `child_req_${dispatched.length}` };
          },
        },
      },
    });

    // THE ASSERTION THIS FILE EXISTS FOR. Before the fix this call did not
    // reach here until the row was settled; with nothing settling it, the
    // drain parked in `idleWait` until its timeout.
    expect(parent.error).toBeUndefined();

    // ...and it returned with the work genuinely outstanding, not finished.
    expect(dispatched).toHaveLength(1);
    expect(ran).toEqual([]);
    const afterParent = await durableRow(stores, "handoff-detached", "t1");
    expect(afterParent?.status).toBe("in_progress");

    // Pins WHY the drain cannot recognise a hand-off from `claimedBy`, because
    // that is the reading the field's name invites and it does not work.
    // `claimedBy` is written only by `applyClaimToTask`, inside `claim()`, and
    // the Workstream never claims — its start gate re-mints a ticket from the
    // row. So a handed-off row still carries the session of the parent that
    // claimed it, and "differs from the drain's own session" is false by
    // construction. Anyone tempted to replace `runsElsewhere` with that
    // comparison should fail here first.
    expect(afterParent?.claimedBy?.sessionId).toBe("s_parent");

    // The hand-off left runnable work behind. Replaying the captured envelope
    // through the workstream source is what the real host would have done.
    const child = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as "start",
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: WORKSTREAM_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    expect(child.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);
    const afterChild = await durableRow(stores, "handoff-detached", "t1");
    expect(afterChild?.status).toBe("completed");
  });

  it("refuses a stale child whose row was recreated inside the same millisecond", async () => {
    // The start gate asks whether the row it is about to work on is still the
    // one this dispatch was addressed to. `attempts` cannot answer: a
    // delete-and-recreate resets it, and the replacement's first claim puts it
    // straight back where the dispatch left it. `createdAt` cannot answer
    // either — it is a millisecond clock, and a recreate under the same id
    // lands in the same millisecond often enough that the replacement wears the
    // original's stamp.
    //
    // So the row below is reincarnated with `attempts` and `createdAt` held
    // EXACTLY as the dispatch remembers them, and only the incarnation nonce
    // moved. If the gate lets that through, a stale child runs its old payload
    // and settles a row that has nothing to do with it.
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow({ kind: "handoff-aba", mode: "detached" });

    const dispatched: RecordedDispatch[] = [];
    const parent = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores,
      runtimeConfig: {
        ...baseRuntimeConfig(),
        requestHost: {
          startOperation: async (spec) => {
            dispatched.push({
              sessionId: spec.sessionId,
              actionName: spec.actionName,
              input: spec.input,
            });
            return { requestId: "child_req_1" };
          },
        },
      },
    });
    expect(parent.error).toBeUndefined();

    const addressed = await durableRow(stores, "handoff-aba", "t1");
    // The nonce has to be there for this to be a test of anything.
    expect(addressed?.incarnationId).toBeDefined();

    // The replacement: a different row wearing the same name, same attempt and
    // same creation stamp. Everything the gate's other two arms compare is
    // untouched, which is what makes this attributable to the nonce alone.
    await rewriteRow(stores, "handoff-aba", "t1", {
      incarnationId: `${addressed!.incarnationId}-recreated`,
    });
    const replacement = await durableRow(stores, "handoff-aba", "t1");
    expect(replacement?.attempts).toBe(addressed?.attempts);
    expect(replacement?.createdAt).toBe(addressed?.createdAt);

    const child = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as "start",
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: WORKSTREAM_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    // The gate stops before it stamps a claim, so nothing is written against
    // the replacement — not a completion, and not a failure either. A
    // superseded dispatch is a correct outcome, and the successor owns the row.
    expect(child.error).toBeUndefined();
    expect(ran).toEqual([]);
    const afterChild = await durableRow(stores, "handoff-aba", "t1");
    expect(afterChild?.status).toBe("in_progress");
    expect(afterChild?.output).toBeUndefined();
  });

  it("still holds the request open for an inline worker on the same board shape", async () => {
    // The control, and the one that protects every board that exists today.
    // The exclusion is opt-in per declaration: flip `mode` and the identical
    // board must run its worker inside the launching request and return only
    // once the row is settled.
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow({ kind: "handoff-inline", mode: "inline" });

    const parent = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    expect(parent.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);
    const row = await durableRow(stores, "handoff-inline", "t1");
    expect(row?.status).toBe("completed");
  });
});

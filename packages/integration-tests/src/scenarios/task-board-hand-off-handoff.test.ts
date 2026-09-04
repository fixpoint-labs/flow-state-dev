/**
 * FIX-982 — the launching request must return while its handed-off work runs.
 *
 * A board whose seat holds a `dispatcher({ type: "task", session: "per-task" })`
 * runs that seat's rows in a child session instead of inline. Everything about that hand-off already
 * worked: the drain claims the row, dispatches to the child, clears its own
 * claim, and the row stays `in_progress` for the child session to settle.
 * What did not work was the *exit question*. `boardQuiescence` counted that
 * `in_progress` row as work still in flight, so the drain looped back to
 * `claimTask`, found nothing claimable, and parked in `idleWait` until the
 * child settled — which is the launching request waiting on the background
 * work it just handed off, i.e. the entire feature undone.
 *
 * ## Why this scenario and not a unit test
 *
 * The classifier is unit-tested in `orchestration`'s `quiescence.test.ts`, and
 * those tests fail without the fix. What they cannot show is the claim this
 * issue is actually about: that the **request completes**. That is a property
 * of full `runAction` composition — the drain's loop, its `idleWait`, the
 * hand-off's state clear, and the recorder that declines to settle a row it no
 * longer holds all have to line up for the request to return with the row
 * still open. Every unit test on this branch passed while the request hung.
 *
 * ## Why `runAction` directly rather than `testFlow`
 *
 * The dispatch seam refuses `no-dispatch-operation` unless the host wired one,
 * and `testFlow` exposes no `runtimeConfig.requestHost`. Driving `runAction`
 * is what lets the dispatch operation be a **recorder** — it captures the
 * dispatch envelope and returns, starting nothing. So the child is not merely
 * slow here, it has not begun, which is the strongest form of "the parent
 * returned first": no timing assumption, no race, and the assertion cannot
 * pass by the child happening to finish early.
 *
 * The second run then replays that captured envelope through the `task`
 * source, which is how the row gets settled — proving the hand-off left real,
 * runnable work behind rather than an orphaned row.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  disposeFlowApiRouter,
  runAction,
} from "@flow-state-dev/engine";
import type { RequestRecord, StoreRegistry } from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  type Task,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import {
  taskBoard,
  taskWorkerInputSchema,
  TASK_BOARD_META_COMPONENT_TYPE,
  type TaskSessionPolicy,
} from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

/**
 * The transport provenance a hand-off dispatch carries. The engine's entry
 * resolution treats it as terminal — it resolves the flow's `task` entry for
 * the seat and never falls through to `flow.actions` — which is what makes
 * the replay below enter the same path the real host would.
 *
 * Spelled literally because the constant is internal to `engine`. It is a wire
 * value, so pinning it here is the point rather than a shortcut.
 */
const TASK_SOURCE = "task";

const USER_ID = "u_handoff";

/**
 * No block here calls a model, but `createExecutionContext` still builds a
 * resolver — and it throws when the ambient `FSDEV_DEFAULT_MODEL` has no
 * declared intent to apply to. A mock resolver keeps that env-dependent failure
 * out of a scenario that is about the drain's exit question.
 */
const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

/** What a hand-off dispatch was asked to do. Recorded, never executed. */
type RecordedDispatch = {
  sessionId: string;
  actionName: string;
  input: unknown;
};

/**
 * Build the flow under test.
 *
 * `mode` is the only difference between the subject and its control, so an
 * assertion that fires for one and not the other is attributable to the
 * hand-off and to nothing else about the board.
 */
function buildFlow(options: {
  kind: string;
  mode: "inline" | "hand-off";
  /**
   * Topic for the seeded task, when the scenario needs the child session's
   * topic to be something OTHER than the task id.
   *
   * Absent, the default per-task key falls back to the task id, and then
   * `topic` and `taskId` hold the same string — which would let a provenance
   * assertion pass while reading the wrong field.
   */
  taskTopic?: string;
  /**
   * Override the hand-off session policy. Defaults to `"per-task"`, which
   * frames the raw task id and never reads `metadata.topic` — only the
   * provenance scenario below needs a policy that does.
   */
  session?: TaskSessionPolicy<TaskWorkerInput>;
}) {
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
    // Durable and user-scoped. A hand-off board must be durable (its rows
    // outlive the claiming request), and user scope is what makes the same
    // ledger reachable from inside the child session — a session-scoped one
    // is not, by construction.
    collection: defineTaskCollection({ id: `${options.kind}-ledger`, scope: "user" }),
    workers: {
      background:
        options.mode === "hand-off"
          ? dispatcher<TaskWorkerInput>({
              name: `${options.kind}-hand-off`,
              type: "task",
              target: "background",
              session: options.session ?? "per-task",
            })
          : background,
    },
    initialTasks: [
      {
        id: "t1",
        goal: "do the background thing",
        assignee: "background",
        // `input` is set deliberately, and a handed-off board currently
        // REQUIRES it: `packWorkerInput` copies `input: task.input`
        // unconditionally (it spreads `title` and `context` conditionally, but
        // not this), so a task created without one packs `input: undefined`
        // and the hand-off's JSON-safety gate rejects the payload by name.
        // Left as-is here so this scenario tests the drain's exit question
        // rather than that gate; the packing bug is tracked separately.
        input: { note: "background" },
        ...(options.taskTopic === undefined
          ? {}
          : { metadata: { topic: options.taskTopic } }),
      },
    ],
  });

  const flow = defineFlow({
    kind: options.kind,
    actions: { start: { block: board.drain } },
    // A task entry no board hands off to is refused at definition, so the
    // inline shape declares none.
    ...(options.mode === "hand-off" ? { task: { actions: { background: { block: background } } } } : {}),
  })({ id: options.kind });

  return { flow, ran };
}

/**
 * The durable row, read straight from the store rather than through any
 * participating execution's collection ref.
 *
 * That matters more here than usual: the whole question is what the row looks
 * like *after* the parent returned, and a returned execution's in-memory mirror
 * is a snapshot of what it believed, not of what the child session will read.
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

/**
 * The board's own completion item, read off the parent's emitted items.
 *
 * `task-board-meta` is a transient component item, so it never reaches the
 * persisted log — the run's live item list is the only place it exists, which is
 * exactly where a consumer subscribing to the stream would see it.
 */
function boardMeta(items: readonly RuntimeItem[]):
  | { status: string; terminationReason: string; counts: Record<string, number> }
  | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i] as { type?: string; component?: string; data?: unknown };
    if (item.type === "component" && item.component === TASK_BOARD_META_COMPONENT_TYPE) {
      const data = item.data as {
        status?: string;
        terminationReason?: string;
        counts?: Record<string, number>;
      };
      if (data.status !== "completed") continue;
      return {
        status: data.status,
        terminationReason: data.terminationReason ?? "",
        counts: data.counts ?? {},
      };
    }
  }
  return undefined;
}

describe("a hand-off board's launching request returns while the work is outstanding", () => {
  it("completes the parent with the row still in progress, then settles it in the child session", async () => {
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow({ kind: "handoff-hand-off", mode: "hand-off" });

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
          dispatchOperation: async (spec) => {
            dispatched.push({
              sessionId: spec.sessionId,
              actionName: spec.target,
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
    const afterParent = await durableRow(stores, "handoff-hand-off", "t1");
    expect(afterParent?.status).toBe("in_progress");

    // Pins WHY the drain cannot recognise a hand-off from `claimedBy`, because
    // that is the reading the field's name invites and it does not work.
    // `claimedBy` is written only by `applyClaimToTask`, inside `claim()`, and
    // the child session never claims — its start gate re-mints a ticket from
    // the row. So a handed-off row still carries the session of the parent
    // that claimed it, and "differs from the drain's own session" is false by
    // construction. Anyone tempted to replace `runsElsewhere` with that
    // comparison should fail here first.
    expect(afterParent?.claimedBy?.sessionId).toBe("s_parent");

    // WHAT THE PARENT TOLD ITS CONSUMERS. The drain runs its completion meta
    // unconditionally after the fan-out, and that item's structural test is
    // `completed === total` — which a successful hand-off fails, because the row
    // it handed over is still `in_progress`. So every healthy handed-off board
    // announced itself as a terminal failure, permanently: nothing re-emits this
    // item when the child eventually settles.
    //
    // Asserted on the emitted item rather than on the classifier, because the
    // classifier was right the whole time. The defect was in what the outer
    // drain did with its answer, and only a full drain produces that.
    const parentMeta = boardMeta(parent.items);
    expect(parentMeta?.status).toBe("completed");
    expect(parentMeta?.terminationReason).toBe("handed-off");
    // Not `all-completed` either: a consumer reads that as "nothing left to do"
    // and stops watching while a child is still working.
    expect(parentMeta?.counts.in_progress).toBe(1);
    expect(parentMeta?.counts.completed).toBe(0);

    // The hand-off left runnable work behind. Replaying the captured envelope
    // through the `task` source is what the real host would have done.
    const child = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as never,
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    expect(child.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);
    const afterChild = await durableRow(stores, "handoff-hand-off", "t1");
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
    const { flow, ran } = buildFlow({ kind: "handoff-aba", mode: "hand-off" });

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
          dispatchOperation: async (spec) => {
            dispatched.push({
              sessionId: spec.sessionId,
              actionName: spec.target,
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
      actionName: dispatched[0]!.actionName as never,
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: TASK_SOURCE,
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

  it("takes back a lapsed row whose claim identity is intact, and runs it", async () => {
    // Nothing renews a handed-off row's lease between the parent handing it off
    // and the child actually starting, so a child that waits in the host's
    // queue longer than the lease starts on a row the substrate already
    // considers free. The other three gate arms all still pass — same attempt,
    // same creation stamp, same incarnation, still `in_progress` — because no
    // successor has come along and taken it yet.
    //
    // Refusing on the lapse alone is more conservative than that evidence, and
    // it does not merely waste this run: the row goes back to the queue, the
    // next drain spends an attempt re-dispatching it into the same queue, and
    // under a sustained backlog every hand-off lapses before it starts. So the
    // gate asks the substrate rather than the clock — a lease renewal fenced on
    // the claim it was dispatched with — and runs when that write lands.
    //
    // The lapse is written onto the durable row rather than waited out: the
    // board's default lease is two minutes and no board-level knob shortens it,
    // and a row whose `leaseUntil` has passed is exactly what those two minutes
    // would produce. Same technique, and the same reason, as the reincarnation
    // above.
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow({ kind: "handoff-lapsed", mode: "hand-off" });

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
          dispatchOperation: async (spec) => {
            dispatched.push({
              sessionId: spec.sessionId,
              actionName: spec.target,
              input: spec.input,
            });
            return { requestId: "child_req_1" };
          },
        },
      },
    });
    expect(parent.error).toBeUndefined();

    const claimed = await durableRow(stores, "handoff-lapsed", "t1");
    // The claim wrote a lease, or there is nothing here to lapse.
    expect(claimed?.leaseUntil).toBeDefined();

    // The whole claim moves back by its own lease span, so the deadline sits on
    // the instant the claim was committed and has therefore just passed. Both
    // stamps move: `leaseUntil - updatedAt` is the span the claim committed and
    // the takeover renews for it, so a rewrite that moved only the deadline
    // would leave a row with a zero-length lease — something no real claim can
    // produce, since the substrate floors a lease at one second.
    //
    // Both numbers come off the row rather than from a wall-clock read: they
    // were written by the claim on the collection's clock, which is the clock
    // the gate and the fence both compare against.
    const lapsedAt = claimed!.updatedAt;
    const span = claimed!.leaseUntil! - claimed!.updatedAt;
    await rewriteRow(stores, "handoff-lapsed", "t1", {
      updatedAt: lapsedAt - span,
      leaseUntil: lapsedAt,
    });

    const child = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as never,
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    // THE ASSERTION THIS CASE EXISTS FOR: the work the parent handed off ran,
    // in the child it was handed to.
    expect(child.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);

    const afterChild = await durableRow(stores, "handoff-lapsed", "t1");
    // And it SETTLED, which is the half that proves the takeover rather than a
    // gate that merely stopped checking. Every write the child makes is fenced
    // on the lease, so a recorded completion is only reachable through a row
    // this child holds — running the worker without taking the row back would
    // leave exactly the row this case started from, side effects already spent.
    expect(afterChild?.status).toBe("completed");
    expect(afterChild?.output).toEqual({ handled: "t1" });
    // On the SAME attempt. Recovery by re-claim gets the work done too, and
    // spends an attempt and a second dispatch to do it — which is how a queue
    // deeper than the lease can exhaust `maxAttempts` on backlog alone.
    expect(afterChild?.attempts).toBe(1);
  });

  it("refuses a child whose row a second drain had already reclaimed", async () => {
    // The other side of that write, and the one that keeps the takeover honest:
    // a lapsed lease still means the row is the queue's, so a child arriving
    // after a successor has actually taken it must write nothing. The successor
    // here is a real second drain over the same durable ledger — the recovery
    // path the lapse exists to enable — rather than a hand-written row.
    const stores = createInMemoryStores();
    const { flow, ran } = buildFlow({ kind: "handoff-reclaimed", mode: "hand-off" });

    const dispatched: RecordedDispatch[] = [];
    const recorder = {
      dispatchOperation: async (spec: {
        sessionId: string;
        target: string;
        input: unknown;
      }) => {
        dispatched.push({
          sessionId: spec.sessionId,
          actionName: spec.target,
          input: spec.input,
        });
        return { requestId: `child_req_${dispatched.length}` };
      },
    };

    const first = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent",
      stores,
      runtimeConfig: { ...baseRuntimeConfig(), requestHost: recorder as never },
    });
    expect(first.error).toBeUndefined();

    const claimed = await durableRow(stores, "handoff-reclaimed", "t1");
    await rewriteRow(stores, "handoff-reclaimed", "t1", { leaseUntil: claimed!.updatedAt });

    const second = await runAction({
      flow,
      actionName: "start",
      input: {},
      userId: USER_ID,
      sessionId: "s_parent_2",
      stores,
      runtimeConfig: { ...baseRuntimeConfig(), requestHost: recorder as never },
    });
    expect(second.error).toBeUndefined();
    // The row was handed out again, as a fresh attempt, to a second child.
    expect(dispatched).toHaveLength(2);
    const reclaimed = await durableRow(stores, "handoff-reclaimed", "t1");
    expect(reclaimed?.attempts).toBe(2);

    const stale = await runAction({
      flow,
      actionName: dispatched[0]!.actionName as never,
      input: dispatched[0]!.input,
      userId: USER_ID,
      sessionId: dispatched[0]!.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });

    // THE ASSERTION THIS CASE EXISTS FOR: the first child stopped, and left the
    // successor's row alone — no run, no completion, and no failure either.
    expect(stale.error).toBeUndefined();
    expect(ran).toEqual([]);
    const afterStale = await durableRow(stores, "handoff-reclaimed", "t1");
    expect(afterStale?.status).toBe("in_progress");
    expect(afterStale?.output).toBeUndefined();
    expect(afterStale?.attempts).toBe(2);
    // Nothing installed on the way past, either: a refusal that had extended
    // the lease first would hold the row away from the worker that owns it.
    expect(afterStale?.leaseUntil).toBe(reclaimed?.leaseUntil);

    // And the successor's own child runs it — once.
    const successor = await runAction({
      flow,
      actionName: dispatched[1]!.actionName as never,
      input: dispatched[1]!.input,
      userId: USER_ID,
      sessionId: dispatched[1]!.sessionId,
      source: TASK_SOURCE,
      stores,
      runtimeConfig: baseRuntimeConfig(),
    });
    expect(successor.error).toBeUndefined();
    expect(ran).toEqual(["t1"]);
    expect((await durableRow(stores, "handoff-reclaimed", "t1"))?.status).toBe("completed");
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

// ---------------------------------------------------------------------------
// Provenance — what the handed-off REQUEST record says about the task it runs
// ---------------------------------------------------------------------------

/**
 * A consumer that has found a child session (hop 1) and listed its requests
 * (hop 2) can see *that* background work ran, and — through the dispatch
 * address — which body of work it belongs to. What it could not see was
 * **which row** the run was spawned for. The task id lived only on the
 * dispatch input, which is the worker's private envelope: it is not projected
 * onto any read route, so correlating a request back to a board row meant
 * having the board's own ledger open beside it.
 *
 * `metadata.dispatch.taskId` closes that. It is stamped in the same seam call
 * that assembles `metadata.dispatch.type` / `.target` / `.from` / `.key`, from
 * server-derived material only, and it decides nothing — see
 * `DispatchSpec.provenance`.
 */
/**
 * Poll `read` until it returns a value, or fail naming what was being waited
 * for.
 *
 * Needed because the action route acks acceptance (202) and runs the parent in
 * the background, so there is no promise to await for "the spawn has happened".
 * A fixed sleep would either be flaky or slow; this is neither, and a timeout
 * reports the condition rather than a bare `undefined` further down.
 */
async function waitFor<T>(
  read: () => Promise<T | undefined>,
  what: string,
  timeoutMs = 5000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a hand-off request record names the task it was spawned for", () => {
  const KIND = "handoff-provenance";
  /**
   * Deliberately NOT the task id. The per-task session key falls back to the
   * task id when a task declares no topic, and then `topic` and `taskId` hold
   * the same string — an assertion that read one while meaning the other would
   * pass on either. With them distinct, only the right field satisfies it.
   */
  const TASK_TOPIC = "nightly-report";

  /**
   * Driven through the **shipped router**, not `runAction`.
   *
   * The scenarios above deliberately record the dispatch and start nothing,
   * which is what proves the parent returned first. This one needs the opposite
   * property: a real request *record*. `createFlowApiRouter` is the path that
   * supplies one — it wires `createDispatchOperation` onto the request-host
   * seam itself (`http-handlers.ts`), so the envelope is assembled by the
   * shipped writer and lands on a record the shipped store wrote. A
   * hand-rolled dispatch operation here would be the test asserting against
   * its own envelope.
   */
  it("carries the board's task id on metadata.dispatch, beside the dispatch address and key", async () => {
    const stores = createInMemoryStores();
    const { flow } = buildFlow({
      kind: KIND,
      mode: "hand-off",
      taskTopic: TASK_TOPIC,
      // The default per-task key frames the raw taskId and never reads
      // `metadata.topic` (see `buildFlow`) — a custom key is what makes the
      // topic reach the child session at all.
      session: { key: (task) => (task.metadata?.topic as string | undefined) ?? task.taskId },
    });

    const registry = createFlowRegistry();
    registry.register(flow);
    const router = createFlowApiRouter({
      registry,
      stores,
      ...baseRuntimeConfig(),
    });

    try {
      const response = await router.POST(
        new Request(`http://localhost/api/flows/${KIND}/actions/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: USER_ID,
            sessionId: "s_parent",
            input: {},
          }),
        }),
        { params: { path: [KIND, "actions", "start"] } }
      );
      // 202, not 200: the action route acks acceptance and runs the parent in
      // the background. Acceptance is not completion, so the spawn has not
      // necessarily happened yet — hence the wait below rather than a read here.
      expect(response.status).toBe(202);

      // Hop 1 — the parent's child sessions, read the way the listing route
      // reads them. No tenant is bound in this scenario, so a session's
      // storage key and its bare id are the same string; the route's
      // `toBareSessionId` step is a no-op here.
      const child = await waitFor(async () => {
        const children = await stores.session.list({
          parentage: { parentOf: "s_parent" },
        });
        return children.length === 1 ? children[0] : undefined;
      }, "the parent to spawn exactly one child session");

      // The routing label lives on the SESSION the key derived, not on the
      // request's own metadata — `topic` and `taskId` are deliberately
      // distinct (see `TASK_TOPIC` above), so this is the one place a reader
      // sees the topic rather than the row id.
      expect(child.topic).toBe(TASK_TOPIC);

      // Hop 2 — that child session's own runs.
      const handedOff = await waitFor(async () => {
        const requests: RequestRecord[] = await stores.request.list({
          sessionId: child.id,
        });
        return requests.length === 1 ? requests[0] : undefined;
      }, "the child session to have exactly one request record");

      // The discriminator a reader keys on. `source` is set by the seam and is
      // not settable by any caller, which is what makes the `dispatch` bag
      // below server truth rather than something an ordinary request could
      // carry under the same key.
      expect(handedOff.source).toBe("task");

      // THE ASSERTION THIS BLOCK EXISTS FOR. Whole-object equality rather than
      // a property probe, so a future writer that drops `key` or `from` to
      // make room for `taskId` fails here — the DevTool panel and the
      // kitchen-sink demo both read the dispatch address today.
      expect(handedOff.metadata).toEqual({
        dispatch: {
          type: "task",
          target: "background",
          from: { block: expect.any(String), sessionId: "s_parent" },
          key: expect.any(String),
          taskId: "t1",
        },
      });
    } finally {
      await disposeFlowApiRouter(router);
    }
  });
});

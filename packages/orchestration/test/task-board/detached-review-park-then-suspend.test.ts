/**
 * A detached worker that parks its TASK (`collection.awaitReview`) and THEN
 * parks its REQUEST (`ctx.suspend`) cannot be resumed — its own start gate
 * refuses the resumed re-entry, and the row is stranded permanently.
 *
 * The composition looks safe on paper: `awaitReview` moves the row to
 * `awaiting_review`, which the lease deliberately does not govern
 * (`leaseLapsed` is scoped to `in_progress` — see `tasks/collection/internal.ts`),
 * so the row survives an arbitrarily long human pause without being reclaimed.
 * `ctx.suspend()` keeps `recordSuccess` from stomping the row to `completed` on
 * return (`SuspensionError` bypasses `.rescue()`).
 *
 * What breaks it: `buildDetachedRunner`'s pre-worker START GATE is a `.tap()`,
 * and a `.tap()` has no output for FIX-811's replay-by-injection to reuse — so
 * it re-executes in full on every re-entry, including a `continueRequest`
 * resume of ITS OWN suspended dispatch, not just a genuinely fresh dispatch.
 * The gate's identity check requires `row.status === "in_progress"`
 * unconditionally; `awaitReview` already moved it to `awaiting_review`, so the
 * gate throws `StaleDetachedClaimError` before the worker (and therefore
 * `recordSuccess`) is ever reached again. `recordError`'s `fail()` write is
 * itself declined (`awaiting_review → failed` is not a legal transition), so
 * the row is left at `awaiting_review` — silently, since the outer request
 * still resolves as `error: undefined`. See the resumed-write-back test below
 * for the exact error text and the ANTI-GAME test for a real ABA the fence
 * DOES catch, pinning that the harness can produce a genuine decline.
 *
 * The two other combinations a detached worker might reach for both fail too,
 * for different reasons:
 *   - `awaitReview` then RETURN (no suspend): `recordSuccess` still runs after
 *     a normal return and stomps the row straight to `completed` in the same
 *     request — the review park is erased before anyone sees it.
 *   - `ctx.suspend()` alone (no `awaitReview`): the row stays `in_progress`, so
 *     its lease keeps governing it — an ordinary human review pause (minutes)
 *     outlasts the lease and the row is reclaimed and re-run out from under the
 *     parked worker.
 *
 * Net: today, a detached worker has NO shipped way to hold both a review park
 * and its own request across an unbounded human wait.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineCapability, handler } from "@flow-state-dev/core";
import type { TaskClaimTicket, TaskWorkerInput } from "../../src/tasks";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  type TaskCollectionRef,
} from "../../src/tasks";
import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
} from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";

// Internal to `engine`, spelled literally as the FIX-982 integration tests do
// (`task-board-detached-handoff.test.ts`) — a wire value, not a shortcut.
const WORKSTREAM_SOURCE = "workstream";

const USER_ID = "u_settle_lab139";
const RESOURCE_KEY = "settle-lab139-ledger";
const BOARD_NAME = "settle-lab139-board";

const baseRuntimeConfig = () => ({ modelResolver: createMockModelResolver({}) });

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider };
}

/** Resolve the SAME durable ledger the board uses, from inside any block that
 * runs under the board's tree (drain OR detached runner) — both declare the
 * resource statically via `board`'s own `uses`, so any nested block, and any
 * OTHER block that separately lists `ledgerAccessCap`, can read `ctx.resources`. */
async function resolveLedger(ctx: BlockContext): Promise<TaskCollectionRef> {
  const collection = resolveResourceCollection(ctx, RESOURCE_KEY);
  if (collection === undefined) {
    throw new Error(`[settle-poc] resource "${RESOURCE_KEY}" not resolved on ctx.resources`);
  }
  return getOrCreateTaskCollection({
    ctx,
    backing: "resource",
    collectionId: RESOURCE_KEY,
    collection,
  });
}

function buildScenario() {
  const ledger = defineTaskCollection({ id: RESOURCE_KEY, scope: "user" });
  // Declared independently of `board.capability` (which does not exist until
  // `taskBoard()` returns) so both the worker AND the probe action can resolve
  // the same resource without a construction-order cycle.
  const ledgerAccessCap = defineCapability({
    name: "settle-lab139-ledger-access",
    resources: { [RESOURCE_KEY]: ledger },
  });

  const parkThenSuspend = handler({
    name: "park-then-suspend-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ handled: z.string() }),
    uses: [ledgerAccessCap],
    execute: async (input: TaskWorkerInput, ctx) => {
      const tasks = await resolveLedger(ctx);
      // Fenced with the SAME ticket the runner's start gate stamped, exactly
      // as a real task-tool call would present it — so a stale re-attempt
      // (the anti-game test below) is refused here too, not just on the
      // final `complete()`.
      const claim = ctx.sequencer!.state.currentClaim as TaskClaimTicket | undefined;
      const fence = claim !== undefined ? { ifAllowed: true as const, claim } : undefined;
      // THE COMPOSITION: park the TASK first (lease-exempt review park)...
      await tasks.awaitReview(input.taskId, "needs a human to look at this", fence);
      // ...then park the REQUEST (stops recordSuccess from stomping to
      // completed, and stops lease renewal via the board's onSettled hook).
      await ctx.suspend!({
        reason: "human_approval",
        message: "please review before this settles",
      });
      return { handled: input.taskId };
    },
  });

  const board = taskBoard({
    name: BOARD_NAME,
    boardId: BOARD_NAME,
    collection: ledger,
    workers: {
      background: { worker: parkThenSuspend, dispatch: { mode: "detached" } },
    },
    initialTasks: [
      {
        id: "t1",
        goal: "needs a long human pause",
        assignee: "background",
        input: { note: "review-park" },
      },
    ],
  });

  const probe = handler({
    name: "probe",
    inputSchema: z.object({ forceLapseByMs: z.number() }),
    outputSchema: z.object({
      statusBefore: z.string(),
      leaseUntilBefore: z.number().nullable(),
      reclaimedCount: z.number(),
      statusAfter: z.string(),
    }),
    uses: [ledgerAccessCap],
    execute: async (input, ctx) => {
      const tasks = await resolveLedger(ctx);
      const before = tasks.get("t1")!;
      // Drive the reclaim path directly rather than waiting on a real clock —
      // a `nowOverride` far past any real lease deadline. `reclaim()` returns
      // the COUNT of rows it reset to `pending`.
      const reclaimedCount = await tasks.reclaim(Date.now() + input.forceLapseByMs);
      const after = tasks.get("t1")!;
      return {
        statusBefore: before.status,
        leaseUntilBefore: before.leaseUntil ?? null,
        reclaimedCount,
        statusAfter: after.status,
      };
    },
  });

  // ANTI-GAME sanity check only (second test below): forces a real ABA —
  // resumes the row from review back to `pending` and lets a different
  // worker claim it (bumping `attempts`) — so we can confirm the fence
  // actually refuses a stale resumed write-back rather than the harness
  // being unable to produce a decline at all.
  const bump = handler({
    name: "bump-attempts",
    inputSchema: z.unknown(),
    outputSchema: z.object({ newStatus: z.string() }),
    uses: [ledgerAccessCap],
    execute: async (_input, ctx) => {
      const tasks = await resolveLedger(ctx);
      await tasks.resumeFromReview("t1");
      await tasks.claim("aba-worker");
      return { newStatus: tasks.get("t1")!.status };
    },
  });

  const flow = defineFlow({
    kind: "settle-lab139-flow",
    actions: {
      start: { block: board.drain },
      probe: { block: probe },
      bump: { block: bump },
    },
  })({ id: "settle-lab139-flow" });

  return { flow };
}

async function durableRow(stores: StoreRegistry, taskId: string) {
  const row = await stores.resourceState.get("user", USER_ID, `${RESOURCE_KEY}/${taskId}`);
  return row?.state as { status: string; leaseUntil?: number; claimedBy?: unknown } | undefined;
}

describe("a detached worker that awaitReview()s and then ctx.suspend()s", () => {
  it(
    "survives the lease window (task park), but its resume is refused by its own start gate",
    async () => {
      const { flow } = buildScenario();
      const { stores, provider } = createDurableStores();
      const dispatched: { sessionId: string; actionName: string; input: unknown }[] = [];

      // --- Request 1: the parent claims t1 and hands it to the Workstream ---
      const parent = await runAction({
        flow,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_parent",
        stores,
        runtimeConfig: {
          ...baseRuntimeConfig(),
          durabilityProvider: provider,
          requestHost: {
            // Records and returns — nothing runs until we replay it as request 2,
            // exactly as `task-board-detached-handoff.test.ts` does.
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
      expect(parent.error).toBeUndefined();
      expect(dispatched).toHaveLength(1);
      const afterParent = await durableRow(stores, "t1");
      expect(afterParent?.status).toBe("in_progress");

      // --- Request 2: the Workstream — awaitReview, then ctx.suspend ---
      const child = await runAction({
        flow,
        actionName: dispatched[0]!.actionName as "start",
        input: dispatched[0]!.input,
        userId: USER_ID,
        sessionId: dispatched[0]!.sessionId,
        source: WORKSTREAM_SOURCE,
        stores,
        runtimeConfig: { ...baseRuntimeConfig(), durabilityProvider: provider },
      });
      expect(child.error).toBeUndefined();
      const childRequestId = child.requestId!;
      const childRecord = await stores.request.get(childRequestId);

      // === OBSERVATION A ===
      const afterSuspend = await durableRow(stores, "t1");
      expect(afterSuspend?.status).toBe("awaiting_review");
      expect(childRecord?.status).toBe("suspended");

      // === OBSERVATION B === force the lease window to have lapsed (a real
      // clock override, not a wait) and drive reclaim() directly.
      const probeRun = await runAction({
        flow,
        actionName: "probe",
        input: { forceLapseByMs: 10 * 60 * 1000 },
        userId: USER_ID,
        sessionId: "s_probe",
        stores,
        runtimeConfig: baseRuntimeConfig(),
      });
      expect(probeRun.error).toBeUndefined();
      const probeOut = probeRun.output as {
        statusBefore: string;
        reclaimedCount: number;
        statusAfter: string;
      };
      expect(probeOut.statusBefore).toBe("awaiting_review");
      expect(probeOut.reclaimedCount).toBe(0); // NOT reclaimed
      expect(probeOut.statusAfter).toBe("awaiting_review"); // untouched

      // === OBSERVATION C === resume via continueRequest with the persisted
      // {requestId, suspensionId} and see whether the fenced write-back lands.
      const [susp] = await provider.listSuspended({ status: "pending" });
      expect(susp).toBeDefined();
      await provider.suspend({ ...susp!, status: "approved", resolvedAt: Date.now() });

      const { finished } = await continueRequest({
        requestId: childRequestId,
        stores,
        flowRegistry: registryFor(flow),
        resumeContext: {
          suspensionId: susp!.suspensionId,
          action: "approve",
          data: undefined,
          resumedBy: "reviewer",
        },
        runtimeConfig: { ...baseRuntimeConfig(), durabilityProvider: provider },
      });
      const resumed = await finished;

      const afterResume = await durableRow(stores, "t1");
      const resumedRecord = await stores.request.get(childRequestId);

      // THE FINDING: the runner's pre-worker start gate is a `.tap()`, which
      // has no output for the resume replay to inject, so it RE-EXECUTES on
      // this continuation — re-reading the row and refusing it because
      // `awaitReview` already moved its status off `in_progress`. The worker
      // (and therefore `recordSuccess`'s `complete()`) is never reached.
      expect((resumed.output as { error?: string } | undefined)?.error).toContain(
        'the row is "awaiting_review", so no claim is outstanding on it'
      );
      // `recordError`'s own `fail()` write-back is itself declined
      // (`awaiting_review -> failed` is not a legal transition), so the row is
      // left exactly where the human review left it — NOT `completed`, and
      // NOT `errored` either. Nothing further will ever touch this attempt:
      // the outer request has already resolved.
      expect(afterResume?.status).toBe("awaiting_review");
      expect(resumed.error).toBeUndefined();
      expect(resumedRecord?.status).toBe("completed");
    },
    30_000
  );

  it(
    "ANTI-GAME: a stale attempt (row reclaimed and re-attempted before resume) IS refused by the fence",
    async () => {
      // Sanity-check the fence itself is live in this harness: if we force a
      // real reclaim (bumping `attempts`) BEFORE resuming the original
      // suspended attempt, the resumed write-back must be declined, not
      // silently accepted. A check that can only pass proves nothing.
      const { flow } = buildScenario();
      const { stores, provider } = createDurableStores();
      const dispatched: { sessionId: string; actionName: string; input: unknown }[] = [];

      const parent = await runAction({
        flow,
        actionName: "start",
        input: {},
        userId: USER_ID,
        sessionId: "s_parent2",
        stores,
        runtimeConfig: {
          ...baseRuntimeConfig(),
          durabilityProvider: provider,
          requestHost: {
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
      expect(parent.error).toBeUndefined();

      const child = await runAction({
        flow,
        actionName: dispatched[0]!.actionName as "start",
        input: dispatched[0]!.input,
        userId: USER_ID,
        sessionId: dispatched[0]!.sessionId,
        source: WORKSTREAM_SOURCE,
        stores,
        runtimeConfig: { ...baseRuntimeConfig(), durabilityProvider: provider },
      });
      expect(child.error).toBeUndefined();
      const childRequestId = child.requestId!;

      // Break the premise: resume the row from review back to `pending` and
      // let a fresh claim bump `attempts` out from under the suspended
      // attempt — the direct ABA the fence exists to catch.
      const bumped = await runAction({
        flow,
        actionName: "bump",
        input: {},
        userId: USER_ID,
        sessionId: "s_bump",
        stores,
        runtimeConfig: baseRuntimeConfig(),
      });
      expect(bumped.error).toBeUndefined();
      const afterBump = await durableRow(stores, "t1");
      expect(afterBump?.status).toBe("in_progress"); // re-claimed by "aba-worker"

      const [susp] = await provider.listSuspended({ status: "pending" });
      await provider.suspend({ ...susp!, status: "approved", resolvedAt: Date.now() });
      const { finished } = await continueRequest({
        requestId: childRequestId,
        stores,
        flowRegistry: registryFor(flow),
        resumeContext: {
          suspensionId: susp!.suspensionId,
          action: "approve",
          data: undefined,
          resumedBy: "reviewer",
        },
        runtimeConfig: { ...baseRuntimeConfig(), durabilityProvider: provider },
      });
      const resumed = await finished;
      const afterResume = await durableRow(stores, "t1");
      // The stale attempt's write-back must NOT have overwritten the live
      // claimant's row. It is declined (advisory), not thrown — so
      // `resumed.error` may still be undefined, but the STATUS must not read
      // `completed` under the ORIGINAL (stale) attempt.
      expect(afterResume?.status).not.toBe("completed");
    },
    30_000
  );
});

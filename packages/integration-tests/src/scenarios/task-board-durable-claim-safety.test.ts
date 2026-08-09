/**
 * Two concurrent executions over ONE durable task board: who owns a task, and
 * whose write-back is allowed to land (FIX-981, M1 of the durable-jobs epic
 * FIX-939).
 *
 * This began as a **characterization** written against unmodified code — the
 * falsification baseline the milestone was measured against. Three of its five
 * assertions describe behaviour that was already correct and is unchanged. The
 * other two were written to the broken behaviour, named as flip points so
 * neither would be a surprise, and **have now been flipped by the bound claim
 * ticket**. What each was, and what it is:
 *
 *   - **the cross-task write** asserted `{ outcome: "recorded" }` — a token
 *     issued for one task settling another. It now declines with
 *     `not-my-task`, and "b" is untouched. That is the milestone.
 *   - **the stale-basis write** asserted `reason: "disallowed"`. It now reports
 *     `not-my-task` too, because the target-binding arm is evaluated ahead of
 *     the `ifAllowed` arms. That ordering is the contract, not an incidental
 *     result: the same cross-task write must be refused for the same reason on
 *     *either* interleaving, or neither the model-facing message nor a
 *     programmatic caller can be built on the verdict. The pair of tests below
 *     is what pins it — one runs each interleaving.
 *
 * ## Why the epic's own numbers are not inherited
 *
 * The measurements this milestone was scoped from were taken before FIX-992
 * merged, against a harness that no longer exists. FIX-992 routed
 * `ResourceRef.updateState` through a CAS driver that refreshes and **re-runs
 * the caller's mutator** on a version conflict. Re-measured here, that closes
 * more of the original evidence than the epic assumed:
 *
 *   - claim exclusivity is **already delivered** (assertion 2),
 *   - the `attempts` lost-update is **already closed** (assertion 5),
 *   - a displaced worker's stale settlement is **already refused** (assertion 3).
 *
 * What remained was the token itself, and it was a real hole: the old
 * `expectAttempt` was a bare integer that named no task, so it was satisfied by
 * an unrelated task that happened to sit on the same attempt (assertion 1).
 * The ticket names its target, and closes it.
 *
 * ## Why two `testFlow` calls and not two workers on one drain
 *
 * The unit of isolation that matters is the **execution**: each `runAction`
 * gets its own resource cache, and a durable `TaskCollectionRef` hydrates its
 * task mirror once, when the collection is resolved. Two workers inside one
 * drain share both and cannot reproduce a stale-basis write. The two calls
 * here share one `StoreRegistry` and one `sessionId`, so they are two
 * executions over one durable board — the Conductor M2 shape (a coordinator
 * and its workers as separate executions) reduced to its smallest
 * reproducible form.
 *
 * ## Why a stalling worker rather than a real model
 *
 * The defect is a *binding* failure, not a duration one: it reproduces at any
 * latency including zero. A worker that awaits a released promise between
 * claim and write-back is strictly stronger than a slow model, because the
 * interleaving is chosen rather than hoped for. The real-model variant is
 * optional soak and gates nothing.
 *
 * Every assertion reads back from the **durable row** via the store, never
 * through a participating execution's `TaskCollectionRef`. A per-execution
 * cache can show a correct-looking task while the persisted row disagrees,
 * and the persisted row is what the next execution will read.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import {
  createInMemoryStores,
  resolveSessionResourceScopeId,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import {
  defineTaskCollection,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
  type TaskWriteOutcome,
} from "@flow-state-dev/orchestration";
import {
  taskBoard,
  taskWorkerInputSchema,
} from "@flow-state-dev/orchestration/task-board";
import { testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const COLLECTION_ID = "claim-safety-board";

/**
 * Held-out output values. Asserting on these rather than on `status` alone is
 * what stops a hollow pass: a write that landed on the wrong task still
 * produces a plausible-looking `completed`, and only the payload says *who*
 * wrote it.
 */
const STRANGER_OUTPUT = "written-by-a-worker-that-holds-another-task-4c1f";
const WINNER_OUTPUT = "written-by-the-worker-that-actually-holds-it-8a02";

/** A promise plus its resolver — the deterministic interleaving primitive. */
interface Gate {
  readonly reached: Promise<void>;
  open(): void;
}
function gate(): Gate {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { reached, open };
}

/**
 * Await a gate, or fail naming it.
 *
 * A participant that throws — or whose claim unexpectedly returns `null` —
 * never opens the gate the other side is parked on, and a bare `await` then
 * blocks to vitest's suite timeout and reports "timed out" with nothing about
 * which participant failed or why. These scenarios are entirely built out of
 * cross-execution handoffs, so that is the most likely way one of them breaks.
 * The budget is generous: it only has to be shorter than the suite ceiling,
 * never tight enough to make a loaded runner flaky.
 */
const GATE_TIMEOUT_MS = 10_000;
async function reach(g: Gate, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      g.reached,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `gate "${what}" was never opened — the other execution did not reach it, ` +
                  `so this scenario never happened`
              )
            ),
          GATE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The shared durable board. `session` scope is what carries tasks across
 * executions; a request-scoped board would give each `testFlow` call its own
 * copy and none of these races could exist.
 */
const taskCollection = defineTaskCollection({
  id: COLLECTION_ID,
  scope: "session",
  stateSchema: z.object({ goal: z.string() }),
});

/**
 * The board exists to register and resolve the durable collection — these
 * tests drive `claim` / `complete` directly rather than through `drain`,
 * because the defect is about which token a write presents and the drain
 * offers no seam to present a mismatched one. The end-to-end drain path is
 * proven separately by the goal check
 * (`goals/durable-claim-safety/two-executions-one-task`).
 */
const board = taskBoard({
  name: COLLECTION_ID,
  collection: taskCollection,
  concurrency: 1,
  workers: handler({
    name: "claim-safety-idle-worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ ok: z.string() }),
    execute: async (input) => ({ ok: input.goal }),
  }) as Parameters<typeof taskBoard>[0]["workers"],
  onIdle: "complete",
});

type Board = TaskCollectionRef<{ goal: string }, unknown>;

/**
 * One execution: a flow with a single handler that runs `body` against the
 * shared durable board. Each `testFlow` call over this is an independent
 * `runAction` with its own resource cache.
 *
 * **When a body starts is part of the scenario, not an implementation
 * detail.** The collection's task mirror hydrates when `tasks()` is first
 * awaited, so an execution launched before a sibling's claim holds a
 * pre-claim view of that task, and one launched after holds a post-claim
 * view. Assertions 1 and 4 turn on exactly that difference.
 */
function execution(name: string, body: (tasks: Board) => Promise<unknown>) {
  return defineFlow({
    kind: `claim-safety-${name}`,
    actions: {
      run: {
        block: handler({
          name: `claim-safety-${name}-body`,
          inputSchema: z.unknown(),
          uses: [board.capability],
          execute: async (_input, ctx) => {
            const accessor = (ctx.cap as Record<string, { tasks(): Promise<Board> }>)[
              COLLECTION_ID
            ]!;
            return (await body(await accessor.tasks())) ?? null;
          },
        }),
      },
    },
  })({ id: "default" });
}

/** Launch one execution over the shared stores/session. Not awaited here. */
function run(
  stores: StoreRegistry,
  sessionId: string,
  name: string,
  body: (tasks: Board) => Promise<unknown>
) {
  return testFlow({
    flow: execution(name, body),
    action: "run",
    userId: "u",
    input: undefined,
    sessionId,
    stores,
    unmockedGeneratorPolicy: "error",
  });
}

/**
 * The durable row for a task, read straight from the store — not through any
 * participating execution's collection ref, whose per-execution cache is
 * exactly what a stale write exploits.
 *
 * The session here is always created through `run()` (a real `testFlow` /
 * `createExecutionContext` call), so its record carries a minted
 * `storageGeneration` (FIX-1000) and its resources address at
 * `resolveSessionResourceScopeId(record)`, not the bare session id.
 */
async function durableTask(
  stores: StoreRegistry,
  sessionId: string,
  id: string
): Promise<Task<{ goal: string }, unknown> | undefined> {
  const record = await stores.session.get(sessionId);
  const scopeId = record ? resolveSessionResourceScopeId(record) : sessionId;
  const row = await stores.resourceState.get(
    "session",
    scopeId,
    `${COLLECTION_ID}/${id}`
  );
  return row?.state as Task<{ goal: string }, unknown> | undefined;
}

/** A fresh shared board: new stores, new session, seeded with `ids`. */
async function seedBoard(ids: string[]) {
  const stores = createInMemoryStores();
  const sessionId = `claim-safety-${Math.random().toString(36).slice(2)}`;
  const seeded = await run(stores, sessionId, "seed", async (tasks) => {
    await tasks.addTasks(ids.map((id) => ({ id, goal: id, input: { goal: id } })));
    return "seeded";
  });
  expect(seeded.error).toBeUndefined();
  return { stores, sessionId };
}

describe("durable task board: two executions contending for one task", () => {
  it("a ticket issued for one task cannot settle a different task", async () => {
    // THE PRIMARY ASSERTION, and the one no other test covers.
    // `advisory-write.test.ts` covers this at the collection; here it runs
    // across two real executions with their own resource caches, which is the
    // shape the defect was reported in.
    //
    // Attempt numbers are small and collide constantly across a board — two
    // freshly claimed tasks are both on attempt 1 — so a token that is only a
    // counter is satisfied by an unrelated task sitting on the same one. That
    // is what this used to demonstrate, as a passing assertion on
    // `{ outcome: "recorded" }`.
    const { stores, sessionId } = await seedBoard(["a", "b"]);

    const bClaimed = gate();
    const holderFinished = gate();

    // The sibling claims "b" and KEEPS HOLDING it across the stranger's write.
    // A worker that had already settled would be refused by the terminal arm,
    // which would prove nothing about ownership.
    const sibling = run(stores, sessionId, "sibling", async (tasks) => {
      const mine = await tasks.claim("worker-2", {
        eligibility: (t) => t.id === "b" && t.status === "pending",
      });
      bClaimed.open();
      await reach(holderFinished, "the stranger finished its write");
      return mine!.attempts;
    });

    // The stranger starts only once "b" is claimed, so its mirror holds the
    // post-claim view. This is the ordinary shape of a worker joining a board
    // whose siblings are already running — not a contrivance. Assertion 4
    // pins what happens on the other ordering, and why it hides the bug.
    await reach(bClaimed, "the sibling claimed b");

    const stranger = await run(stores, sessionId, "stranger", async (tasks) => {
      const mine = await tasks.claim("worker-1", {
        eligibility: (t) => t.id === "a" && t.status === "pending",
      });
      return {
        heldAttempt: mine!.attempts,
        targetAttempt: tasks.get("b")!.attempts,
        outcome: await tasks.complete("b", STRANGER_OUTPUT, {
          ifAllowed: true,
          claim: ticketForClaim(tasks.collectionId, mine!),
        }),
      };
    });
    holderFinished.open();
    expect((await sibling).error).toBeUndefined();
    expect(stranger.error).toBeUndefined();

    const observed = stranger.output as {
      heldAttempt: number;
      targetAttempt: number;
      outcome: TaskWriteOutcome;
    };

    // The precondition that makes this a real collision rather than an
    // accident of ordering: the two tasks genuinely sit on the same attempt.
    // If they did not, the counter alone would refuse the write and this test
    // would be measuring nothing.
    expect(observed.heldAttempt).toBe(observed.targetAttempt);

    // Refused as a VALUE naming the mismatch — not a throw, so a caller that
    // discards the verdict keeps the containment behaviour it had.
    expect(observed.outcome).toEqual({
      outcome: "declined",
      reason: "not-my-task",
      status: "in_progress",
    });
    // The durable row is untouched. Asserting the payload and not only the
    // status is what stops a hollow pass: a write that landed on the wrong task
    // still produces a plausible-looking `completed`, and only the payload says
    // who wrote it.
    const b = await durableTask(stores, sessionId, "b");
    expect(b?.status).toBe("in_progress");
    expect(b?.output).toBeUndefined();

    // ...and "a" — the task the caller actually holds — is still its own,
    // in flight and unaffected by the refusal of its holder's stray write.
    const a = await durableTask(stores, sessionId, "a");
    expect(a?.status).toBe("in_progress");
    expect(a?.output).toBeUndefined();
  });

  it("exactly one execution wins a claim on a contended task", async () => {
    // The anti-game control on the assertion above, and a re-measurement of
    // the epic's "two drains both claim" finding.
    //
    // Without this, a future implementation could go green by fencing
    // settlement while leaving `claim` open — which still lets two executions
    // run the same task, costing a duplicated model run every time, and would
    // satisfy any assertion phrased as "they cannot both settle". The claim is
    // the exclusivity boundary, so it is asserted as one.
    //
    // MEASURED: already delivered by FIX-992's CAS driver. The loser's claim
    // re-checks eligibility against refreshed state after its write conflicts,
    // sees the winner's row, and stands down.
    //
    // The board is seeded with TWO tasks and the racers narrow to one, rather
    // than racing for a lone task on default eligibility. That is the same
    // setup the goal check runs (`goals/durable-claim-safety/`), which needs
    // two tasks because its binding property needs a second one to hold — and
    // two spellings of one scenario is how the pair silently drifts apart.
    // It also buys an assertion the solo board could not make: a racer
    // narrowed to "a" must not be handed "b", so an implementation that
    // ignores the predicate outright is caught here rather than passing.
    const { stores, sessionId } = await seedBoard(["a", "b"]);

    const bothReady = gate();
    let arrived = 0;
    const arrive = () => {
      if (++arrived === 2) bothReady.open();
    };

    // Both executions are started, and both reach the barrier, before either
    // claims. Building the second lazily would turn the race into a sequence,
    // which a broken implementation also survives (FIX-992's anti-game rule,
    // which applies here because this assertion IS a race — assertions 1, 3
    // and 4 are deterministic orderings and sequence deliberately).
    const claims = await Promise.all(
      ["worker-1", "worker-2"].map((workerId, i) =>
        run(stores, sessionId, `racer-${i}`, async (tasks) => {
          arrive();
          await reach(bothReady, "both racers arrived at the barrier");
          // The `status` clause is NOT redundant with narrowing to one id: a
          // custom `eligibility` REPLACES the substrate's default (pending +
          // deps satisfied) rather than narrowing it, and readiness is what
          // the claim's re-check inside the atomic write consults to decide
          // it lost the race. Drop it and both racers' re-checks pass on an
          // already-claimed task, so the board hands "a" out twice and this
          // test fails for a reason that has nothing to do with the code
          // under test.
          const claimed = await tasks.claim(workerId, {
            eligibility: (t) => t.id === "a" && t.status === "pending",
          });
          return claimed === null
            ? null
            : { id: claimed.id, attempts: claimed.attempts };
        })
      )
    );

    // The loser resolved to NO TASK rather than to an error. Asserting a throw
    // here would pass against an implementation that turns a lost race into a
    // drain-killing exception — the failure FIX-951's containment work already
    // fixed once.
    for (const c of claims) expect(c.error).toBeUndefined();
    const winners = claims.map((c) => c.output).filter((o) => o !== null);
    expect(winners).toEqual([{ id: "a", attempts: 1 }]);

    const durable = await durableTask(stores, sessionId, "a");
    expect(durable?.status).toBe("in_progress");
    expect(durable?.attempts).toBe(1);

    // The task neither racer was eligible for is untouched — the predicate was
    // honoured, not ignored in favour of "any pending task".
    const other = await durableTask(stores, sessionId, "b");
    expect(other?.status).toBe("pending");
    expect(other?.attempts).toBe(0);
  });

  it("a displaced worker's settlement is refused, and the new holder's stands", async () => {
    // The guard working as intended, on the task the token was actually issued
    // for — re-measured across two real executions rather than inside one.
    //
    // The new holder deliberately does NOT settle before the stale write
    // arrives. If it had, the refusal would come from the `terminal` arm and
    // would prove nothing about ownership. Leaving the task `in_progress`
    // under its new holder means only the ownership arm can refuse it.
    //
    // This is also the path that exercises FIX-992's refresh-and-re-run: the
    // displaced worker's basis is stale, its guard check passes against that
    // stale basis, its write conflicts, and the mutator is re-run against the
    // truth — where the guard correctly declines.
    const { stores, sessionId } = await seedBoard(["t"]);

    const displacedHolds = gate();
    const displacedMayWrite = gate();
    const staleWriteDone = gate();

    const displaced = run(stores, sessionId, "displaced", async (tasks) => {
      const mine = await tasks.claim("worker-1");
      displacedHolds.open();
      await reach(displacedMayWrite, "the winner re-claimed the task");
      const outcome = await tasks.complete("t", STRANGER_OUTPUT, {
        ifAllowed: true,
        claim: ticketForClaim(tasks.collectionId, mine!),
      });
      staleWriteDone.open();
      return outcome;
    });

    // The sweeper starts after the claim so it can see a task to reclaim —
    // a pre-claim mirror would show `pending`, find nothing in flight, and
    // the scenario would silently not happen.
    await reach(displacedHolds, "the displaced worker took its claim");

    const winner = await run(stores, sessionId, "winner", async (tasks) => {
      // What a lease sweeper does: return the task to `pending`, then claim it
      // again. `attempts` advances only on the claim.
      const reclaimed = await tasks.reclaim(Number.MAX_SAFE_INTEGER);
      const mine = await tasks.claim("worker-2");
      displacedMayWrite.open();
      await reach(staleWriteDone, "the displaced worker attempted its stale write");
      return {
        reclaimed,
        attempt: mine!.attempts,
        outcome: await tasks.complete("t", WINNER_OUTPUT, {
          ifAllowed: true,
          claim: ticketForClaim(tasks.collectionId, mine!),
        }),
      };
    });

    const displacedResult = await displaced;
    expect(displacedResult.error).toBeUndefined();
    expect(winner.error).toBeUndefined();

    const w = winner.output as {
      reclaimed: number;
      attempt: number;
      outcome: TaskWriteOutcome;
    };
    // The displacement actually happened — without this the refusal below
    // could be produced by a scenario where nothing was ever reclaimed.
    expect(w.reclaimed).toBe(1);
    expect(w.attempt).toBe(2);

    // Refused as a VALUE, not a throw — a caller that discards the return
    // keeps today's behaviour.
    expect(displacedResult.output).toEqual({
      outcome: "declined",
      reason: "lost-claim",
      status: "in_progress",
    });
    expect(w.outcome).toEqual({ outcome: "recorded" });

    const durable = await durableTask(stores, sessionId, "t");
    expect(durable?.status).toBe("completed");
    expect(durable?.output).toBe(WINNER_OUTPUT);
  });

  it("refuses a cross-task write as not-my-task on a STALE basis too", async () => {
    // The ordering assertion, and the reason the guard's arm order is a
    // contract rather than an implementation detail. A test that only asserted
    // "the write was refused" would pass against the broken code and be worth
    // nothing here.
    //
    // Same cross-task write as the test above, opposite interleaving: the
    // stranger resolves the collection BEFORE "b" is claimed, so its mirror
    // holds "b" as `pending`. A decline aborts the write before it is
    // attempted, so the CAS never conflicts, never refreshes, and never re-runs
    // the guard — the stale mirror IS the basis every arm reads.
    //
    // `pending -> completed` is illegal, so the `disallowed` arm would fire
    // here. Left last, the ownership arm would therefore report `disallowed` on
    // this ordering and `not-my-task` on the other: the same defect refused for
    // whichever reason happened to be available, which is accidental
    // protection rather than a guarantee, and a verdict no caller can act on.
    // The target-binding arm reads no mutable task state at all, so it is the
    // only one whose answer cannot be a stale-basis artifact — and it runs
    // first.
    const { stores, sessionId } = await seedBoard(["a", "b"]);

    const strangerLoaded = gate();
    const bClaimed = gate();

    const stranger = run(stores, sessionId, "early-stranger", async (tasks) => {
      const mine = await tasks.claim("worker-1", {
        eligibility: (t) => t.id === "a" && t.status === "pending",
      });
      // Mirror hydrated before "b" was claimed.
      expect(tasks.get("b")?.status).toBe("pending");
      strangerLoaded.open();
      await reach(bClaimed, "the late sibling claimed b");
      return await tasks.complete("b", STRANGER_OUTPUT, {
        ifAllowed: true,
        claim: ticketForClaim(tasks.collectionId, mine!),
      });
    });

    const sibling = await run(stores, sessionId, "late-sibling", async (tasks) => {
      await reach(strangerLoaded, "the early stranger hydrated its mirror");
      const mine = await tasks.claim("worker-2", {
        eligibility: (t) => t.id === "b" && t.status === "pending",
      });
      bClaimed.open();
      return mine!.attempts;
    });
    const strangerResult = await stranger;

    expect(sibling.error).toBeUndefined();
    expect(strangerResult.error).toBeUndefined();

    // Refused for ownership, not for a legality accident — even though the
    // status the guard saw was the stale `pending` that would have produced
    // `disallowed`. Same defect, same reason, either ordering.
    expect(strangerResult.output).toEqual({
      outcome: "declined",
      reason: "not-my-task",
      status: "pending",
    });

    const b = await durableTask(stores, sessionId, "b");
    expect(b?.status).toBe("in_progress");
    expect(b?.output).toBeUndefined();
  });

  it("a concurrent patch does not roll `attempts` backwards", async () => {
    // The epic's lost-update finding, re-measured against merged `main`.
    //
    // The concern was that the patch helpers (`addLabel`, `setPriority`,
    // `patchMetadata`, ...) persist the WHOLE task, so a patch computed from a
    // pre-claim snapshot would write back `attempts: 0` over a claim that had
    // since landed — silently handing the task back to the pool while a worker
    // was still running it.
    //
    // MEASURED: closed on merged main. FIX-992's CAS driver re-runs the
    // mutator against refreshed state, so the patch applies to the claimed
    // task rather than to the stale snapshot. Had this failed, the spec's
    // design would have had to grow a fourth deliverable — which is why it is
    // measured rather than assumed.
    const { stores, sessionId } = await seedBoard(["t"]);

    const patcherLoaded = gate();
    const claimTaken = gate();

    const [patcher, claimer] = await Promise.all([
      run(stores, sessionId, "patcher", async (tasks) => {
        // Load the pre-claim view into this execution's cache, THEN let the
        // claim land. Without this ordering the patcher would read the
        // already-claimed task and the case would not discriminate.
        expect(tasks.get("t")?.attempts).toBe(0);
        patcherLoaded.open();
        await reach(claimTaken, "the claimer took the task");
        return await tasks.addLabel("t", "triaged");
      }),
      run(stores, sessionId, "claimer", async (tasks) => {
        await reach(patcherLoaded, "the patcher loaded its pre-claim view");
        const mine = await tasks.claim("worker-2");
        claimTaken.open();
        return mine!.attempts;
      }),
    ]);

    expect(patcher.error).toBeUndefined();
    expect(claimer.output).toBe(1);
    expect(patcher.output).toEqual({ outcome: "recorded" });

    const durable = await durableTask(stores, sessionId, "t");
    // The claim survived the patch.
    expect(durable?.attempts).toBe(1);
    expect(durable?.status).toBe("in_progress");
    // ...and the patch itself landed. Without this the assertion above would
    // also be satisfied by a patch that silently did nothing at all.
    expect(durable?.labels).toContain("triaged");
  });
});

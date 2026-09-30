/**
 * The run link (FIX-1668) — which run is working a task, written by the run.
 *
 * Three properties fail independently, so they are asserted separately:
 *
 * 1. **The write is fenced like a renewal.** `linkRun` records only for the
 *    attempt that holds the row, and declines `terminal`, `not-my-task` and
 *    `lost-claim` otherwise. An unfenced link could point any task at any run.
 * 2. **Lifetime: until the next claim.** The claim clears it in the same write
 *    that advances `attempts`; settlement, retry, cancel, park and abandonment
 *    keep it. A finished task still names the run that worked it, and a new
 *    attempt never shows the previous attempt's run as its own.
 * 3. **Nobody else writes it.** It is absent from `TaskInit`, and a runtime
 *    attempt to smuggle one in through `addTask` is dropped.
 *
 * The gate that calls the verb is covered in `task-board/run-link-gate.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  taskSchema,
  ticketForClaim,
  toEmittedTask,
  type Task,
  type TaskChangeEvent,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskInit,
  type TaskRunLink,
} from "../../src/tasks";
import { taskEnvelopeSchema } from "../../src/tasks/collection/define-task-collection";
import { applyClaimToTask } from "../../src/tasks/collection/internal";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

interface Backing {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
  setNow: (n: number) => void;
}

async function sequencerBacking(): Promise<Backing> {
  let clock = 1000;
  const captured = createCapturedChanges();
  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
    setNow: (n) => {
      clock = n;
    },
  };
}

async function resourceBacking(): Promise<Backing> {
  let clock = 1000;
  const captured = createCapturedChanges();
  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
    setNow: (n) => {
      clock = n;
    },
  };
}

function runOf(attempt: number, tag = "a"): TaskRunLink {
  return { sessionId: `sess_run_${tag}`, requestId: `req_run_${tag}`, attempt };
}

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
])("the run link (%s)", (_name, makeBacking) => {
  /** Claim `t` at t=1000 under a 10-second lease, and mint its ticket. */
  async function claimed(
    init: Partial<TaskInit> = {}
  ): Promise<Backing & { claim: TaskClaimTicket; task: Task }> {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", ...init });
    const task = (await backing.collection.claim("w", { leaseDurationMs: 10_000 }))!;
    return { ...backing, task, claim: ticketForClaim(backing.collection.collectionId, task) };
  }

  /** Claim, then link the attempt's run. */
  async function linked(init: Partial<TaskInit> = {}) {
    const backing = await claimed(init);
    const run = runOf(backing.task.attempts);
    expect(await backing.collection.linkRun("t", run, { claim: backing.claim })).toEqual({
      outcome: "recorded",
    });
    return { ...backing, run };
  }

  // ---- the verb (V3) -------------------------------------------------------

  it("records the run on the holder, and publishes exactly one run_linked", async () => {
    const { collection, events, run } = await linked();

    expect(collection.get("t")?.run).toEqual(run);
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "run_linked")).toHaveLength(1);
    const item = events.find((e) => e.kind === "run_linked")!;
    // The published row carries the link, and still not the claim's coordinate.
    expect(toEmittedTask(item.task).run).toEqual(run);
    // Writes one field: status, attempt and lease are untouched.
    expect(collection.get("t")?.status).toBe("in_progress");
    expect(collection.get("t")?.attempts).toBe(1);
  });

  it("copies only the three ids, whatever else the caller's object carries", async () => {
    const { collection, claim } = await claimed();
    const noisy = { ...runOf(1), tenantId: "acme", flowId: "board" } as TaskRunLink;

    await collection.linkRun("t", noisy, { claim });

    expect(collection.get("t")?.run).toEqual(runOf(1));
  });

  it("declines terminal on a settled row, writing nothing", async () => {
    const { collection, claim } = await claimed();
    await collection.complete("t", "done", { claim });

    expect(await collection.linkRun("t", runOf(1), { claim })).toEqual({
      outcome: "declined",
      reason: "terminal",
      status: "completed",
    });
    expect(collection.get("t")?.run).toBeUndefined();
  });

  it("declines not-my-task for a ticket naming another board", async () => {
    const { collection, claim } = await claimed();

    expect(
      await collection.linkRun("t", runOf(1), { claim: { ...claim, collectionId: "other" } })
    ).toMatchObject({ outcome: "declined", reason: "not-my-task" });
    expect(collection.get("t")?.run).toBeUndefined();
  });

  it("declines lost-claim once a later claim holds the row", async () => {
    const { collection, claim, setNow } = await claimed();
    // The lease lapses and a recovery claim takes the row: attempt 2 now owns it.
    setNow(1000 + 10_001);
    await collection.claim("w2", { leaseDurationMs: 10_000 });

    expect(await collection.linkRun("t", runOf(1), { claim })).toMatchObject({
      outcome: "declined",
      reason: "lost-claim",
    });
    expect(collection.get("t")?.run).toBeUndefined();
  });

  it("declines lost-claim on a lapsed lease, and ignores adoptLapsedLease", async () => {
    // A lapsed claimant takes the row back with a renewal first; the link write
    // itself must never be the takeover.
    const { collection, claim, setNow } = await claimed();
    setNow(1000 + 10_000);

    expect(
      await collection.linkRun("t", runOf(1), { claim, adoptLapsedLease: true })
    ).toMatchObject({ outcome: "declined", reason: "lost-claim" });
    expect(collection.get("t")?.run).toBeUndefined();
  });

  it("throws on a missing ticket", async () => {
    const { collection } = await claimed();

    await expect(
      collection.linkRun("t", runOf(1), {} as { claim: TaskClaimTicket })
    ).rejects.toThrow(/requires the claim ticket/);
  });

  // ---- lifetime (V2) -------------------------------------------------------

  it("keeps the link when the task completes", async () => {
    const { collection, claim, run } = await linked();
    await collection.complete("t", "done", { claim });
    expect(collection.get("t")?.run).toEqual(run);
  });

  it("keeps the link when the task fails terminally", async () => {
    const { collection, claim, run } = await linked();
    await collection.fail("t", "boom", { claim });
    expect(collection.get("t")?.status).toBe("errored");
    expect(collection.get("t")?.run).toEqual(run);
  });

  it("keeps the failed run's link while the task waits to retry", async () => {
    const { collection, claim, run } = await linked({ maxAttempts: 3 });
    await collection.fail("t", "transient", { claim });
    expect(collection.get("t")?.status).toBe("pending");
    expect(collection.get("t")?.run).toEqual(run);
  });

  it("keeps the link when the task is cancelled", async () => {
    const { collection, run } = await linked();
    await collection.cancel("t", "no longer needed");
    expect(collection.get("t")?.run).toEqual(run);
  });

  it("keeps the link when the task is parked for review", async () => {
    const { collection, run } = await linked();
    await collection.awaitReview("t", "please look");
    expect(collection.get("t")?.status).toBe("parked");
    expect(collection.get("t")?.run).toEqual(run);
  });

  it("the next claim clears the link, in the write that advances attempts", async () => {
    const { collection, claim } = await linked({ maxAttempts: 3 });
    await collection.fail("t", "transient", { claim });

    const next = await collection.claim("w", { leaseDurationMs: 10_000 });

    expect(next?.attempts).toBe(2);
    expect(next?.run).toBeUndefined();
    expect(collection.get("t")?.run).toBeUndefined();
  });

  it("a recovery claim of a lapsed row clears the link too", async () => {
    const { collection, setNow } = await linked();
    setNow(1000 + 10_001);

    const recovered = await collection.claim("w2", { leaseDurationMs: 10_000 });

    expect(recovered?.attempts).toBe(2);
    expect(recovered?.abandonments).toBe(1);
    expect(recovered?.run).toBeUndefined();
  });

  it("abandonment settlement keeps the link of the run that was abandoned", async () => {
    // Every recovery spends one abandonment; once the allowance is spent the
    // claim settles the row errored instead of handing it out again.
    const { collection, setNow } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t" });
    let clock = 1000;
    let last: TaskRunLink | undefined;
    for (;;) {
      setNow(clock);
      const task = await collection.claim("w", { leaseDurationMs: 1000 });
      if (task === null) break;
      last = runOf(task.attempts, String(task.attempts));
      await collection.linkRun("t", last, {
        claim: ticketForClaim(collection.collectionId, task),
      });
      clock += 1001;
    }

    expect(collection.get("t")?.status).toBe("errored");
    expect(collection.get("t")?.run).toEqual(last);
  });

  it("a stored row with no link reads as no run linked", async () => {
    const { collection } = await claimed();
    // BP-030: absent is the normal state for a legacy row and for an attempt
    // whose run has not started; nothing is inferred from `claimedBy`.
    expect(collection.get("t")?.run).toBeUndefined();
  });

  // ---- nobody else writes it (BR-9, BR-10) ---------------------------------

  it("drops a link smuggled into addTask", async () => {
    const backing = await makeBacking();
    const smuggled = { id: "t", goal: "t", run: runOf(0) } as TaskInit;

    await backing.collection.addTask(smuggled);

    expect(backing.collection.get("t")?.run).toBeUndefined();
  });

  it("patchMetadata cannot reach it", async () => {
    const { collection, run } = await linked();
    await collection.patchMetadata("t", { run: runOf(9, "forged") });
    expect(collection.get("t")?.run).toEqual(run);
  });
});

describe("the run link on the durable envelope", () => {
  const run = { sessionId: "sess_run", requestId: "req_run", attempt: 2 };
  const row = {
    id: "t",
    goal: "t",
    status: "in_progress",
    attempts: 2,
    createdAt: 1,
    updatedAt: 1,
  };

  it("round-trips through the durable envelope and JSON", () => {
    // Declared on the schema, not added by a backing: an undeclared key is
    // stripped by the envelope on its way to the store.
    const envelope = taskEnvelopeSchema(taskSchema.shape.input);
    const stored = JSON.parse(JSON.stringify(envelope.parse({ ...row, run })));
    expect(taskSchema.parse(stored).run).toEqual(run);
  });

  it("a legacy row without it parses and reads as no run linked", () => {
    expect(taskSchema.parse(row).run).toBeUndefined();
  });

  it("applyClaimToTask never inherits the previous attempt's link", () => {
    const next = applyClaimToTask({ ...(row as Task), status: "pending", run }, 5000, 1000);
    expect(next).toHaveProperty("run", undefined);
    expect(next.attempts).toBe(3);
  });

  it("TaskInit rejects a run at compile time", () => {
    // @ts-expect-error — `run` is server-set and absent from every write surface.
    const init: TaskInit = { goal: "t", run };
    expect(init.goal).toBe("t");
  });
});

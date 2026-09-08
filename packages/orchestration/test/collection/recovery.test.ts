/**
 * Recovery — a stranded job returns to the queue on its own (FIX-1005).
 *
 * The queue's half of the one subtraction. An `in_progress` row whose lease has
 * lapsed has no live worker on it (because a live worker renews), so `claim`
 * admits it, and the claim write decides what to do with it: hand it out again,
 * or settle it `errored` once its abandonment allowance is spent.
 *
 * Two things are asserted apart from each other on purpose, because folding
 * them together is what produced an earlier contradiction:
 *
 * - **Admission** — "should the claim path look at this row?" One predicate,
 *   read by all three producers.
 * - **Disposition** — "what happens to it?" Decided inside the atomic write,
 *   against committed state, where the allowance can be read.
 *
 * A predicate that also encoded the disposition excluded the very rows the
 * write was supposed to settle, because both backings filter candidates
 * *before* the write.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_ABANDONMENTS,
  eventDispatcher,
  isClaimable,
  ticketForClaim,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { hasClaimableTask } from "../../src/task-board/shared";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

interface Backing {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
  setNow: (n: number) => void;
  now: () => number;
}

async function sequencerBacking(): Promise<Backing> {
  let clock = 1000;
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
    tasks: {},
  });
  const captured = createCapturedChanges();
  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer,
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
    setNow: (n) => {
      clock = n;
    },
    now: () => clock,
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
    now: () => clock,
  };
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

/** Every claim in this file takes a short, explicit lease so the clock moves
 *  are legible; the default two-minute lease is asserted separately below. */
const LEASE = 10_000;

/** Claim `id` under the short lease. Returns the committed row. */
async function claimShort(
  backing: Backing,
  id: string,
  workerId = "w"
): Promise<Task | null> {
  return backing.collection.claim(workerId, {
    leaseDurationMs: LEASE,
    eligibility: (t) => t.id === id,
  });
}

/** Claim `id` and then let its lease lapse — a worker that died mid-task. */
async function abandon(backing: Backing, id: string): Promise<Task | null> {
  const claimed = await claimShort(backing, id, "dead-worker");
  backing.setNow(backing.now() + LEASE + 1);
  return claimed;
}

describe.each(BACKINGS)("recovery — admission (%s)", (_name, makeBacking) => {
  it("recovers a default task with NO maxAttempts, as attempt 2", async () => {
    // THE headline case, and a regression test. An "attempts remain" arm in the
    // admission predicate would make exactly this impossible: `maxAttempts` is
    // optional and the retry check returns false without one, so an ordinary
    // task reads as already exhausted after attempt 1 — the whole feature off
    // by default unless every caller opts into retries.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandon(backing, "t");

    const recovered = await backing.collection.claim("w2");

    expect(recovered?.id).toBe("t");
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.status).toBe("in_progress");
  });

  it("still gates on deps — an abandoned row with an unfinished dep is not admitted", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "dep", goal: "dep" });
    await backing.collection.addTask({ id: "t", goal: "t", deps: ["dep"] });
    // Claim `t` directly so it can lapse while its dep is still open.
    await abandon(backing, "t");

    expect(await backing.collection.claim("w2", { eligibility: (x) => x.id === "t" })).toBeNull();
  });

  it("never admits a parked row, however long the review takes", async () => {
    // `awaitReview` deliberately does not clear `leaseUntil`, so a lapsed lease
    // on a parked row is an ordinary state rather than an abandoned worker.
    // Review is an explicit park; the lease governs `in_progress` only.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    const claimed = await backing.collection.claim("w", { leaseDurationMs: 10_000 });
    await backing.collection.awaitReview("t", "look at this", {
      ifAllowed: true,
      claim: ticketForClaim(backing.collection.collectionId, claimed!),
    });
    backing.setNow(backing.now() + 10_000_000);

    expect(await backing.collection.claim("w2")).toBeNull();
    expect(backing.collection.get("t")?.status).toBe("parked");
  });

  it("is read by ALL THREE admission consumers, not just claim()", async () => {
    // A suite that only exercises `claim()` directly passes against an
    // implementation whose board never wakes for the row it could recover.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandon(backing, "t");
    const at = backing.now();

    // 1. the predicate itself
    const row = backing.collection.get("t")!;
    expect(isClaimable(row, (id) => backing.collection.get(id), at)).toBe(true);
    // 2. the board's wake probe
    expect(hasClaimableTask(backing.collection)).toBe(true);
    // 3. the claim path
    expect((await backing.collection.claim("w2"))?.id).toBe("t");
  });
});

describe.each(BACKINGS)("recovery — a caller's eligibility NARROWS (%s)", (_name, makeBacking) => {
  it("recovers a lapsed row INSIDE a built-in dispatcher's narrowing", async () => {
    // Pinned on the composed claim path with a real built-in dispatcher rather
    // than a bespoke predicate, so the test covers the shape callers get.
    // Before this composition a caller's predicate REPLACED the substrate's, so
    // recovery was unreachable for any dispatcher that asserted
    // `status === "pending"` — including the recipe our own docs recommended.
    const backing = await makeBacking();
    await backing.collection.addTask({
      id: "t",
      goal: "t",
      metadata: { topic: "billing" },
    });
    await abandon(backing, "t");

    const dispatcher = eventDispatcher({
      topicFor: (t: Task) => (t.metadata as { topic?: string } | undefined)?.topic,
      topic: "billing",
    });

    expect((await dispatcher.claim(backing.collection, "w2"))?.id).toBe("t");
  });

  it("leaves a lapsed row OUTSIDE the narrowing alone — the stated cost, asserted", async () => {
    // Decision 6's residual, constructed rather than assumed. Recovery composes
    // with a caller's filter over the rows that filter admits, not over every
    // row, and a suite that never builds this case lets a later reader believe
    // the invariant is wider than it is.
    const backing = await makeBacking();
    await backing.collection.addTask({
      id: "t",
      goal: "t",
      metadata: { topic: "billing" },
    });
    await abandon(backing, "t");

    const dispatcher = eventDispatcher({
      topicFor: (t: Task) => (t.metadata as { topic?: string } | undefined)?.topic,
      topic: "shipping",
    });

    expect(await dispatcher.claim(backing.collection, "w2")).toBeNull();
    expect(backing.collection.get("t")?.status).toBe("in_progress");
  });
});

describe.each(BACKINGS)("recovery — disposition and the allowance (%s)", (_name, makeBacking) => {
  /** Abandon `t` `times` times over, returning the final row. */
  async function abandonRepeatedly(backing: Backing, times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) await abandon(backing, "t");
  }

  it("counts each recovery, and a row missing the counter reads as zero", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    // BP-030, and the direction is the assertion: a task persisted before the
    // upgrade carries no counter, and absent must read as zero rather than as
    // exhausted — the second reading would strand exactly the rows this
    // mechanism exists to rescue.
    expect(backing.collection.get("t")?.abandonments).toBeUndefined();

    // First claim: the row was `pending`, so nothing was abandoned.
    expect((await abandon(backing, "t"))?.abandonments).toBeUndefined();
    // Each claim that TAKES BACK a lapsed row is the one that counts.
    expect((await abandon(backing, "t"))?.abandonments).toBe(1);
    expect((await abandon(backing, "t"))?.abandonments).toBe(2);
  });

  it("settles a row whose allowance is spent, in the same write, rather than running it", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandonRepeatedly(backing, DEFAULT_MAX_ABANDONMENTS + 1);
    backing.events.length = 0;

    expect(await backing.collection.claim("w-last")).toBeNull();

    const settled = backing.collection.get("t");
    expect(settled?.status).toBe("errored");
    expect(settled?.error).toContain("abandoned");
    // Not left `in_progress`: a row with nobody on it still counts as
    // in-flight, and a board would then never report `drained` or `blocked`.
    expect(settled?.leaseUntil).toBeUndefined();
  });

  it("publishes a task-change for that settlement, so a stream is not left showing in_progress", async () => {
    // The settlement is a successful mutation like any other and owes its
    // event. Without it a streamed UI and every change subscriber keep showing
    // `in_progress` on a row storage has terminalized.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandonRepeatedly(backing, DEFAULT_MAX_ABANDONMENTS + 1);
    backing.events.length = 0;

    await backing.collection.claim("w-last");

    const errored = backing.events.filter((e) => e.kind === "errored");
    expect(errored).toHaveLength(1);
    expect(errored[0].taskId).toBe("t");
    expect(errored[0].prevStatus).toBe("in_progress");
  });

  it("admits the exhausted row and THEN settles it — the two are separate", async () => {
    // A suite that asserts only "it is not claimed" passes against the shape
    // that deadlocks: a predicate that excluded the row would leave it
    // `in_progress` forever, because the settling branch lives behind the
    // candidate filter.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandonRepeatedly(backing, DEFAULT_MAX_ABANDONMENTS + 1);

    // Admitted: the wake probe fires for it.
    expect(hasClaimableTask(backing.collection)).toBe(true);
    // And then settled rather than run.
    expect(await backing.collection.claim("w-last")).toBeNull();
    expect(backing.collection.get("t")?.status).toBe("errored");
  });

  it("scans past an exhausted row to the work behind it", async () => {
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandonRepeatedly(backing, DEFAULT_MAX_ABANDONMENTS + 1);
    await backing.collection.addTask({ id: "next", goal: "next" });

    expect((await backing.collection.claim("w-last"))?.id).toBe("next");
    expect(backing.collection.get("t")?.status).toBe("errored");
  });
});

describe.each(BACKINGS)("the two budgets are separate (%s)", (_name, makeBacking) => {
  it("leaves a task's FULL failure budget after two crashes — asserted from the customer's side", async () => {
    // The assertion is on the retry the task still gets, not on the counter's
    // value, because the counter can be right while the failure check still
    // reads `attempts` undiscounted. That is precisely the shape "separate in
    // name only" takes, and a suite asserting only the field passes against it.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 3 });
    await abandon(backing, "t"); // attempt 1 — the worker died
    await abandon(backing, "t"); // attempt 2 — so did the next one
    const third = await claimShort(backing, "t", "w3");

    expect(third?.abandonments).toBe(2);
    expect(third?.attempts).toBe(3);

    // Two crashes, zero real failures. Under a shared budget `attempts` would
    // already be at the limit and this genuine failure would go terminal.
    await backing.collection.fail("t", "genuine failure");

    expect(backing.collection.get("t")?.status).toBe("pending");
    expect(backing.collection.get("t")?.retryLedger).toEqual({
      granted: 1,
      deniedByBudget: false,
    });
  });

  it("still terminalizes once the task's OWN failures spend the budget", async () => {
    // The discount must not become an escape hatch: real failures still count.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t", maxAttempts: 2 });
    await backing.collection.claim("w1");
    await backing.collection.fail("t", "boom 1");
    await backing.collection.claim("w2");
    await backing.collection.fail("t", "boom 2");

    expect(backing.collection.get("t")?.status).toBe("errored");
  });
});

describe.each(BACKINGS)("the counter is not caller-writable (%s)", (_name, makeBacking) => {
  it("survives a patchMetadata carrying a key of its own name (BP-031)", async () => {
    // The test that fails if a later author relocates the counter into
    // `metadata` to survive a mixed-version strip. `patchMetadata` merges
    // arbitrary caller keys with a plain spread and is exposed to a model
    // through `updateTask`, so a counter there could be reset (unbounded
    // recovery) or inflated (a live task terminalized early) — an execution
    // decision driven by caller-controllable input.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "t", goal: "t" });
    await abandon(backing, "t");
    await claimShort(backing, "t", "w2");
    expect(backing.collection.get("t")?.abandonments).toBe(1);

    await backing.collection.patchMetadata("t", { abandonments: 99 });

    expect(backing.collection.get("t")?.abandonments).toBe(1);
    expect(backing.collection.get("t")?.status).toBe("in_progress");
  });
});

describe.each(BACKINGS)("the lease default and its bounds (%s)", (_name, makeBacking) => {
  it("commits a two-minute lease when the claim passes none, and exactly what it passes otherwise", async () => {
    // Asserted as behaviour rather than as a constant: what changed is which
    // jobs get taken back early, and a caller-supplied lease must not move.
    const backing = await makeBacking();
    await backing.collection.addTask({ id: "a", goal: "a" });
    await backing.collection.addTask({ id: "b", goal: "b" });

    const defaulted = await backing.collection.claim("w1", {
      eligibility: (t) => t.id === "a",
    });
    expect(defaulted!.leaseUntil! - defaulted!.updatedAt).toBe(DEFAULT_LEASE_DURATION_MS);
    expect(DEFAULT_LEASE_DURATION_MS).toBe(120_000);

    const explicit = await backing.collection.claim("w2", {
      eligibility: (t) => t.id === "b",
      leaseDurationMs: 5_000,
    });
    expect(explicit!.leaseUntil! - explicit!.updatedAt).toBe(5_000);
  });

  it.each([0, -1, 999, Number.NaN, Number.POSITIVE_INFINITY, 1e12])(
    "refuses the lease duration %p at the claim seam, so the cadence never defends against it",
    async (leaseDurationMs) => {
      // Throws rather than normalizing: a caller who asked for a 10ms lease and
      // silently got 1,000ms has been handed a different guarantee than the one
      // they asked for. Same posture the repo already takes for a numeric
      // argument outside its domain.
      const backing = await makeBacking();
      await backing.collection.addTask({ id: "t", goal: "t" });

      await expect(backing.collection.claim("w", { leaseDurationMs })).rejects.toThrow(
        /leaseDurationMs/
      );
    }
  );
});

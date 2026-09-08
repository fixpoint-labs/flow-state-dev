/**
 * `unpark` is fenced to the one edge it owns: `parked → pending` (FIX-1244).
 *
 * The verb used to re-queue ANY live row and report `recorded` — a task a
 * worker was running, a task already answered — because `in_progress →
 * pending` and `pending → pending` are legal in the status table and nothing
 * narrowed the verb to its own edge. Now it refuses everything that is not
 * waiting on a person, as a value (`declined`, naming the status it found),
 * and one park takes one answer: the first accepted answer queues the work and
 * a second is refused rather than overwriting the first.
 *
 * Parameterized over both backings because the fence lives in the shared
 * decline ladder, and a per-backing divergence is exactly what the
 * parameterized suite exists to catch.
 *
 * ## The one test that matters is the last one
 *
 * "Wrong status in, refusal out" passes against a pre-check — a `get()` before
 * the write. So does "changed between the caller's read and the call". The
 * only test that can FAIL against a pre-check and PASS against a guard evaluated
 * inside the write is one where the row changes inside the method's own
 * read-to-write window. The replaying fakes do that: the mutator runs once
 * against a parked row, that result is discarded as a lost CAS round, the
 * concurrent writer's change lands, and the mutator runs again against the
 * changed row. A pre-check would have passed on the first read and let the
 * second run write.
 */
import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
  taskStatusSchema,
  type Task,
  type TaskCollectionRef,
  type TaskChangeEvent,
  type TaskStatus,
} from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
  type ReplayOptions,
} from "../helpers";

type Backing = {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
};

/** Mutate the stored copy of one task, standing in for the writer that won the race. */
type TaskMutation = (task: Task) => Task;

/**
 * Build a backing. With `concurrent` set, every write loses one CAS round and
 * `concurrent` is applied to the named task in between — `seed` runs first on a
 * non-replaying backing so setup writes are not themselves replayed.
 */
type BackingFactory = (
  seed: (collection: TaskCollectionRef) => Promise<void>,
  concurrent?: { taskId: string; mutate: TaskMutation }
) => Promise<Backing>;

const sequencerBacking: BackingFactory = async (seed, concurrent) => {
  const captured = createCapturedChanges();
  const seedState = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  await seed(
    createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: seedState,
      now: () => 1000,
    })
  );

  const replay: ReplayOptions<{ tasks: Record<string, unknown> }> | undefined =
    concurrent === undefined
      ? undefined
      : {
          onReplay: (state) => {
            const tasks = { ...(state.tasks as Record<string, Task>) };
            tasks[concurrent.taskId] = concurrent.mutate(tasks[concurrent.taskId]!);
            return { ...state, tasks };
          },
        };
  const state = createFakeSequencerState<{ tasks: Record<string, unknown> }>(
    { tasks: { ...(seedState.__raw().tasks as Record<string, unknown>) } },
    replay
  );

  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: state,
      onChange: captured.onChange,
      now: () => 1000,
    }),
    events: captured.events,
  };
};

const resourceBacking: BackingFactory = async (seed, concurrent) => {
  const captured = createCapturedChanges();
  const collection = createFakeResourceCollection(
    undefined,
    concurrent === undefined
      ? undefined
      : {
          onReplay: (state) => {
            const task = state as unknown as Task;
            if (task.id !== concurrent.taskId) return state;
            return concurrent.mutate(task) as unknown as typeof state;
          },
        }
  );

  // `addTask` uses `create`, not `updateState`, so seeding through the same
  // fake is not replayed; every later transition is.
  await seed(
    await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection,
      now: () => 1000,
    })
  );

  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection,
      onChange: captured.onChange,
      now: () => 1000,
    }),
    events: captured.events,
  };
};

const backings: Array<[string, BackingFactory]> = [
  ["resource-backed", resourceBacking],
  ["sequencer-backed", sequencerBacking],
];

/** Put task `t` into `status` through the public verbs, so no fixture is hand-built. */
async function seedInStatus(collection: TaskCollectionRef, status: TaskStatus): Promise<void> {
  await collection.addTask({ id: "t", goal: "g" });
  switch (status) {
    case "pending":
      return;
    case "blocked":
      await collection.block("t", "waiting on a dep");
      return;
    case "cancelled":
      await collection.cancel("t", "no longer needed");
      return;
    case "in_progress":
      await collection.claim("w");
      return;
    case "parked":
      await collection.claim("w");
      await collection.awaitReview("t", "which option?");
      return;
    case "completed":
      await collection.claim("w");
      await collection.complete("t", { ok: true });
      return;
    case "errored":
      await collection.claim("w");
      // No `maxAttempts`, so the first failure is terminal.
      await collection.fail("t", "boom");
      return;
  }
}

const TERMINAL: readonly TaskStatus[] = ["completed", "errored", "cancelled"];

/** The row's data, without the handle's per-call `items()` closure, so two reads compare. */
function rowOf(collection: TaskCollectionRef, id: string): Record<string, unknown> {
  const { items: _items, ...row } = collection.get(id)!;
  return row;
}

/** Every status except the one the verb owns — enumerated from the enum, not from examples. */
const NOT_PARKED = taskStatusSchema.options.filter((s) => s !== "parked");

describe.each(backings)("%s — unpark is fenced to parked → pending", (_name, backing) => {
  it.each(NOT_PARKED.filter((s) => !TERMINAL.includes(s)))(
    "refuses a %s task as `disallowed`, naming the status, and writes nothing",
    async (status) => {
      const { collection, events } = await backing((c) => seedInStatus(c, status));
      const before = rowOf(collection, "t");
      events.length = 0;

      const outcome = await collection.unpark("t", "the answer");

      expect(outcome).toEqual({ outcome: "declined", reason: "disallowed", status });
      expect(rowOf(collection, "t")).toEqual(before);
      expect(events).toEqual([]);
    }
  );

  it.each(TERMINAL)(
    "refuses a %s task as `terminal` — a value, not a throw, even with no options",
    async (status) => {
      const { collection, events } = await backing((c) => seedInStatus(c, status));
      const before = rowOf(collection, "t");
      events.length = 0;

      const outcome = await collection.unpark("t", "the answer");

      expect(outcome).toEqual({ outcome: "declined", reason: "terminal", status });
      expect(rowOf(collection, "t")).toEqual(before);
      expect(events).toEqual([]);
    }
  );

  it("cannot be widened by the caller — `ifAllowed: false` still refuses", async () => {
    // Advisory by construction, the way `cancel` is: the fence is the verb's
    // contract, not an option a caller switches on.
    const { collection } = await backing((c) => seedInStatus(c, "in_progress"));

    const outcome = await collection.unpark("t", "the answer", { ifAllowed: false });

    expect(outcome).toEqual({ outcome: "declined", reason: "disallowed", status: "in_progress" });
    expect(collection.get("t")?.status).toBe("in_progress");
  });

  it("re-queues a genuinely parked task exactly as before: feedback lands, lease and claim clear, attempts hold", async () => {
    const { collection, events } = await backing((c) => seedInStatus(c, "parked"));
    const parked = collection.get("t")!;
    events.length = 0;

    const outcome = await collection.unpark("t", "option A");

    expect(outcome).toEqual({ outcome: "recorded" });
    const after = collection.get("t")!;
    expect(after.status).toBe("pending");
    expect(after.feedback).toBe("option A");
    expect(after.attempts).toBe(parked.attempts);
    expect(after.leaseUntil).toBeUndefined();
    expect(after.claimedBy).toBeUndefined();
    expect(events.map((e) => e.kind)).toEqual(["resumed"]);
  });

  it("one park takes one answer: a second answer is refused and the first stands", async () => {
    const { collection, events } = await backing((c) => seedInStatus(c, "parked"));

    expect(await collection.unpark("t", "option A")).toEqual({ outcome: "recorded" });
    events.length = 0;

    const second = await collection.unpark("t", "option B");

    // Not `unchanged`: the fence refuses before the write is attempted, so an
    // already-queued row is a decline naming `pending`, never a success.
    expect(second).toEqual({ outcome: "declined", reason: "disallowed", status: "pending" });
    expect(collection.get("t")?.feedback).toBe("option A");
    expect(events).toEqual([]);
  });

  it("keeps the fence inside the write: a row that leaves `parked` in the read-to-write window is refused", async () => {
    // The row is parked when the method starts. The mutator's first run sees
    // that and would accept; that round is lost, a worker claims the row in
    // between (a reclaim-and-claim, say), and the mutator re-runs against
    // `in_progress`. A guard evaluated inside the updater refuses on the
    // re-run. A pre-check outside it passed on the first read and never looks
    // again, so it re-queues a row a worker is holding.
    const { collection, events } = await backing((c) => seedInStatus(c, "parked"), {
      taskId: "t",
      mutate: (task) => ({ ...task, status: "in_progress", leaseUntil: 10_000_000 }),
    });
    events.length = 0;

    const outcome = await collection.unpark("t", "the answer");

    expect(outcome).toEqual({ outcome: "declined", reason: "disallowed", status: "in_progress" });
    expect(collection.get("t")?.status).toBe("in_progress");
    expect(events).toEqual([]);
  });
});

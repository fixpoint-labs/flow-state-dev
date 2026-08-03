/**
 * Replay safety for both task-collection backings (FIX-995).
 *
 * The fakes are configured to lose exactly one CAS round: the mutation
 * callback runs once against the pre-conflict state and that result is
 * discarded, a concurrent writer's change is applied, and the callback runs
 * again against that state — which commits. This mirrors `runWithCAS`, which
 * re-invokes the mutator after a conflict.
 *
 * Parameterized over both backings on purpose. `sequencer-backed.ts` already
 * hand-reset its captured bindings on every mutator entry, so it was correct
 * before this change and must stay correct after — these cases are its
 * behaviour-preservation evidence. `resource-backed.ts`, its twin implementing
 * the same interface, had no such discipline: every case below failed against
 * it before the migration.
 *
 * The verdicts and the emitted `task-change` items are both asserted. Reporting
 * `recorded` for a write that lost is the defect; emitting a change item for it
 * is the same defect reaching a UI and a durable log.
 */
import { describe, expect, it } from "vitest";
import {
  createSequencerBackedTaskCollection,
  createResourceBackedTaskCollection,
  type TaskCollectionRef,
  type TaskChangeEvent,
} from "../../src/tasks";
import type { Task } from "../../src/tasks";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

type Backing = {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
};

/** Mutate the stored copy of one task, standing in for the writer that won the race. */
type TaskMutation = (task: Task) => Task;

/**
 * Build a backing that loses one CAS round on every write, with `concurrent`
 * applied to the task in between. `seed` runs first, on a non-replaying
 * backing, so setup writes are not themselves replayed.
 */
type BackingFactory = (
  seed: (collection: TaskCollectionRef) => Promise<void>,
  concurrent: TaskMutation
) => Promise<Backing>;

const sequencerBacking: BackingFactory = async (seed, concurrent) => {
  let clock = 1000;
  const captured = createCapturedChanges();
  const seedState = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  await seed(
    createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: seedState,
      now: () => clock,
    })
  );

  const replaying = createFakeSequencerState<{ tasks: Record<string, unknown> }>(
    { tasks: { ...(seedState.__raw().tasks as Record<string, unknown>) } },
    {
      onReplay: (state) => {
        const tasks = state.tasks as Record<string, Task>;
        const next: Record<string, Task> = {};
        for (const [id, task] of Object.entries(tasks)) next[id] = concurrent(task);
        return { ...state, tasks: next };
      },
    }
  );

  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: replaying,
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
  };
};

const resourceBacking: BackingFactory = async (seed, concurrent) => {
  let clock = 1000;
  const captured = createCapturedChanges();
  const collection = createFakeResourceCollection(undefined, {
    onReplay: (state) => concurrent(state as unknown as Task) as unknown as typeof state,
  });

  // Seeding must not replay, so hydrate through a collection with the hook
  // disabled by only enabling it after setup. The fake applies `onReplay` per
  // `updateState`, and `addTask` uses `create`, not `updateState`, so seeding
  // through the same collection is safe.
  await seed(
    await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection,
      now: () => clock,
    })
  );

  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection,
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
  };
};

const backings: Array<[string, BackingFactory]> = [
  ["resource-backed", resourceBacking],
  ["sequencer-backed", sequencerBacking],
];

describe.each(backings)("%s — a replayed write reports only what committed", (_name, backing) => {
  it("claim() returns null when the winner already claimed the task", async () => {
    // The highest-stakes row in the spec's edge-case table: reporting the task
    // as claimed here hands one lease to a second worker.
    const { collection, events } = await backing(
      async (c) => {
        await c.addTask({ id: "t1", input: {} });
      },
      (task) => ({ ...task, status: "in_progress", leaseUntil: 10_000_000 })
    );

    const claimed = await collection.claim("worker-2");

    expect(claimed).toBeNull();
    expect(events.filter((e) => e.kind === "claimed")).toEqual([]);
  });

  it("setAssignee() reports `unchanged` and emits nothing when the patch is a no-op on the winner", async () => {
    const { collection, events } = await backing(
      async (c) => {
        await c.addTask({ id: "t1", input: {} });
      },
      (task) => ({ ...task, assignee: "already-set" })
    );

    const verdict = await collection.setAssignee("t1", "already-set");

    expect(verdict).toEqual({ outcome: "unchanged" });
    expect(events).toEqual([]);
  });

  it("reclaim() counts nothing and emits nothing when the winner's lease is no longer expired", async () => {
    const { collection, events } = await backing(
      async (c) => {
        await c.addTask({ id: "t1", input: {} });
        await c.claim("worker-1");
      },
      // The concurrent writer renewed the lease well into the future.
      (task) => ({ ...task, leaseUntil: 99_000_000 })
    );

    const count = await collection.reclaim(50_000_000);

    expect(count).toBe(0);
    expect(events.filter((e) => e.kind === "resumed")).toEqual([]);
  });

  it("reclaim() reports exactly the winner's reclaimed tasks, never a previous attempt's", async () => {
    const { collection, events } = await backing(
      async (c) => {
        await c.addTask({ id: "t1", input: {} });
        await c.claim("worker-1");
      },
      (task) => task
    );

    const count = await collection.reclaim(50_000_000);

    expect(count).toBe(1);
    expect(events.filter((e) => e.kind === "resumed")).toHaveLength(1);
  });

  it("complete() still reports `recorded` and emits once when the winner accepts the move", async () => {
    // Behaviour preservation: a replay that still commits reports normally.
    const { collection, events } = await backing(
      async (c) => {
        await c.addTask({ id: "t1", input: {} });
        await c.claim("worker-1");
      },
      (task) => task
    );

    const verdict = await collection.complete("t1", { ok: true });

    expect(verdict).toEqual({ outcome: "recorded" });
    expect(events.filter((e) => e.kind === "completed")).toHaveLength(1);
  });

  it("complete() reports `declined` when the winner already settled the task", async () => {
    const { collection, events } = await backing(
      async (c) => {
        await c.addTask({ id: "t1", input: {} });
        await c.claim("worker-1");
      },
      (task) => ({ ...task, status: "cancelled", completedAt: 1000 })
    );

    const verdict = await collection.complete("t1", { ok: true }, { ifAllowed: true });

    expect(verdict).toMatchObject({ outcome: "declined" });
    expect(events.filter((e) => e.kind === "completed")).toEqual([]);
  });
});

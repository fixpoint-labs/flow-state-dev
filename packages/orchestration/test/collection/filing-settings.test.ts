/**
 * A task runs as its filer chose at filing, and nothing waits on work that
 * will never finish (FIX-2080).
 *
 * - **Start.** A task filed `held` doesn't start until released; one that
 *   hasn't started can be held. Its start and attempts settings change only
 *   until it starts: a retry's return to `pending` doesn't reopen them.
 * - **Dependencies.** A dependency must be a task on this board, not already
 *   failed or cancelled, and must not close a loop. A filing that breaks one is
 *   refused, naming the rule, and files nothing.
 * - **Settings a board can't honour** are refused at filing: a plain board
 *   takes only the defaults. A conversation-result task has one attempt.
 * - **The dependents cascade.** A failed or cancelled task's open dependents
 *   are cancelled, labelled `skipped`, naming the task that caused it, down the
 *   chain, by the board itself. The cascade is a debt recorded with the
 *   ending, so one a crash left owed is paid by the next touch past its due
 *   time.
 *
 * Every rule runs on both backings, because a board picks its backing and
 * the rule is the board's.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  ticketForClaim,
  TaskFilingRefusedError,
  CASCADE_DUE_MS,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";
import type { JsonObject } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";

type Clock = { at: number };
type Backing = {
  tasks: TaskCollectionRef;
  events: TaskChangeEvent[];
  clock: Clock;
  /** Write a stored row straight into the backing's store, as a crash left it. */
  seed: (row: Task) => Promise<TaskCollectionRef>;
};

async function stateBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const clock: Clock = { at: 1_000 };
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const make = () =>
    createStateBackedTaskCollection({
      collectionId: "tasks",
      state: sequencer,
      onChange: (event) => events.push(event),
      now: () => clock.at,
    });
  return {
    tasks: make(),
    events,
    clock,
    seed: async (row) => {
      await sequencer.patchState({ tasks: { ...(sequencer.state.tasks as Record<string, unknown>), [row.id]: row } });
      return make();
    },
  };
}

async function resourceBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const clock: Clock = { at: 1_000 };
  const collection: ResourceCollectionRef<JsonObject> = createFakeResourceCollection();
  const make = () =>
    createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection,
      onChange: (event) => events.push(event),
      now: () => clock.at,
    });
  return {
    tasks: await make(),
    events,
    clock,
    seed: async (row) => {
      await collection.create(row.id, row as unknown as JsonObject);
      return make();
    },
  };
}

const BACKINGS = [
  ["state-backed", stateBacking],
  ["resource-backed", resourceBacking],
] as const;

/** Claim the next task and fail it with `error`, as its worker would. */
async function claimAndFail(tasks: TaskCollectionRef, error = "boom"): Promise<Task> {
  const claimed = (await tasks.claim("w"))!;
  await tasks.fail(claimed.id, error, { claim: ticketForClaim("tasks", claimed) });
  return tasks.get(claimed.id) as Task;
}

/** The refusal a filing threw, or a failure when it didn't throw one. */
async function refusal(write: () => Promise<unknown>): Promise<TaskFilingRefusedError> {
  try {
    await write();
  } catch (error) {
    if (error instanceof TaskFilingRefusedError) return error;
    throw error;
  }
  throw new Error("the filing was not refused");
}

describe.each(BACKINGS)("filing settings (%s)", (_name, makeBacking) => {
  describe("start: held, hold and release", () => {
    it("files a held task that no claim starts, and starts it once released", async () => {
      const { tasks, events } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "chart it", held: true });

      expect(tasks.get("t")?.status).toBe("held");
      expect(await tasks.claim("w")).toBeNull();

      expect(await tasks.release("t")).toEqual({ outcome: "recorded" });
      expect(tasks.get("t")?.status).toBe("pending");
      expect(events.at(-1)).toMatchObject({ kind: "released", prevStatus: "held" });
      expect((await tasks.claim("w"))?.id).toBe("t");
    });

    it("holds a task that hasn't started, and refuses a hold once it has", async () => {
      const { tasks, events } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "t" });

      expect(await tasks.hold("t")).toEqual({ outcome: "recorded" });
      expect(tasks.get("t")?.status).toBe("held");
      expect(events.at(-1)).toMatchObject({ kind: "held", prevStatus: "pending" });
      await tasks.release("t");

      await tasks.claim("w");
      expect(await tasks.hold("t")).toEqual({ outcome: "declined", reason: "started", status: "in_progress" });
    });

    it("refuses a hold after a retry put a started task back to pending", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "t", maxAttempts: 2 });
      const retried = await claimAndFail(tasks);
      expect(retried.status).toBe("pending");

      expect(await tasks.hold("t")).toEqual({ outcome: "declined", reason: "started", status: "pending" });
      expect(await tasks.patchSettings("t", { maxAttempts: 5 })).toMatchObject({ outcome: "declined", reason: "started" });
      expect(tasks.get("t")?.maxAttempts).toBe(2);
    });

    it("changes dependencies and attempts until the task starts, and not after", async () => {
      const { tasks, events } = await makeBacking();
      await tasks.addTasks([
        { id: "a", goal: "a" },
        { id: "b", goal: "b" },
      ]);
      expect(await tasks.patchSettings("b", { deps: ["a"], maxAttempts: 3 })).toEqual({ outcome: "recorded" });
      expect(tasks.get("b")).toMatchObject({ deps: ["a"], maxAttempts: 3 });
      expect(events.at(-1)?.kind).toBe("settings_changed");
      expect(await tasks.patchSettings("b", { deps: ["a"] })).toEqual({ outcome: "unchanged" });

      await tasks.patchSettings("b", { deps: [] });
      await tasks.claim("w");
      await tasks.claim("w");
      expect(await tasks.patchSettings("b", { deps: ["a"] })).toMatchObject({ outcome: "declined", reason: "started" });
    });

    it("refuses a hold on an ended task as terminal", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "t" });
      await tasks.cancel("t", "not needed");
      expect(await tasks.hold("t")).toEqual({ outcome: "declined", reason: "terminal", status: "cancelled" });
    });
  });

  describe("dependencies: on this board, alive, and no loop", () => {
    it("refuses a dependency no task on this board has, and files nothing", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() => tasks.addTask({ id: "t", goal: "t", deps: ["pull-csv"] }));

      expect(refused.rule).toBe("dependency_not_on_board");
      expect(refused.message).toMatch(/cross boards with a wait or a held task/);
      expect(tasks.get("t")).toBeUndefined();
    });

    it("takes a dependency filed in the same batch", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTasks([
        { id: "b", goal: "b", deps: ["a"] },
        { id: "a", goal: "a" },
      ]);
      expect(tasks.get("b")?.deps).toEqual(["a"]);
    });

    it("refuses a whole batch when one of its rows names a dependency off the board", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() =>
        tasks.addTasks([
          { id: "a", goal: "a" },
          { id: "b", goal: "b", deps: ["elsewhere"] },
        ])
      );
      expect(refused.rule).toBe("dependency_not_on_board");
      expect(tasks.list()).toHaveLength(0);
    });

    it.each([
      ["failed", async (tasks: TaskCollectionRef) => void (await claimAndFail(tasks))],
      ["cancelled", async (tasks: TaskCollectionRef) => void (await tasks.cancel("dead"))],
    ])("refuses a dependency already %s", async (_how, end) => {
      const { tasks } = await makeBacking();
      await tasks.addTask({ id: "dead", goal: "dead" });
      await end(tasks);

      const refused = await refusal(() => tasks.addTask({ id: "t", goal: "t", deps: ["dead"] }));
      expect(refused.rule).toBe("dependency_ended");
      expect(tasks.get("t")).toBeUndefined();
    });

    it("refuses a loop within a batch, and a task that depends on itself", async () => {
      const { tasks } = await makeBacking();
      expect(
        (await refusal(() =>
          tasks.addTasks([
            { id: "a", goal: "a", deps: ["b"] },
            { id: "b", goal: "b", deps: ["a"] },
          ])
        )).rule
      ).toBe("dependency_loop");
      expect((await refusal(() => tasks.addTask({ id: "s", goal: "s", deps: ["s"] }))).rule).toBe("dependency_loop");
      expect(tasks.list()).toHaveLength(0);
    });

    it("refuses an edit whose dependencies close a loop through the board", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTasks([
        { id: "a", goal: "a" },
        { id: "b", goal: "b", deps: ["a"] },
        { id: "c", goal: "c", deps: ["b"] },
      ]);
      expect((await refusal(() => tasks.patchSettings("a", { deps: ["c"] }))).rule).toBe("dependency_loop");
      expect(tasks.get("a")?.deps).toBeUndefined();
    });
  });

  describe("settings a board can't honour", () => {
    it("refuses an ongoing session and a conversation result on a plain board, naming the setting", async () => {
      const { tasks } = await makeBacking();
      const session = await refusal(() => tasks.addTask({ id: "t", goal: "t", session: "ongoing" }));
      expect(session.rule).toBe("setting_not_supported");
      expect(session.message).toMatch(/session "ongoing"/);
      const result = await refusal(() => tasks.addTask({ id: "t", goal: "t", resultTo: "conversation" }));
      expect(result.rule).toBe("setting_not_supported");
      expect(result.message).toMatch(/"conversation"/);
      expect(tasks.get("t")).toBeUndefined();
    });

    it("takes the defaults, written on the row as filed", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "t", session: "new", resultTo: "filer" });
      expect(tasks.get("t")).toMatchObject({ session: "new", resultTo: "filer" });
    });

    it("refuses a follow-up that names a session", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() => tasks.addTask({ id: "f", goal: "f", followUpOf: "root", session: "new" }));
      expect(refused.rule).toBe("follow_up_takes_no_session");
    });
  });

  describe("the dependents cascade", () => {
    it("cancels a failed task's dependents down the chain, labelled skipped, naming the cause", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTasks([
        { id: "a", goal: "a" },
        { id: "b", goal: "b", deps: ["a"] },
        { id: "c", goal: "c", deps: ["b"] },
        { id: "x", goal: "x" },
      ]);
      await claimAndFail(tasks);

      expect(tasks.get("a")?.status).toBe("errored");
      expect(tasks.get("b")).toMatchObject({ status: "cancelled", causedBy: "a", labels: ["skipped"], error: "dep a failed" });
      expect(tasks.get("c")).toMatchObject({ status: "cancelled", causedBy: "b", labels: ["skipped"] });
      // Not a dependent: untouched.
      expect(tasks.get("x")?.status).toBe("pending");
      // Paid, so nothing is left owed.
      expect(tasks.list({ cascadeOwed: true })).toHaveLength(0);
    });

    it("cancels a cancelled task's dependents too", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTasks([
        { id: "a", goal: "a" },
        { id: "b", goal: "b", deps: ["a"] },
        { id: "c", goal: "c", deps: ["b"] },
      ]);
      await tasks.cancel("a", "not needed");
      expect(tasks.get("b")).toMatchObject({ status: "cancelled", causedBy: "a", error: "dep a was cancelled" });
      expect(tasks.get("c")).toMatchObject({ status: "cancelled", causedBy: "b" });
    });

    it("cancels nothing on a retry: the task runs again, and its dependents wait for it", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTasks([
        { id: "a", goal: "a", maxAttempts: 2 },
        { id: "b", goal: "b", deps: ["a"] },
      ]);
      await claimAndFail(tasks);
      expect(tasks.get("a")?.status).toBe("pending");
      expect(tasks.get("b")?.status).toBe("pending");
    });

    it("cancels a held dependent too: it would wait on a task that will never finish", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTasks([
        { id: "a", goal: "a" },
        { id: "b", goal: "b", deps: ["a"], held: true },
      ]);
      await tasks.cancel("a");
      expect(tasks.get("b")?.status).toBe("cancelled");
    });

    it("pays a cascade a crash left owed on the next touch past its due time, and not before", async () => {
      const { seed, clock } = await makeBacking();
      // The ending landed with its debt, and nothing paid it (the process died).
      const base = { attempts: 1, createdAt: 1_000, updatedAt: 1_000, revision: 2 } as const;
      await seed({ ...base, id: "a", goal: "a", status: "errored", error: "boom", cascadeOwed: { due: 1_000 + CASCADE_DUE_MS } } as Task);
      const tasks = await seed({ ...base, id: "b", goal: "b", status: "pending", attempts: 0, deps: ["a"] } as Task);

      expect(await tasks.payOwedCascades!()).toBe(0);
      expect(tasks.get("b")?.status).toBe("pending");

      clock.at = 1_000 + CASCADE_DUE_MS;
      expect(await tasks.payOwedCascades!()).toBe(1);
      expect(tasks.get("b")).toMatchObject({ status: "cancelled", causedBy: "a" });
      expect(tasks.get("a")?.cascadeOwed).toBeUndefined();
    });
  });

  describe("attempts", () => {
    it("fails a task filed with three attempts after its third failure", async () => {
      const { tasks } = await makeBacking();
      await tasks.addTask({ id: "t", goal: "t", maxAttempts: 3 });
      expect((await claimAndFail(tasks)).status).toBe("pending");
      expect((await claimAndFail(tasks)).status).toBe("pending");
      expect((await claimAndFail(tasks)).status).toBe("errored");
      expect(tasks.get("t")?.attempts).toBe(3);
    });
  });
});

describe.each(BACKINGS)("retired rows in the store at upgrade (%s)", (_name, makeBacking) => {
  const stored = { attempts: 0, createdAt: 1_000, updatedAt: 1_000, revision: 1 };

  it("reads a blocked row as held, and starts it once released", async () => {
    const { seed } = await makeBacking();
    const tasks = await seed({ ...stored, id: "t", goal: "t", status: "blocked", error: "waiting on legal" } as unknown as Task);
    expect(tasks.get("t")).toMatchObject({ status: "held", feedback: "waiting on legal" });
    expect(tasks.get("t")?.error).toBeUndefined();
    expect(await tasks.claim("w")).toBeNull();

    await tasks.release("t");
    expect((await tasks.claim("w"))?.id).toBe("t");
  });

  it("reads a recorded-not-started row as held, and starts it once released", async () => {
    const { seed } = await makeBacking();
    const tasks = await seed({ ...stored, id: "t", goal: "t", status: "pending", undispatched: true } as unknown as Task);
    expect(tasks.get("t")?.status).toBe("held");
    expect("undispatched" in (tasks.get("t") as object)).toBe(false);
    expect(await tasks.claim("w")).toBeNull();

    await tasks.release("t");
    expect((await tasks.claim("w"))?.id).toBe("t");
  });

  it("reads the shapes whose entries are still off as stored", async () => {
    const { seed } = await makeBacking();
    await seed({ ...stored, id: "p", goal: "p", status: "pending", sealed: { kind: "post" } } as unknown as Task);
    await seed({ ...stored, id: "s", goal: "s", status: "parked", metadata: { splitInto: { session: "x", flow: "f" } } } as unknown as Task);
    await seed({ ...stored, id: "r", goal: "r", status: "pending", reopened: true } as unknown as Task);
    const tasks = await seed({ ...stored, id: "q", goal: "q", status: "parked", parkedForTurn: true } as unknown as Task);
    expect(tasks.get("p")?.session).toBeUndefined();
    expect(tasks.get("s")?.status).toBe("parked");
    expect(tasks.get("r")?.reopened).toBe(true);
    expect(tasks.get("q")).toMatchObject({ status: "parked", parkedForTurn: true });
  });
});

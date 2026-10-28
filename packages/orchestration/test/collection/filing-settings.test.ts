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
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";

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
      await tasks.createTask({ id: "t", goal: "chart it", held: true });

      expect(tasks.get("t")?.status).toBe("held");
      expect(await tasks.claim("w")).toBeNull();

      expect(await tasks.release("t")).toEqual({ outcome: "recorded" });
      expect(tasks.get("t")?.status).toBe("pending");
      expect(events.at(-1)).toMatchObject({ kind: "released", prevStatus: "held" });
      expect((await tasks.claim("w"))?.id).toBe("t");
    });

    it("holds a task that hasn't started, and refuses a hold once it has", async () => {
      const { tasks, events } = await makeBacking();
      await tasks.createTask({ id: "t", goal: "t" });

      expect(await tasks.hold("t")).toEqual({ outcome: "recorded" });
      expect(tasks.get("t")?.status).toBe("held");
      expect(events.at(-1)).toMatchObject({ kind: "held", prevStatus: "pending" });
      await tasks.release("t");

      await tasks.claim("w");
      expect(await tasks.hold("t")).toEqual({ outcome: "declined", reason: "started", status: "in_progress" });
    });

    it("refuses a hold after a retry put a started task back to pending", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTask({ id: "t", goal: "t", maxAttempts: 2 });
      const retried = await claimAndFail(tasks);
      expect(retried.status).toBe("pending");

      expect(await tasks.hold("t")).toEqual({ outcome: "declined", reason: "started", status: "pending" });
      expect(await tasks.patchSettings("t", { maxAttempts: 5 })).toMatchObject({ outcome: "declined", reason: "started" });
      expect(tasks.get("t")?.maxAttempts).toBe(2);
    });

    it("changes dependencies and attempts until the task starts, and not after", async () => {
      const { tasks, events } = await makeBacking();
      await tasks.createTasks([
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
      await tasks.createTask({ id: "t", goal: "t" });
      await tasks.cancel("t", "not needed");
      expect(await tasks.hold("t")).toEqual({ outcome: "declined", reason: "terminal", status: "cancelled" });
    });
  });

  describe("dependencies: on this board, alive, and no loop", () => {
    it("refuses a dependency no task on this board has, and files nothing", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() => tasks.createTask({ id: "t", goal: "t", deps: ["pull-csv"] }));

      expect(refused.rule).toBe("dependency_not_on_board");
      expect(refused.message).toMatch(/cross boards with a wait or a held task/);
      expect(tasks.get("t")).toBeUndefined();
    });

    it("takes a dependency filed in the same batch", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTasks([
        { id: "b", goal: "b", deps: ["a"] },
        { id: "a", goal: "a" },
      ]);
      expect(tasks.get("b")?.deps).toEqual(["a"]);
    });

    it("refuses a whole batch when one of its rows names a dependency off the board", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() =>
        tasks.createTasks([
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
      await tasks.createTask({ id: "dead", goal: "dead" });
      await end(tasks);

      const refused = await refusal(() => tasks.createTask({ id: "t", goal: "t", deps: ["dead"] }));
      expect(refused.rule).toBe("dependency_ended");
      expect(tasks.get("t")).toBeUndefined();
    });

    it.each(["errored", "cancelled"] as const)("refuses a dependency filed %s in the same batch, and files none of it", async (status) => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() =>
        tasks.createTasks([
          { id: "dead", goal: "dead", status },
          { id: "t", goal: "t", deps: ["dead"] },
        ])
      );
      expect(refused.rule).toBe("dependency_ended");
      expect(tasks.list()).toHaveLength(0);
    });

    it("refuses a loop within a batch, and a task that depends on itself", async () => {
      const { tasks } = await makeBacking();
      expect(
        (await refusal(() =>
          tasks.createTasks([
            { id: "a", goal: "a", deps: ["b"] },
            { id: "b", goal: "b", deps: ["a"] },
          ])
        )).rule
      ).toBe("dependency_loop");
      expect((await refusal(() => tasks.createTask({ id: "s", goal: "s", deps: ["s"] }))).rule).toBe("dependency_loop");
      expect(tasks.list()).toHaveLength(0);
    });

    it("refuses an edit whose dependencies close a loop through the board", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTasks([
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
      const session = await refusal(() => tasks.createTask({ id: "t", goal: "t", session: "ongoing" }));
      expect(session.rule).toBe("setting_not_supported");
      expect(session.message).toMatch(/session "ongoing"/);
      const result = await refusal(() => tasks.createTask({ id: "t", goal: "t", resultTo: "conversation" }));
      expect(result.rule).toBe("setting_not_supported");
      expect(result.message).toMatch(/"conversation"/);
      expect(tasks.get("t")).toBeUndefined();
    });

    it("takes the defaults, written on the row as filed", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTask({ id: "t", goal: "t", session: "new", resultTo: "filer" });
      expect(tasks.get("t")).toMatchObject({ session: "new", resultTo: "filer" });
    });

    it("refuses a follow-up that names a session", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() => tasks.createTask({ id: "f", goal: "f", followUpOf: "root", session: "new" }));
      expect(refused.rule).toBe("follow_up_takes_no_session");
    });

    it("refuses a follow-up that names a workstream target, and files nothing: it runs where its root ran", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() => tasks.createTask({ id: "f", goal: "f", followUpOf: "root", target: "launch" }));
      expect(refused.rule).toBe("follow_up_takes_no_target");
      expect(tasks.get("f")).toBeUndefined();
    });

    it("runs a follow-up where its root ran: the root's session and workstream are written on the row", async () => {
      // A routed root (FIX-2083) ran in the delegate's ongoing session, or in a
      // workstream's. A follow-up keyed by the root task alone would open a new
      // session, without the root's history (FIX-2111).
      const { seed } = await makeBacking();
      const base = { attempts: 1, createdAt: 1_000, updatedAt: 1_000, revision: 2 } as const;
      const routed = { session: "ongoing", target: "launch", targetSessionId: "dsx_workstream" } as const;
      const tasks = await seed({ ...base, ...routed, id: "root", goal: "root", status: "completed", assignee: "writer", run: { sessionId: "dsx_workstream" } } as Task);
      await tasks.createTask({ id: "root-f1", goal: "shorter", assignee: "writer", followUpOf: "root" });
      expect(tasks.get("root-f1")).toMatchObject({ session: "ongoing", target: "launch", targetSessionId: "dsx_workstream" });
      // A follow-up of a root filed with no setting stays unset.
      await tasks.createTask({ id: "plain", goal: "plain", assignee: "writer" });
      await tasks.createTask({ id: "plain-f1", goal: "more", assignee: "writer", followUpOf: "plain" });
      expect(tasks.get("plain-f1")?.session).toBeUndefined();
      expect(tasks.get("plain-f1")?.targetSessionId).toBeUndefined();
    });

    it("delivers a follow-up's result where its root's went: a conversation result, with one attempt (FIX-2122)", async () => {
      // A routed root's answer lands in the conversation as the delegate's
      // reply. Its follow-up's must too, not as a notice about a task.
      const { seed } = await makeBacking();
      const base = { attempts: 1, createdAt: 1_000, updatedAt: 1_000, revision: 2 } as const;
      const tasks = await seed({ ...base, id: "root", goal: "root", status: "completed", assignee: "writer", resultTo: "conversation", maxAttempts: 1, run: { sessionId: "dsx_s" } } as Task);
      // The filer's default attempts don't make it a retried conversation result.
      await tasks.createTask({ id: "root-f1", goal: "shorter", assignee: "writer", followUpOf: "root", maxAttempts: 3 });
      expect(tasks.get("root-f1")).toMatchObject({ resultTo: "conversation", maxAttempts: 1 });
      // A root whose result went to its filer leaves the follow-up's there too.
      await tasks.createTask({ id: "plain", goal: "plain", assignee: "writer", maxAttempts: 3 });
      await tasks.createTask({ id: "plain-f1", goal: "more", assignee: "writer", followUpOf: "plain", maxAttempts: 3 });
      expect(tasks.get("plain-f1")?.resultTo).toBeUndefined();
      expect(tasks.get("plain-f1")?.maxAttempts).toBe(3);
    });

    it("refuses a follow-up that names where its result goes, and files nothing", async () => {
      const { tasks } = await makeBacking();
      const refused = await refusal(() => tasks.createTask({ id: "f", goal: "f", followUpOf: "root", resultTo: "filer" }));
      expect(refused.rule).toBe("follow_up_takes_no_result_to");
      expect(tasks.get("f")).toBeUndefined();
    });
  });

  describe("the dependents cascade", () => {
    it("cancels a failed task's dependents down the chain, labelled skipped, naming the cause", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTasks([
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
      await tasks.createTasks([
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
      await tasks.createTasks([
        { id: "a", goal: "a", maxAttempts: 2 },
        { id: "b", goal: "b", deps: ["a"] },
      ]);
      await claimAndFail(tasks);
      expect(tasks.get("a")?.status).toBe("pending");
      expect(tasks.get("b")?.status).toBe("pending");
    });

    it("cancels a held dependent too: it would wait on a task that will never finish", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTasks([
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

  describe("a row filed skipped", () => {
    it("keeps the cause and the reason only on a row filed cancelled: a live row names no cause", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTasks([
        { id: "skipped", goal: "skipped", status: "cancelled", causedBy: "gone", error: "dep gone failed" },
        { id: "live", goal: "live", causedBy: "gone", error: "dep gone failed" },
      ]);
      expect(tasks.get("skipped")).toMatchObject({ status: "cancelled", causedBy: "gone", error: "dep gone failed" });
      expect(tasks.get("live")?.status).toBe("pending");
      expect(tasks.get("live")?.causedBy).toBeUndefined();
      expect(tasks.get("live")?.error).toBeUndefined();
    });

    it("names no cause on a row filed cancelled and held: it is stored held, not skipped", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTask({ id: "h", goal: "h", held: true, status: "cancelled", causedBy: "gone", error: "dep gone failed" });
      expect(tasks.get("h")?.status).toBe("held");
      expect(tasks.get("h")?.causedBy).toBeUndefined();
      expect(tasks.get("h")?.error).toBeUndefined();
    });
  });

  describe("attempts", () => {
    it("fails a task filed with three attempts after its third failure", async () => {
      const { tasks } = await makeBacking();
      await tasks.createTask({ id: "t", goal: "t", maxAttempts: 3 });
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
    // The block's reason is kept where nothing hands it to a worker: a
    // worker reads `feedback` as what to fix, and `error` as a failure.
    expect(tasks.get("t")).toMatchObject({ status: "held", metadata: { heldReason: "waiting on legal" } });
    expect(tasks.get("t")?.error).toBeUndefined();
    expect(tasks.get("t")?.feedback).toBeUndefined();
    expect(await tasks.claim("w")).toBeNull();

    await tasks.release("t");
    const claimed = await tasks.claim("w");
    expect(claimed?.id).toBe("t");
    expect(claimed?.feedback).toBeUndefined();
  });

  it("releases a blocked row that had already been retried, and refuses only its edits", async () => {
    // `blocked` was reachable from a retry's `pending`, so a stored blocked
    // row can carry attempts. Leaving held isn't an edit of the filing: it
    // is how the row starts again, so it is never refused as started.
    const { seed } = await makeBacking();
    const tasks = await seed({ ...stored, attempts: 1, id: "t", goal: "t", status: "blocked", error: "waiting on legal" } as unknown as Task);
    expect(tasks.get("t")?.status).toBe("held");
    expect(await tasks.patchSettings("t", { held: false, maxAttempts: 3 })).toMatchObject({ outcome: "declined", reason: "started" });
    expect(await tasks.release("t")).toEqual({ outcome: "recorded" });
    expect(tasks.get("t")?.status).toBe("pending");
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

  it("reads every retired shape in the current one: a stored post as a routed task, and a reopened row as pending", async () => {
    const { seed } = await makeBacking();
    await seed({ ...stored, id: "p", goal: "p", status: "pending", sealed: { kind: "post" } } as unknown as Task);
    const tasks = await seed({ ...stored, id: "r", goal: "r", status: "pending", reopened: true } as unknown as Task);
    // On since FIX-2083: a stored post row reads as a task in the delegate's ongoing session, its result to the conversation.
    expect(tasks.get("p")).toMatchObject({ session: "ongoing", resultTo: "conversation" });
    // On since FIX-2086: a reopened row reads as pending with a steer for its line.
    expect(tasks.get("r")).toMatchObject({ status: "pending", steers: [expect.objectContaining({ id: "reopened", from: "user" })] });
    expect(tasks.get("r")).not.toHaveProperty("reopened");
    // No parked row is read: stores were reset when the status was retired (FIX-2131).
  });
});

/**
 * A dependency that ends while its dependent is being written, on the
 * resource backing (review finding 1). The dependency check reads the board
 * before the write, outside any write, and the ending's cascade reads it
 * inside its own write: a cancel that commits between the two sees no
 * dependent, and the check saw no ending. Gates hold the dependent's write
 * open in that window, as a slow store does.
 */
describe("a dependency that ends while its dependent is written (resource-backed)", () => {
  type Gate = { opened: Promise<void>; open: () => void };
  const gate = (): Gate => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  };

  async function slowBoard() {
    const collection: ResourceCollectionRef<JsonObject> = createFakeResourceCollection();
    const gates: { create?: Gate; createReached?: Gate; update?: { key: string; gate: Gate; computed: Gate } } = {};
    // Every ref the board holds holds its update open at the gate, after the
    // new state is computed and before it is stored.
    const slowRef = (ref: ResourceRef<JsonObject>): ResourceRef<JsonObject> =>
      new Proxy(ref, {
        get(target, prop, receiver) {
          if (prop !== "updateState") return Reflect.get(target, prop, receiver);
          return (updater: (prev: JsonObject) => JsonObject | Promise<JsonObject>) =>
            target.updateState(async (prev) => {
              const next = await updater(prev);
              const held = gates.update;
              if (held !== undefined && held.key === target.path) {
                held.computed.open();
                await held.gate.opened;
              }
              return next;
            });
        },
      });
    const realCreate = collection.create.bind(collection);
    const realList = collection.list.bind(collection);
    Object.assign(collection, {
      create: async (key: string, initial: JsonObject) => {
        gates.createReached?.open();
        if (gates.create !== undefined) await gates.create.opened;
        return slowRef(await realCreate(key, initial));
      },
      list: async (prefix?: string) => (await realList(prefix)).map(slowRef),
    });
    const tasks = await createResourceBackedTaskCollection({ collectionId: "tasks", collection, now: () => 1_000 });
    return { tasks, gates };
  }

  it("cancels a dependent whose dependency was cancelled while it was being filed", async () => {
    const { tasks, gates } = await slowBoard();
    await tasks.createTask({ id: "a", goal: "a" });
    gates.create = gate();
    gates.createReached = gate();
    const filing = tasks.createTask({ id: "b", goal: "b", deps: ["a"] });
    // Past the filing's dependency check, at its write: the check saw "a" open.
    await gates.createReached.opened;
    await tasks.cancel("a");
    gates.create.open();
    await filing;
    expect(tasks.get("b")).toMatchObject({ status: "cancelled", causedBy: "a", labels: ["skipped"] });
  });

  it("cancels a dependent whose new dependency was cancelled while the edit was being written", async () => {
    const { tasks, gates } = await slowBoard();
    await tasks.createTask({ id: "a", goal: "a" });
    await tasks.createTask({ id: "b", goal: "b", held: true });
    gates.update = { key: "b", gate: gate(), computed: gate() };
    const editing = tasks.patchSettings("b", { deps: ["a"] });
    await gates.update.computed.opened;
    const held = gates.update;
    gates.update = undefined;
    await tasks.cancel("a");
    held.gate.open();
    await editing;
    expect(tasks.get("b")).toMatchObject({ status: "cancelled", causedBy: "a", labels: ["skipped"] });
  });
});

describe("the debt an ending records (FIX-2080 D2)", () => {
  it("carries the ending's time, so a late payment can tell that ending's work from the next attempt's", async () => {
    const clock = { at: 5_000 };
    // A filed half that is never paid leaves the debt on the row to read.
    const tasks = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      now: () => clock.at,
      cascadeFiled: { owes: () => true, pay: async () => false },
    });
    await tasks.createTask({ id: "t", goal: "t", maxAttempts: 2 });
    const claimed = (await tasks.claim("w"))!;
    clock.at = 6_000;
    await tasks.fail(claimed.id, "boom", { claim: ticketForClaim("tasks", claimed) });
    expect(tasks.get("t")).toMatchObject({ status: "pending", cascadeOwed: { due: 6_000 + CASCADE_DUE_MS, endedAt: 6_000 } });
  });
});

/**
 * Two processes over one store (review finding 1, Codex A). A process's board
 * reads its own mirror, so an ending in a process that has never seen the
 * dependent records no debt for it. The next touch, in either process, reads
 * the committed rows and cancels an open row whose dependency has ended.
 */
describe("a dependent another process filed (resource-backed)", () => {
  it("is cancelled on the next touch after its dependency ends in a process that never saw it", async () => {
    const store: ResourceCollectionRef<JsonObject> = createFakeResourceCollection();
    // Each process holds its own handle on the one store, and so its own mirror.
    const open = () => createResourceBackedTaskCollection({ collectionId: "tasks", collection: { ...store }, now: () => 1_000 });
    const first = await open();
    await first.createTask({ id: "a", goal: "a" });
    // The second process loads the board before the dependent exists.
    const second = await open();
    await first.createTask({ id: "b", goal: "b", deps: ["a"] });
    await second.cancel("a");
    expect(second.get("a")?.cascadeOwed).toBeUndefined();
    // Until a touch cancels it, the claim itself never starts a row behind an
    // ended dependency: a board's drain pays its debts after its workers.
    expect(await first.claim("w")).toBeNull();

    await second.payOwedCascades!();
    const fresh = await open();
    expect(fresh.get("b")).toMatchObject({ status: "cancelled", causedBy: "a", labels: ["skipped"] });
  });
});

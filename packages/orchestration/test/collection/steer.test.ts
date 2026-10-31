/** `steer` and `takeSteers` on both backings (FIX-2086). */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  MAX_STEERS,
  ticketForClaim,
  untakenSteers,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

type Backing = { tasks: TaskCollectionRef; events: TaskChangeEvent[]; setNow: (at: number) => void };

async function sequencerBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  let clock = 1000;
  const tasks = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    onChange: (event) => events.push(event),
    now: () => clock,
  });
  return { tasks, events, setNow: (at) => (clock = at) };
}

async function resourceBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  let clock = 1000;
  const tasks = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: (event) => events.push(event),
    now: () => clock,
  });
  return { tasks, events, setNow: (at) => (clock = at) };
}

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const)("steer (%s)", (_name, makeBacking) => {
  it("keeps the words on a task that hasn't started, and changes nothing else", async () => {
    const { tasks, events } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "count the rows" });
    const before = tasks.get("t") as Task;

    const outcome = await tasks.steer!("t", { message: "Use the North America numbers", from: "filer" });

    expect(outcome).toEqual({ outcome: "recorded" });
    const row = tasks.get("t") as Task;
    expect(row.steers).toEqual([
      expect.objectContaining({ message: "Use the North America numbers", from: "filer", at: 1000 }),
    ]);
    expect(row.steers![0]!.takenBy).toBeUndefined();
    expect({ status: row.status, attempts: row.attempts, goal: row.goal }).toEqual({
      status: before.status,
      attempts: before.attempts,
      goal: before.goal,
    });
    expect(events.at(-1)).toMatchObject({ kind: "steered", taskId: "t" });
  });

  it("names its sender: a user from a screen or the task's session, by id", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    await tasks.steer!("t", { message: "shorter", from: "user", by: "u_alice" });
    expect((tasks.get("t") as Task).steers).toEqual([expect.objectContaining({ from: "user", by: "u_alice" })]);
  });

  it.each(["completed", "errored", "cancelled"] as const)(
    "refuses a %s task, and writes nothing: its output never changes",
    async (ending) => {
      const { tasks, events } = await makeBacking();
      await tasks.createTask({ id: "t", goal: "t" });
      const claimed = (await tasks.claim("w"))!;
      const claim = { claim: ticketForClaim("tasks", claimed) };
      if (ending === "completed") await tasks.complete("t", "the answer", claim);
      if (ending === "errored") await tasks.fail("t", "boom", claim);
      if (ending === "cancelled") await tasks.cancel("t");
      const settled = JSON.stringify(tasks.get("t"));
      const published = events.length;

      const outcome = await tasks.steer!("t", { message: "make it shorter", from: "user" });

      expect(outcome).toEqual({ outcome: "declined", reason: "terminal", status: ending });
      expect(JSON.stringify(tasks.get("t"))).toBe(settled);
      expect(events).toHaveLength(published);
    }
  );

  it(`refuses the steer past ${MAX_STEERS}, naming the limit`, async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    for (let i = 0; i < MAX_STEERS; i += 1) {
      expect(await tasks.steer!("t", { message: `steer ${i}`, from: "filer" })).toEqual({ outcome: "recorded" });
    }
    expect(await tasks.steer!("t", { message: "one too many", from: "filer" })).toEqual({
      outcome: "declined",
      reason: "steer-limit",
      status: "pending",
    });
    expect((tasks.get("t") as Task).steers).toHaveLength(MAX_STEERS);
  });

  it("a steer sent again under its key adds nothing", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    expect(await tasks.steer!("t", { message: "once", from: "user", key: "turn-1" })).toEqual({ outcome: "recorded" });
    expect(await tasks.steer!("t", { message: "once", from: "user", key: "turn-1" })).toEqual({ outcome: "unchanged" });
    expect((tasks.get("t") as Task).steers).toHaveLength(1);
  });

  it("uses no attempt and keeps the claim and lease of a running task", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    const claimed = (await tasks.claim("w", { leaseDurationMs: 10_000 }))!;

    await tasks.steer!("t", { message: "the next step", from: "filer" });

    const row = tasks.get("t") as Task;
    expect(row).toMatchObject({ status: "in_progress", attempts: 1, leaseUntil: claimed.leaseUntil });
    expect(row.claimedBy).toEqual(claimed.claimedBy);
    expect(untakenSteers(row).map((steer) => steer.message)).toEqual(["the next step"]);
  });

  it("a task waiting on its filed work now waits on the steer: a turn is owed for it", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    const claimed = (await tasks.claim("w", { leaseDurationMs: 10_000 }))!;
    await tasks.setKeptOpenBy!("t", "filed", { claim: ticketForClaim("tasks", claimed) });

    await tasks.steer!("t", { message: "and the totals", from: "filer" });

    expect(tasks.get("t")).toMatchObject({ status: "in_progress", keptOpenBy: "steer", attempts: 1 });
    expect((tasks.get("t") as Task).leaseUntil).toBeUndefined();
  });

  it("a task waiting on a person keeps waiting: the resume takes the steer", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    const claimed = (await tasks.claim("w", { leaseDurationMs: 10_000 }))!;
    await tasks.setKeptOpenBy!("t", "suspended", { claim: ticketForClaim("tasks", claimed) });

    await tasks.steer!("t", { message: "use the draft", from: "filer" });

    expect(tasks.get("t")).toMatchObject({ keptOpenBy: "suspended" });
  });

  it("the claim marks every steer taken by the attempt it starts, so a retry's brief carries them all", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t", maxAttempts: 2 });
    await tasks.steer!("t", { message: "first", from: "filer" });
    const first = (await tasks.claim("w"))!;
    expect(first.steers!.map((steer) => steer.takenBy)).toEqual([1]);

    await tasks.steer!("t", { message: "second", from: "filer" });
    await tasks.fail("t", "boom", { claim: ticketForClaim("tasks", first) });
    const second = (await tasks.claim("w"))!;

    expect(second.attempts).toBe(2);
    expect(second.steers!.map((steer) => [steer.message, steer.takenBy])).toEqual([
      ["first", 2],
      ["second", 2],
    ]);
    expect(untakenSteers(second)).toEqual([]);
  });

  it("takeSteers marks what arrived since the claim, once, for the attempt that holds it", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    const claimed = (await tasks.claim("w"))!;
    const claim = ticketForClaim("tasks", claimed);
    await tasks.steer!("t", { message: "late", from: "filer" });

    const [late] = (tasks.get("t") as Task).steers!;
    // The write names what it took, so a caller shows exactly that.
    expect(await tasks.takeSteers!("t", { claim, takenIn: "step:r1" })).toEqual({ outcome: "recorded", taken: [late!.id] });
    const row = tasks.get("t") as Task;
    expect(row.steers).toEqual([expect.objectContaining({ message: "late", takenBy: 1, takenIn: "step:r1" })]);
    // Taken already: a second take writes nothing, names nothing, and the first keeps it.
    expect(await tasks.takeSteers!("t", { claim, takenIn: "step:r2" })).toEqual({ outcome: "unchanged", taken: [] });
    expect((tasks.get("t") as Task).steers![0]!.takenIn).toBe("step:r1");
  });

  it.each([
    ["the row was claimed again", true],
    ["the lease lapsed", false],
  ] as const)(
    "a fenced complete from an attempt that lost the row declines as lost-claim, not for the steer: %s",
    async (_how, reclaim) => {
      const { tasks, setNow } = await makeBacking();
      await tasks.createTask({ id: "t", goal: "t" });
      const stale = ticketForClaim("tasks", (await tasks.claim("w", { leaseDurationMs: 10_000 }))!);
      setNow(1000 + 10_000);
      if (reclaim) expect((await tasks.claim("w2", { leaseDurationMs: 10_000 }))?.attempts).toBe(2);
      await tasks.steer!("t", { message: "for whoever holds it", from: "filer" });

      // `untaken-steers` would owe the stale attempt a turn for a steer it can't take.
      expect(await tasks.complete("t", "done", { ifAllowed: true, claim: stale, refuseUntakenSteers: true })).toMatchObject({
        outcome: "declined",
        reason: "lost-claim",
      });
    }
  );

  it("takeSteers is fenced to the claim: a displaced attempt takes nothing", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "t" });
    const claimed = (await tasks.claim("w"))!;
    const stale = ticketForClaim("tasks", claimed);
    await tasks.cancel("t");

    expect(await tasks.takeSteers!("t", { claim: stale, takenIn: "step:r1" })).toMatchObject({
      outcome: "declined",
      reason: "terminal",
    });
  });
});

/**
 * A person's retry of a failed or cancelled task (FIX-2383): the same row back
 * to waiting, with its id, history and spend, and one more attempt counted in
 * the board's one retry ledger.
 *
 * Why each check matters: a Retry button that minted a new row would lose the
 * task's conversation and spend and step around its budget, which is what
 * apps had to do before. A retry that reopened a completed task would change
 * an output every filer already read as final.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

type Backing = { tasks: TaskCollectionRef; events: TaskChangeEvent[] };

async function sequencerBacking(maxTotalRetries?: number): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  const tasks = createStateBackedTaskCollection({
    collectionId: "tasks",
    state: sequencer,
    onChange: (event) => events.push(event),
    now: () => 1000,
    ...(maxTotalRetries !== undefined ? { maxTotalRetries } : {}),
  });
  return { tasks, events };
}

async function resourceBacking(): Promise<Backing> {
  const events: TaskChangeEvent[] = [];
  const tasks = await createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: (event) => events.push(event),
    now: () => 1000,
  });
  return { tasks, events };
}

const BACKINGS = [
  ["sequencer-backed", () => sequencerBacking()],
  ["resource-backed", resourceBacking],
] as const;

/** Claim `id` and fail it: one whole failed attempt. */
async function claimAndFail(tasks: TaskCollectionRef, id: string, error: string): Promise<void> {
  const claimed = await tasks.claim("w", { leaseDurationMs: 10_000 });
  expect(claimed?.id).toBe(id);
  await tasks.fail(id, error);
}

describe.each(BACKINGS)("retrying a task (%s)", (_name, makeBacking) => {
  it("puts a failed task back to waiting with its id and history, and the failure as feedback", async () => {
    const { tasks, events } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.steer!("t", { message: "use the staging key", from: "user" });
    await claimAndFail(tasks, "t", "no model key");
    const failed = tasks.get("t") as Task;
    expect(failed.status).toBe("errored");

    expect(await tasks.retry!("t")).toEqual({ outcome: "recorded" });

    const retried = tasks.get("t") as Task;
    expect(retried).toMatchObject({ id: "t", status: "pending", feedback: "no model key", attempts: 1 });
    expect(retried.error).toBeUndefined();
    expect(retried.completedAt).toBeUndefined();
    expect(retried.retryLedger).toEqual({ granted: 1, deniedByBudget: false });
    // Everything the retry doesn't reset is the failed row's: steers, spend, output, filing.
    const { status: _s, feedback: _f, error: _e, completedAt: _c, retryLedger: _r, updatedAt: _u, revision: _v, writeLog: _w, ...keptAfter } = retried as Task & Record<string, unknown>;
    const { status: _s2, feedback: _f2, error: _e2, completedAt: _c2, retryLedger: _r2, updatedAt: _u2, revision: _v2, writeLog: _w2, ...keptBefore } = failed as Task & Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(keptAfter))).toEqual(JSON.parse(JSON.stringify(keptBefore)));
    expect(retried.steers?.map((steer) => steer.message)).toEqual(["use the staging key"]);
    expect(events.at(-1)).toMatchObject({ kind: "retry_requested", taskId: "t" });
  });

  it("runs once more as a new attempt, and a second failure settles it again", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops" });
    await claimAndFail(tasks, "t", "first");
    await tasks.retry!("t");

    const again = await tasks.claim("w", { leaseDurationMs: 10_000 });
    expect(again).toMatchObject({ id: "t", attempts: 2 });
    await tasks.fail("t", "second");
    // One press, one try: no `maxAttempts` budget, so the second failure ends it.
    expect(tasks.get("t")).toMatchObject({ status: "errored", error: "second", attempts: 2 });
  });

  it("keeps attempts a task had left", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops", maxAttempts: 3 });
    await tasks.claim("w", { leaseDurationMs: 10_000 });
    await tasks.cancel("t", "wrong repo");
    await tasks.retry!("t");
    // A cancel's reason is not feedback for the next attempt.
    expect(tasks.get("t")).toMatchObject({ status: "pending", maxAttempts: 3 });
    expect(tasks.get("t")!.feedback).toBeUndefined();

    await claimAndFail(tasks, "t", "flaky");
    // Attempt 2 of 3 failed: still a soft retry.
    expect(tasks.get("t")!.status).toBe("pending");
  });

  it("brings back a task cancelled before it started", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops" });
    await tasks.cancel("t");
    expect(await tasks.retry!("t")).toEqual({ outcome: "recorded" });
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("t");
  });

  it.each(["pending", "in_progress", "held", "completed"] as const)("refuses a %s task and writes nothing", async (status) => {
    const { tasks, events } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops", ...(status === "held" ? { held: true } : {}) });
    if (status === "in_progress" || status === "completed") await tasks.claim("w", { leaseDurationMs: 10_000 });
    if (status === "completed") await tasks.complete("t", { done: true });
    const before = JSON.stringify(tasks.get("t"));
    const count = events.length;

    expect(await tasks.retry!("t")).toEqual({ outcome: "declined", reason: "disallowed", status });
    expect(JSON.stringify(tasks.get("t"))).toBe(before);
    expect(events).toHaveLength(count);
  });

  it("frees the last attempt's resumed wait, so the next attempt's wait and ending reach their request", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops" });
    expect(await tasks.markWait!("t", { gateId: "g1", deadline: 5000, requestId: "r1" })).toEqual({ outcome: "recorded" });
    await claimAndFail(tasks, "t", "first");
    expect(await tasks.retry!("t")).toEqual({ outcome: "declined", reason: "settling", status: "errored" });
    await tasks.clearResumeOwed!("t");

    expect(await tasks.retry!("t")).toEqual({ outcome: "recorded" });
    expect(tasks.get("t")!.wait).toBeUndefined();
    expect(await tasks.markWait!("t", { gateId: "g2", deadline: 5000, requestId: "r2" })).toEqual({ outcome: "recorded" });
    await claimAndFail(tasks, "t", "second");
    // The second ending resumes the second wait, not a gate long resolved.
    expect(tasks.get("t")).toMatchObject({ resumeOwed: true, wait: { gateId: "g2", requestId: "r2" } });
  });

  it("refuses a skipped dependent until its dependency is retried, then clears the skip", async () => {
    const { tasks } = await makeBacking();
    await tasks.createTasks([
      { id: "a", goal: "a" },
      { id: "b", goal: "b", deps: ["a"] },
    ]);
    await claimAndFail(tasks, "a", "boom");
    await tasks.payOwedCascades?.();
    expect(tasks.get("b")).toMatchObject({ status: "cancelled", causedBy: "a", labels: ["skipped"] });

    expect(await tasks.retry!("b")).toEqual({ outcome: "declined", reason: "dependency-ended", status: "cancelled" });

    await tasks.retry!("a");
    expect(await tasks.retry!("b")).toEqual({ outcome: "recorded" });
    const b = tasks.get("b") as Task;
    expect(b.status).toBe("pending");
    expect(b.causedBy).toBeUndefined();
    expect(b.labels ?? []).not.toContain("skipped");
    // It waits on its dependency again: `a` runs first.
    expect((await tasks.claim("w", { leaseDurationMs: 10_000 }))?.id).toBe("a");
  });
});

describe("retrying on a board with a retry budget (sequencer-backed)", () => {
  it("counts a person's retry against maxTotalRetries, and refuses one past it", async () => {
    const { tasks } = await sequencerBacking(1);
    await tasks.createTasks([
      { id: "a", goal: "a" },
      { id: "b", goal: "b" },
    ]);
    await claimAndFail(tasks, "a", "boom");
    await claimAndFail(tasks, "b", "boom");

    expect(await tasks.retry!("a")).toEqual({ outcome: "recorded" });
    expect(await tasks.retry!("b")).toEqual({ outcome: "declined", reason: "retry-budget", status: "errored" });
    expect(tasks.get("b")!.retryLedger).toBeUndefined();
  });
});

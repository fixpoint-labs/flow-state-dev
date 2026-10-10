/**
 * An answered question is not a retry, and its next attempt knows it was
 * answered (FIX-1817 S3, and the marker S5 reads).
 *
 * A worker that parks its task on a question hands the row back; the answer
 * re-queues it (`unpark(..., { answer: true })`) and the next claim re-enters
 * the same task. That claim advances `attempts` like every claim, so without
 * the discount a task filed with one attempt would end `errored` on its first
 * real failure after being answered: an answer would cost a retry. The answer
 * is also handed to the next attempt as its answer (`answered`), and only to
 * that one: a failure after it is handed back as a failure, not as an answer.
 */
import { describe, expect, it } from "vitest";
import {
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
} from "../../src/tasks";
import { createCapturedChanges, createFakeResourceCollection, createFakeSequencerState } from "../helpers";
import { shouldRetryOnFail } from "../../src/tasks/collection/internal";

async function sequencerBacking(): Promise<TaskCollectionRef> {
  const sequencer = createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} });
  return createStateBackedTaskCollection({
    collectionId: "tasks",
    state: sequencer,
    onChange: createCapturedChanges().onChange,
    now: () => 1000,
  });
}

async function resourceBacking(): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({
    collectionId: "tasks",
    collection: createFakeResourceCollection(),
    onChange: createCapturedChanges().onChange,
    now: () => 1000,
  });
}

const BACKINGS = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
] as const;

const LEASE = 10_000;

/** Claim `t` and park it on a question, fenced by the claim, as `parkOnQuestion` does. */
async function claimThenAsk(tasks: TaskCollectionRef, question = "Which region?"): Promise<Task> {
  const claimed = (await tasks.claim("w", { leaseDurationMs: LEASE }))!;
  const parked = await tasks.awaitReview("t", question, { claim: ticketForClaim("tasks", claimed) });
  expect(parked.outcome).toBe("recorded");
  return tasks.get("t") as Task;
}

describe.each(BACKINGS)("an answered question (%s)", (_name, makeBacking) => {
  it("re-queues the row with the answer, counts one re-entry and marks the answer", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 1 });
    await claimThenAsk(tasks);

    const answered = await tasks.unpark("t", "eu-west", { answer: true });
    expect(answered.outcome).toBe("recorded");
    const row = tasks.get("t") as Task;
    expect(row).toMatchObject({ status: "pending", feedback: "eu-west", answered: true, turnReentries: 1 });
  });

  it("a task with maxAttempts 1, answered twice and then failing once, ends errored after that one failure, not before", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 1 });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "eu-west", { answer: true });
    await claimThenAsk(tasks, "Which account?");
    await tasks.unpark("t", "ops", { answer: true });
    const third = (await tasks.claim("w", { leaseDurationMs: LEASE }))!;
    expect(third.attempts).toBe(3);
    // Two answers, no failure yet: the third claim is the first one charged.
    expect(third.attempts - (third.turnReentries ?? 0)).toBe(1);
    // The marker survives the claim: the attempt it is handed to is the answered one.
    expect(third.answered).toBe(true);

    await tasks.fail("t", "boom", { claim: ticketForClaim("tasks", third) });
    expect((tasks.get("t") as Task).status).toBe("errored");
  });

  it("with maxAttempts 2, answered twice, a first failure is retried and only the second ends it", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 2 });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "eu-west", { answer: true });
    await claimThenAsk(tasks, "Which account?");
    await tasks.unpark("t", "ops", { answer: true });
    const third = (await tasks.claim("w", { leaseDurationMs: LEASE }))!;
    expect(shouldRetryOnFail(third)).toBe(true);
    await tasks.fail("t", "boom", { claim: ticketForClaim("tasks", third) });
    expect((tasks.get("t") as Task).status).toBe("pending");
    const fourth = (await tasks.claim("w", { leaseDurationMs: LEASE }))!;
    await tasks.fail("t", "boom again", { claim: ticketForClaim("tasks", fourth) });
    expect((tasks.get("t") as Task).status).toBe("errored");
  });

  it("an answer re-entry, then a failure with an attempt left, hands the failure back, not an answer", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 2 });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "eu-west", { answer: true });
    const second = (await tasks.claim("w", { leaseDurationMs: LEASE }))!;
    await tasks.fail("t", "tests failed", { claim: ticketForClaim("tasks", second) });
    const retried = tasks.get("t") as Task;
    expect(retried).toMatchObject({ status: "pending", feedback: "tests failed" });
    expect(retried.answered).toBeUndefined();
  });

  it("a plain unpark is not an answer: it charges as before and marks nothing", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 1 });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "approved");
    const row = tasks.get("t") as Task;
    expect(row.answered).toBeUndefined();
    expect(row.turnReentries).toBeUndefined();
  });

  it("a second park clears an earlier answer's mark", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 1 });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "eu-west", { answer: true });
    const parked = await claimThenAsk(tasks, "And the account?");
    expect(parked.answered).toBeUndefined();
    expect(parked.feedback).toBe("And the account?");
  });

  it("refuses, inside the write, to move an answered row to another worker until it is claimed again", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 2, assignee: "a" });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "eu-west", { answer: true });
    expect(await tasks.setAssignee("t", "b")).toMatchObject({ outcome: "declined", reason: "awaiting-answer" });
    expect((tasks.get("t") as Task).assignee).toBe("a");
    expect(await tasks.setAssignee("t", "a")).toMatchObject({ outcome: "unchanged" });
  });

  it("keeps the fence while an answered row is blocked before it runs again", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 2, assignee: "a" });
    await claimThenAsk(tasks);
    await tasks.unpark("t", "eu-west", { answer: true });
    await tasks.block("t", "hold on");
    expect((tasks.get("t") as Task)).toMatchObject({ status: "blocked", answered: true });
    expect(await tasks.setAssignee("t", "b")).toMatchObject({ outcome: "declined", reason: "awaiting-answer" });
    expect((tasks.get("t") as Task).assignee).toBe("a");
  });

  it("refuses, inside the write, to move a follow-up to another worker", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "f", goal: "f", assignee: "a", followUpOf: "root" });
    expect(await tasks.setAssignee("f", "b")).toMatchObject({ outcome: "declined", reason: "follow-up" });
    expect((tasks.get("f") as Task).assignee).toBe("a");
  });

  it("declines an answer to a row that isn't parked, writing nothing", async () => {
    const tasks = await makeBacking();
    await tasks.addTask({ id: "t", goal: "t", maxAttempts: 1 });
    const outcome = await tasks.unpark("t", "eu-west", { answer: true });
    expect(outcome).toMatchObject({ outcome: "declined", status: "pending" });
    expect((tasks.get("t") as Task).answered).toBeUndefined();
  });
});

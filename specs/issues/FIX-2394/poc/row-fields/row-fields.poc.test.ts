/**
 * POC for FIX-2394 — retained design evidence, not production code.
 *
 * The spec's scope rests on what a task row from the board's `listTasks`
 * action carries today, the read both labs draw their task lists from. This
 * re-derives those facts from the real action, with a totality assertion: the
 * row's keys are exactly the known list, so a field nobody named (a start
 * time, a step count) fails the run instead of passing unnoticed.
 *
 *   1. A running row carries `updatedAt` and its run link's `startedAt`, and no
 *      task-level `startedAt`, `completedAt` or `createdAt`. So `taskRowView`'s
 *      `times.startedAt` reads null on it, and the attempt's clock is the run's.
 *   2. A finished row carries no `completedAt` either.
 *   3. A lease renewal, the running request's heartbeat, moves `updatedAt`:
 *      on a running row, `updatedAt` says the run is alive, not that it moved.
 *   4. No row carries step progress (done of total).
 *
 * Negative control: `POC_PLANT=1` adds a `steps` key to each listed row before
 * the totality assertion, which must then fail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { taskToolActions } from "../../src/skills/task-tools-capability";
import { ticketForClaim } from "../../src/tasks";
import { taskRowView } from "../../src/inbox";
import { buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

/** Every key the action's row may carry today, from its output schema. */
const KNOWN_KEYS = new Set([
  "id", "goal", "title", "status", "assignee", "attempts", "statusNote", "filedByTask", "run",
  "spend", "updatedAt", "waitedOn", "keptOpenBy", "holds", "current",
]);

async function listed(ctx: unknown): Promise<Array<Record<string, any>>> {
  const actions = taskToolActions("desk", ownStateResolver);
  const caller = { ...(ctx as object), user: { identity: { userId: "u1" } } };
  const out = (await runForTest(actions["listTasks_desk"]!.block as never, {} as never, caller as never)) as { tasks: Array<Record<string, any>> };
  if (process.env.POC_PLANT === "1") for (const row of out.tasks) row.steps = { done: 2, total: 7 };
  return out.tasks;
}

function onlyKnownKeys(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) expect(KNOWN_KEYS.has(key), `unlisted key on a listTasks row: ${key}`).toBe(true);
}

afterEach(() => vi.useRealTimers());

describe("FIX-2394 · what a listTasks row carries", () => {
  it("a running row: updatedAt and run.startedAt, no task-level times, no steps; a renewal moves updatedAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const { ctx } = buildDelegationCtx({ self: false });
    const ref = (await ownStateResolver(ctx as never))!;
    await ref.createTask({ id: "t_run", goal: "Fix the login form" });
    vi.setSystemTime(1_010_000);
    const claimed = (await ref.claim("w", { leaseDurationMs: 120_000 }))!;
    const ticket = ticketForClaim(ref.collectionId, claimed);
    await ref.linkRun(claimed.id, { sessionId: "s_run", requestId: "q1", attempt: claimed.attempts, startedAt: 1_010_000 }, { claim: ticket });
    expect(ref.get("t_run")!.startedAt).toBe(1_010_000); // stored on the task...

    const [row] = await listed(ctx);
    onlyKnownKeys(row!);
    expect(row!.run.startedAt).toBe(1_010_000); // ...published only through the run link
    expect(row!.updatedAt).toBe(1_010_000);
    for (const key of ["startedAt", "completedAt", "createdAt", "steps", "progress"]) expect(key in row!).toBe(false);
    expect(taskRowView({ ...row!, board: "desk" } as never).times).toEqual({ createdAt: null, updatedAt: 1_010_000, startedAt: null, completedAt: null });

    // The heartbeat: a renewal 40s later, with nothing else written, moves updatedAt.
    vi.setSystemTime(1_050_000);
    const renewed = await ref.renewLease(claimed.id, 1_050_000 + 120_000, { claim: ticket });
    expect(renewed.outcome).not.toBe("declined");
    const [after] = await listed(ctx);
    expect(after!.updatedAt).toBe(1_050_000);
    expect(after!.statusNote).toBeUndefined();
  });

  it("a finished row carries no completedAt", async () => {
    const { ctx } = buildDelegationCtx({ self: false });
    const ref = (await ownStateResolver(ctx as never))!;
    await ref.createTask({ id: "t_done", goal: "Write the notes" });
    const claimed = (await ref.claim("w", { leaseDurationMs: 120_000 }))!;
    await ref.complete(claimed.id, { answer: "ok" }, { claim: ticketForClaim(ref.collectionId, claimed) } as never);
    expect(ref.get("t_done")!.completedAt).toBeTypeOf("number");
    const [row] = await listed(ctx);
    expect(row!.status).toBe("completed");
    onlyKnownKeys(row!);
    expect("completedAt" in row!).toBe(false);
  });
});

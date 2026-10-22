/**
 * A running request takes a steer before its next model call (FIX-2086): a
 * context entry, re-read before every call, takes what arrived since the
 * claim and shows it. It never stops the request and uses no attempt.
 */
import { describe, expect, it } from "vitest";
import { createSteerContext } from "../../src/skills/steer-context";
import { ticketForClaim, type Task, type TaskCollectionRef } from "../../src/tasks";
import { BOARD_FIELD, buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

/** A board, a running task `t` linked to request `requestId` in task session `s-task`, and that turn's context. */
async function runningTurn(requestId = "r-turn") {
  const { ctx } = buildDelegationCtx({ self: false });
  const ref = (await ownStateResolver(ctx as never))!;
  await ref.addTask({ id: "t", goal: "count the rows" });
  const claimed = (await ref.claim("w"))!;
  const ticket = ticketForClaim(BOARD_FIELD, claimed);
  await ref.linkRun("t", { sessionId: "s-task", requestId, attempt: claimed.attempts }, { claim: ticket });
  const turn = (id: string) => ({
    ...(ctx as object),
    session: { identity: { id: "s-task" }, state: { taskId: "t" } },
    request: { identity: { id } },
  });
  return { ref, ticket, turn, read: createSteerContext({ resolve: ownStateResolver }) };
}

const steer = (ref: TaskCollectionRef, message: string) => ref.steer!("t", { message, from: "filer" });

describe("the steer context entry", () => {
  it("shows nothing before a steer, then the steer on the next call, and keeps showing it in that request", async () => {
    const { ref, turn, read } = await runningTurn();
    expect(await read(undefined, turn("r-turn") as never)).toBeNull();

    await steer(ref, "Use the North America numbers");

    const next = await read(undefined, turn("r-turn") as never);
    expect(next).toContain("Use the North America numbers");
    expect(next).toContain("whoever assigned you the task");
    expect(ref.get("t")!.steers).toEqual([expect.objectContaining({ takenBy: 1, takenIn: "step:r-turn" })]);
    // Re-read before the call after: still shown, never taken twice.
    expect(await read(undefined, turn("r-turn") as never)).toBe(next);
    expect(ref.get("t")).toMatchObject({ status: "in_progress", attempts: 1 });
  });

  it("is not shown again by another request of the attempt once taken", async () => {
    const { ref, turn, read } = await runningTurn();
    await steer(ref, "Skip the archive");
    await read(undefined, turn("r-turn") as never);
    expect(await read(undefined, turn("r-other") as never)).toBeNull();
  });

  it("shows nothing outside a task turn, and takes nothing", async () => {
    const { ref, turn, read } = await runningTurn();
    await steer(ref, "Skip the archive");
    const notATask = { ...turn("r-turn"), session: { identity: { id: "s-conv" }, state: {} } };
    expect(await read(undefined, notATask as never)).toBeNull();
    expect((ref.get("t") as Task).steers![0]!.takenBy).toBeUndefined();
  });

  it("shows nothing once the task has ended", async () => {
    const { ref, turn, read } = await runningTurn();
    await steer(ref, "Skip the archive");
    await ref.cancel("t");
    expect(await read(undefined, turn("r-turn") as never)).toBeNull();
  });
});

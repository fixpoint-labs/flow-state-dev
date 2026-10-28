/** A running request's steer context entry (FIX-2086). */
import { describe, expect, it } from "vitest";
import { createSteerContext } from "../../src/skills/steer-context";
import { ticketForClaim, type Task, type TaskCollectionRef } from "../../src/tasks";
import { BOARD_FIELD, buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

/** A board, a running task `t` linked to request `requestId` in task session `s-task`, and that turn's context. */
async function runningTurn(requestId = "r-turn") {
  const { ctx } = buildDelegationCtx({ self: false });
  // One write at a time, as a real state ref's `atomicState` commits them:
  // the fixture's applies a write after its mutator has already read.
  const state = (ctx as { parent: { atomicState: (fn: (s: Record<string, unknown>) => unknown) => Promise<void> } }).parent;
  const atomic = state.atomicState.bind(state);
  let queue: Promise<unknown> = Promise.resolve();
  state.atomicState = (fn) => {
    const write = queue.then(() => atomic(fn));
    queue = write.catch(() => undefined);
    return write;
  };
  const ref = (await ownStateResolver(ctx as never))!;
  await ref.createTask({ id: "t", goal: "count the rows" });
  const claimed = (await ref.claim("w"))!;
  const ticket = ticketForClaim(BOARD_FIELD, claimed);
  await ref.linkRun("t", { sessionId: "s-task", requestId, attempt: claimed.attempts }, { claim: ticket });
  // The lines a turn shows in its session.
  const lines: Array<{ text: string; agentName?: string }> = [];
  const turn = (id: string) => ({
    ...(ctx as object),
    session: { identity: { id: "s-task" }, state: { taskId: "t" } },
    request: { identity: { id } },
    emit: { message: (text: string, options?: { agentName?: string }) => lines.push({ text, ...options }) },
  });
  return { ref, ticket, turn, lines, read: createSteerContext({ resolve: ownStateResolver }) };
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

  it("shows a taken steer once as a line in the task's session, from its sender; a line typed there is there already", async () => {
    const { ref, turn, lines, read } = await runningTurn();
    await steer(ref, "Use the North America numbers");
    await ref.steer!("t", { message: "Typed here.", from: "user", by: "alice", key: "line:r-door" });
    await ref.steer!("t", { message: "From the screen.", from: "user", by: "alice" });

    await read(undefined, turn("r-turn") as never);
    await read(undefined, turn("r-turn") as never);

    expect(lines).toEqual([
      { text: "Message from the task's filer: Use the North America numbers", agentName: "filer" },
      { text: "Message from alice: From the screen.", agentName: "alice" },
    ]);
  });

  it("shows a steer once when two reads of the same call run side by side: the line is the write's, not the read's", async () => {
    const { ref, turn, lines, read } = await runningTurn();
    await steer(ref, "Use the North America numbers");

    const [first, second] = await Promise.all([read(undefined, turn("r-turn") as never), read(undefined, turn("r-turn") as never)]);

    // Both reads give the model the steer; only the read whose write took it shows it.
    expect(first).toContain("Use the North America numbers");
    expect(second).toBe(first);
    expect(lines).toEqual([{ text: "Message from the task's filer: Use the North America numbers", agentName: "filer" }]);
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

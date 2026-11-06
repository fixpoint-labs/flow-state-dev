/**
 * `listTasks` carries a running row's `leaseUntil` on the board's action, a
 * client's read, and never on the model's tool.
 *
 * Why it matters: a screen tells a task whose run stopped answering from one
 * that is working by the board's own rule, `leaseLapsed` (the lease deadline
 * has passed), and a row the action listed must carry what that rule reads.
 * A lease renewal is the only sign of life a run in one long step gives, and
 * it moves `leaseUntil` forward; a model reading its board has no use for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { buildTaskToolsList, taskToolActions } from "../../src/skills/task-tools-capability";
import { leaseLapsed, ticketForClaim, type Task } from "../../src/tasks";
import { buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

afterEach(() => vi.useRealTimers());

describe("listTasks and a running row's lease", () => {
  it("answers leaseUntil on the action as the board holds it, so leaseLapsed reads the row as the board does; the tool carries none", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const { ctx } = buildDelegationCtx({ self: false });
    const ref = (await ownStateResolver(ctx as never))!;
    await ref.createTask({ id: "t_run", goal: "Fix the login form" });
    await ref.createTask({ id: "t_waits", goal: "Write the notes" });
    const claimed = (await ref.claim("w", { leaseDurationMs: 120_000 }))!;
    const other = claimed.id === "t_run" ? "t_waits" : "t_run";

    const actions = taskToolActions("desk", ownStateResolver);
    const caller = { ...(ctx as object), user: { identity: { userId: "u1" } } };
    const read = async () =>
      Object.fromEntries(
        ((await runForTest(actions["listTasks_desk"]!.block as never, {} as never, caller as never)) as { tasks: Array<Record<string, any>> }).tasks.map((t) => [t.id, t]),
      );

    let byId = await read();
    expect(byId[claimed.id]!.leaseUntil).toBe(1_120_000);
    expect(byId[claimed.id]!.leaseUntil).toBe(ref.get(claimed.id)!.leaseUntil);
    // A row nobody holds has no lease to show.
    expect("leaseUntil" in byId[other]!).toBe(false);

    // A renewal, the live run's heartbeat, moves it forward.
    vi.setSystemTime(1_040_000);
    await ref.renewLease(claimed.id, 1_040_000 + 120_000, { claim: ticketForClaim(ref.collectionId, claimed) });
    byId = await read();
    expect(byId[claimed.id]!.leaseUntil).toBe(1_160_000);

    // The listed row and the stored one agree on lapsed, either side of the deadline.
    const lapsed = (row: Record<string, any>, now: number) => leaseLapsed(row as Task, now);
    expect(lapsed(byId[claimed.id]!, 1_159_999)).toBe(false);
    expect(lapsed(byId[claimed.id]!, 1_160_000)).toBe(true);
    expect(leaseLapsed(ref.get(claimed.id)!, 1_160_000)).toBe(true);

    const told = (await runForTest(toolNamed(buildTaskToolsList(ownStateResolver), "listTasks"), {} as never, ctx)) as { tasks: Array<Record<string, unknown>> };
    expect(told.tasks).toHaveLength(2);
    for (const row of told.tasks) expect("leaseUntil" in row).toBe(false);
  });
});

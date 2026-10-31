/**
 * `listTasks` carries a task's spend on the board's action, a client's read,
 * and never on the model's tool (FIX-2288).
 *
 * Why it matters: a card or a sheet reads model, harness and tokens through
 * the action; a model reading its board has no use for token counts, and
 * every field on its tool output is context it pays for.
 */
import { describe, expect, it } from "vitest";
import type { GeneratorTool } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { buildTaskToolsList, taskToolActions } from "../../src/skills/task-tools-capability";
import { ticketForClaim } from "../../src/tasks";
import { buildDelegationCtx, ownStateResolver } from "./delegation-ctx";

function toolNamed(tools: readonly unknown[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool as GeneratorTool;
}

describe("listTasks and a task's spend", () => {
  it("answers spend on the action, folded, and leaves it off the tool", async () => {
    const { ctx } = buildDelegationCtx({ self: false });
    const ref = (await ownStateResolver(ctx as never))!;
    await ref.createTask({ id: "t_ran", goal: "Fix the login form" });
    await ref.createTask({ id: "t_waits", goal: "Write the notes" });
    const claimed = (await ref.claim("w", { leaseDurationMs: 10_000 }))!;
    await ref.recordSpend!(
      claimed.id,
      {
        requestId: "q1",
        part: "live",
        spend: { byModel: {}, harnessRuns: [{ runId: "r", harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 11_200, outputTokens: 1_240, costUsd: null, billing: "subscription" }] },
      },
      { claim: ticketForClaim(ref.collectionId, claimed) }
    );

    const actions = taskToolActions("desk", ownStateResolver);
    const caller = { ...(ctx as object), user: { identity: { userId: "u1" } } };
    const acted = (await runForTest(actions["listTasks_desk"]!.block as never, {} as never, caller as never)) as { tasks: Array<Record<string, unknown>> };
    const byId = Object.fromEntries(acted.tasks.map((t) => [t.id, t]));
    expect(byId[claimed.id]!.spend).toEqual({ harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 11_200, outputTokens: 1_240, costUsd: null, unreported: false, live: true });
    const other = claimed.id === "t_ran" ? "t_waits" : "t_ran";
    expect(byId[other]!.spend).toBeNull();

    const told = (await runForTest(toolNamed(buildTaskToolsList(ownStateResolver), "listTasks"), {} as never, ctx)) as { tasks: Array<Record<string, unknown>> };
    expect(told.tasks).toHaveLength(2);
    for (const row of told.tasks) expect("spend" in row).toBe(false);
  });
});

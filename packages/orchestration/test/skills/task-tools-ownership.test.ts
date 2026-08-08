/**
 * The ownership fence at the model-facing tool boundary (FIX-981).
 *
 * The substrate decides the refusal — these tools present a ticket and the one
 * guard inside the atomic write answers — so what is under test here is the
 * half the guard cannot do: reading the ticket off the worker's own scope
 * without the model supplying it, and rendering a refusal a model can act on.
 *
 * **Why this is its own file.** The board stamps a worker's claim with
 * `AsyncLocalStorage.enterWith`, which by design persists for the remainder of
 * the calling async chain — there is no scope to exit. Staging a claimed-worker
 * scope in a shared file would therefore leak into every test declared after
 * it. Isolating the stamped tests keeps that confined, and each one stamps its
 * own ticket so no test can pass on a neighbour's.
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { GeneratorTool } from "@flow-state-dev/core";
import { taskTools, DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";
import { stampCurrentClaim } from "../../src/task-board/flow-policy-wiring";
import { ticketForClaim, type Task } from "../../src/tasks";
import { buildDelegationCtx } from "./delegation-ctx";

/** Look up a tool by name from the capability's preset surface. */
function findTool(name: string): GeneratorTool {
  const presetDefs = (
    taskTools as unknown as {
      __presetDefs?: { tools?: { tools?: GeneratorTool[] } };
    }
  ).__presetDefs;
  const tool = presetDefs?.tools?.tools?.find((t) => t.config?.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

const CREATED_AT = 1_700_000_000_000;

/** An in-progress task on attempt 1 — the state a claimed worker's task is in. */
const inProgress = (id: string): Task =>
  ({
    id,
    goal: id,
    status: "in_progress",
    attempts: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }) as Task;

/**
 * A board holding "mine" and "theirs", both `in_progress` on attempt 1.
 *
 * Both on the same attempt is the point, not a coincidence: it is what a board
 * with two workers running looks like, and it is what made the pre-ticket
 * token satisfy the wrong task.
 */
function boardWithTwoClaimedTasks() {
  return buildDelegationCtx({
    self: false,
    preTasks: {
      mine: inProgress("mine"),
      theirs: inProgress("theirs"),
    },
  });
}

/** Stamp the worker scope as holding "mine" on the delegation board. */
function holdMine() {
  stampCurrentClaim(ticketForClaim(DELEGATION_BOARD_FIELD, inProgress("mine")));
}

describe("taskTools — a worker can only settle the task it holds", () => {
  it("refuses completeTask on a sibling's task and names the one the caller holds", async () => {
    const { ctx, selfState } = boardWithTwoClaimedTasks();
    holdMine();

    const result = (await runForTest(
      findTool("completeTask"),
      { taskId: "theirs", output: "written by the wrong worker" },
      ctx,
    )) as { ok: boolean; taskId: string; error: string };

    expect(result.ok).toBe(false);
    expect(result.taskId).toBe("theirs");
    // The refusal has to name the task the caller HOLDS, not just the one it
    // aimed at. A model told only "refused (not-my-task)" has nothing to
    // correct itself with; told which task is its own, it retries on the right
    // id. This is why `not-my-task` gets a branch instead of the generic path.
    expect(result.error).toContain('you hold task "mine"');
    expect(result.error).toContain('not "theirs"');

    // Nothing was written. A refusal that still landed the payload would be
    // the defect wearing an error message.
    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, Task>;
    expect(board.theirs?.status).toBe("in_progress");
    expect(board.theirs?.output).toBeUndefined();
  });

  it.each(["failTask", "blockTask", "cancelTask"] as const)(
    "refuses %s on a sibling's task",
    async (toolName) => {
      // The whole status-changing surface, not just the two that had an options
      // argument before this change. `blockTask` in particular could not carry
      // a token at all, and `cancelTask` hard-coded its guards and dropped the
      // caller's.
      const { ctx, selfState } = boardWithTwoClaimedTasks();
      holdMine();

      const result = (await runForTest(
        findTool(toolName),
        { taskId: "theirs", error: "not mine", reason: "not mine" },
        ctx,
      )) as { ok: boolean; error: string };

      expect(result.ok).toBe(false);
      expect(result.error).toContain('you hold task "mine"');
      const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, Task>;
      expect(board.theirs?.status).toBe("in_progress");
    },
  );

  it("permits the holder's write to its own task", async () => {
    // The control. A fence that refused everything would satisfy every
    // assertion above while breaking every board that works today.
    const { ctx, selfState } = boardWithTwoClaimedTasks();
    holdMine();

    const result = (await runForTest(
      findTool("completeTask"),
      { taskId: "mine", output: "written by its holder" },
      ctx,
    )) as { ok: boolean };

    expect(result.ok).toBe(true);
    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, Task>;
    expect(board.mine?.status).toBe("completed");
    expect(board.mine?.output).toBe("written by its holder");
  });

  it("refuses a stale ticket for the caller's own task as lost-claim, not not-my-task", async () => {
    // Two different failures with two different fixes, so they must not
    // collapse into one message. This ticket names the right task; what it no
    // longer has is the live attempt.
    const { ctx } = buildDelegationCtx({
      self: false,
      preTasks: { mine: { ...inProgress("mine"), attempts: 2 } as Task },
    });
    holdMine(); // still holding attempt 1

    const result = (await runForTest(
      findTool("completeTask"),
      { taskId: "mine", output: "stale" },
      ctx,
    )) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("lost-claim");
    expect(result.error).not.toContain("you hold task");
  });

  it("leaves the patch-path tools unguarded, so a live block can still label work it does not hold", async () => {
    // Deliberate, and load-bearing elsewhere: `assignTask` / `updateTask`
    // travel the patch path, not the transition path, and first-party blocks
    // relabel tasks they never claimed (a failure-category audit, a cascade's
    // `skipped` marker). "Fixing" these would break them.
    const { ctx, selfState } = boardWithTwoClaimedTasks();
    holdMine();

    expect(
      await runForTest(
        findTool("updateTask"),
        { taskId: "theirs", patch: { addLabel: "triaged" } },
        ctx,
      ),
    ).toEqual({ ok: true });

    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, Task>;
    expect(board.theirs?.labels).toContain("triaged");
  });
});

// FIX-2623 (D1, FIX-2621).
/**
 * The view recorder on the conversation board: the precondition the spec set
 * before views build on it.
 *
 * The dependency-check proof ran the board's list through recorders outside the engine and
 * found each one blind somewhere: in place missed the session's state, a
 * proxy changed the run's branch and missed the plan ledger, and both missed
 * a child block. Its finding that a recorder inside the engine sees all of
 * it was reasoned, not run. This runs the board's real list block as a
 * session view, under the production recorder, and requires every
 * dependency that proof found: the task ledger, the plan ledger, the roster and
 * the session's own state. A miss here sends D1 back to the owner.
 */
import { describe, expect, it } from "vitest";
import { defineView } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runView, type RecordedRead } from "@flow-state-dev/engine/internal";
import { taskToolViews } from "@flow-state-dev/orchestration/internal";
import { bootBoardHost, messageOf, ORG } from "./conversation-board-harness";

const LIST = "listTasks_tasks";

const named = (reads: readonly RecordedRead[]) =>
  reads.map((read) => `${read.scope}:${read.what === "state" ? "state" : read.what.resource}`).sort();

describe("the board's list, run as a session view", () => {
  it("records every dependency FIX-2621 found, through the board's resolver", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const filed = await host.act("alice", conv, "createTask_tasks", { goal: "Audit licenses", assignee: "eng.tasker", held: true });
      expect(filed.error, messageOf(filed.error)).toBeUndefined();
      await host.settled();

      const runtime = await host.state.getRuntime();
      const coordinator = runtime.registry.get("coordinator")!;
      const block = coordinator.reads![LIST]!.block;
      const flow = { ...coordinator, views: { board: defineView({ scope: "session", block }) } } as FlowInstance;

      const answer = await runView({ flow, viewName: "board", input: {}, userId: "alice", orgId: ORG, sessionId: conv, stores: runtime.stores });
      expect((answer.output as { tasks: unknown[] }).tasks).toHaveLength(1);

      // FIX-2621's four, and nothing the run didn't reach: the task ledger and
      // the plan ledger (user-scope cells, reached through the board's
      // resolver), the roster, and the session's own state.
      expect(named(answer.reads)).toEqual(["session:state", "user:plan", "user:tasks", "user:workforceWorkers"]);
      expect(answer.topics).toEqual([{ scope: "session", id: conv }, { scope: "user" }]);
    } finally {
      await host.dispose();
    }
  });
});

describe("the board's task-list view", () => {
  it("refuses a session with no board to list by the list's own reason, rather than answering an empty board", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "desk");
      const runtime = await host.state.getRuntime();
      const coordinator = runtime.registry.get("coordinator")!;
      const flow = { ...coordinator, views: taskToolViews("tasks", async () => undefined) } as FlowInstance;
      const viewing = runView({ flow, viewName: LIST, input: {}, userId: "alice", orgId: ORG, sessionId: conv, stores: runtime.stores });
      await expect(viewing).rejects.toMatchObject({ code: "no_delegation_board", retryable: false });
    } finally {
      await host.dispose();
    }
  });
});

/**
 * A cancel (`updateTask({ status: "cancelled" })`, FIX-2081's surface for
 * FIX-2078's `cancelTask`) names the dependents it took along by the board's
 * own filer rule (FIX-2078, BP-030): a task filed before rows carried their filer
 * is the conversation's by its partition, so the tasks filed after it, which
 * do carry the conversation as their filer, share its filer, owe no notice of
 * their own, and must be named in the cancel's answer.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { bootBoardHost, messageOf } from "./conversation-board-harness";

describe("a cancel of a task filed before the upgrade", () => {
  it("names the dependents filed after it, which share its filer by the board's rule", async () => {
    const host = bootBoardHost();
    try {
      const conv = await host.conversation("alice", "pm");
      const filing = await host.filingOf("alice", conv);
      const add = async (input: Record<string, unknown>) => {
        const result = await host.act("alice", conv, "createTask_tasks", input);
        expect(result.error, messageOf(result.error)).toBeUndefined();
        return (result.output as { taskId: string }).taskId;
      };
      const cause = await add({ goal: "Audit licenses", assignee: "eng.tasker" });
      const dependent = await add({ goal: "Report on the audit", assignee: "eng.tasker", deps: [cause] });
      const next = await add({ goal: "Send the report", assignee: "eng.tasker", deps: [dependent] });
      // The cause as a release before the upgrade stored it: no filer.
      const { partition: _partition, filer: _filer, ...stored } = (await host.row("alice", filing, cause))!;
      await host.writeRow("alice", filing, stored as Task);
      expect((await host.row("alice", filing, dependent))?.filer).toBeDefined();

      const result = await host.act("alice", conv, "updateTask_tasks", { id: cause, status: "cancelled" });
      expect(result.error, messageOf(result.error)).toBeUndefined();
      const output = result.output as { ok: boolean; cancelled?: string[] };
      expect(output.ok).toBe(true);
      expect([...(output.cancelled ?? [])].sort()).toEqual([dependent, next].sort());
    } finally {
      await host.dispose();
    }
  });
});

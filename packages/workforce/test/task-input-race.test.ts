/**
 * Two edits of one row at once end with one checked result (FIX-2894): an
 * edit is decided on one revision of the row and written only while the row
 * is still there. The loser re-reads the row and runs the whole check again,
 * on what the winner wrote, or is refused `input_conflict` after three
 * conflicts. On a real task collection (the state-backed one), with the
 * winning write landed while the loser's check runs.
 */
import { describe, expect, it } from "vitest";
import { createStateBackedTaskCollection } from "@flow-state-dev/orchestration/internal";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { taskInputSchema } from "../src/task-input/declaration";
import { checkedPatch, type InputLookup } from "../src/task-input/checked-ledger";
import { FILLED_FOR } from "../src/task-input/filing-check";

/** A minimal atomic state, as a sequencer's is. */
function atomicState() {
  let state: Record<string, unknown> = { tasks: {} };
  return {
    name: "race",
    instanceId: "race#0",
    input: undefined,
    get state() {
      return state;
    },
    async patchState(updates: Record<string, unknown>) {
      state = { ...state, ...updates };
      return true;
    },
    async setState(next: Record<string, unknown>) {
      state = { ...next };
      return true;
    },
    async atomicState(mutator: (s: Record<string, unknown>) => Record<string, unknown>) {
      state = { ...state, ...mutator(state) };
      return true;
    }
  };
}

const triage = taskInputSchema(z.object({ ticket: z.string(), requestedBy: z.string() }).strict(), {
  serverOwned: ["requestedBy"],
  fill: () => ({ requestedBy: "u_jane" })
});

/** A lookup where ops.triager is on "triage" and ops.helper on an open flow; `during` runs inside each check. */
function lookupWith(during: () => Promise<void>): InputLookup {
  return {
    worker: async (assignee) => {
      const flow = assignee === "ops.triager" ? "triage" : assignee === "ops.helper" ? "agent" : undefined;
      // The competing write lands after this check has read the worker.
      await during();
      return flow === undefined ? undefined : { id: assignee, flow, config: {} };
    },
    declarationOf: (flow) => (flow === "triage" ? triage : undefined),
    hasProject: async () => true,
    noProject: () => "no project"
  };
}

async function board(): Promise<TaskCollectionRef> {
  return createStateBackedTaskCollection({ collectionId: "tasks", state: atomicState() as never });
}

const ctx = {} as BlockContext;

describe("a caller's own revision fence", () => {
  // Greptile: the check's own fence overwrote a caller's, so a stale edit landed.
  it("is kept: an edit fenced on a revision the task has moved past is declined revision-moved, never retried onto the new one", async () => {
    const tasks = await board();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops.triager", input: { ticket: "ENG-1", requestedBy: "u_jane" } });
    const stale = tasks.get("t")!.revision ?? 0;
    await tasks.patchSettings("t", { goal: "moved on" });
    const outcome = await checkedPatch(lookupWith(async () => undefined), ctx, tasks, "t", { input: { ticket: "ENG-2" }, ifRevision: stale }, (id, patch) =>
      tasks.patchSettings(id, patch)
    );
    expect(outcome).toMatchObject({ outcome: "declined", reason: "revision-moved" });
    expect(tasks.get("t")?.input).toEqual({ ticket: "ENG-1", requestedBy: "u_jane" });
  });
});

describe("two edits of one row at once", () => {
  it("re-runs the loser's whole check on the row the winner wrote: a move to an open flow is stored as sent", async () => {
    const tasks = await board();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops.triager", input: { ticket: "ENG-1", requestedBy: "u_jane" }, metadata: { [FILLED_FOR]: { flow: "triage", declaration: triage.fingerprint } } });
    let raced = false;
    // B moves the row to ops.helper while A's edit is being checked against the triage revision.
    const lookup = lookupWith(async () => {
      if (raced) return;
      raced = true;
      await tasks.patchSettings("t", { assignee: "ops.helper" });
    });
    const outcome = await checkedPatch(lookup, ctx, tasks, "t", { input: { ticket: "ENG-150", requestedBy: "u_admin" } }, (id, patch) => tasks.patchSettings(id, patch));
    expect(outcome.outcome).toBe("recorded");
    // Checked against the row B wrote (open flow): stored as sent, never as triage's check would have shaped it.
    expect(tasks.get("t")).toMatchObject({ assignee: "ops.helper", input: { ticket: "ENG-150", requestedBy: "u_admin" } });
  });

  it("refuses input_conflict after three conflicts in a row, and writes nothing of its own", async () => {
    const tasks = await board();
    await tasks.createTask({ id: "t", goal: "g", assignee: "ops.triager", input: { ticket: "ENG-1", requestedBy: "u_jane" } });
    let n = 0;
    const lookup = lookupWith(async () => {
      n += 1;
      await tasks.patchSettings("t", { goal: `moved ${n}` });
    });
    await expect(checkedPatch(lookup, ctx, tasks, "t", { input: { ticket: "ENG-2" } }, (id, patch) => tasks.patchSettings(id, patch))).rejects.toThrow(
      'task "t" changed while this edit was checked, three times. Read it again with getTask and send the edit again. Nothing was filed.'
    );
    expect(n).toBe(3);
    expect(tasks.get("t")?.input).toEqual({ ticket: "ENG-1", requestedBy: "u_jane" });
  });
});

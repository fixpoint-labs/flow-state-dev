/**
 * A task whose run waits for a user (FIX-2129), on both backings: the row's
 * mirror of the stop (a suspension hold in `holds`, FIX-2133), the resume a
 * cancel owes the parked run (`resumeOwed`, the board's existing mark), who
 * pays it (`cancelAndResume` at once, under the stop's fence; `payOwedResumes`
 * on the next touch), and the filing a cancelled task makes afterwards
 * (refused).
 */
import { describe, expect, it } from "vitest";
import type { BlockContext, ResumeWaitInput, ResumeWaitResult } from "@flow-state-dev/core/types";
import {
  cancelAndResume,
  createResourceBackedTaskCollection,
  createStateBackedTaskCollection,
  openHolds,
  ticketForClaim,
  TaskFilingRefusedError,
  type SuspensionHold,
  type TaskClaimTicket,
  type TaskCollectionRef,
} from "../../src/tasks";
import { payOwedResumes } from "../../src/tasks/helpers/wait-on-task";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

const STOP: SuspensionHold = {
  id: "susp_1",
  actor: "user",
  openedAt: 1000,
  due: 9_999_999,
  source: { kind: "suspension", requestId: "req_run", suspensionId: "susp_1" },
  ask: { kind: "input", prompt: "Which region?" },
};
const ADDRESS = { requestId: STOP.source.requestId, suspensionId: STOP.source.suspensionId };

async function sequencerBacking(): Promise<TaskCollectionRef> {
  return createStateBackedTaskCollection({
    collectionId: "tasks",
    state: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
    now: () => 1000,
  });
}

async function resourceBacking(): Promise<TaskCollectionRef> {
  return createResourceBackedTaskCollection({ collectionId: "tasks", collection: createFakeResourceCollection(), now: () => 1000 });
}

/** A context whose request host resumes as `answer` says, recording each call. */
function hostThat(answer: (input: ResumeWaitInput) => Promise<ResumeWaitResult>) {
  const calls: ResumeWaitInput[] = [];
  const ctx = {
    requestHost: {
      resumeWait: async (input: ResumeWaitInput) => {
        calls.push(input);
        return answer(input);
      },
    },
  } as unknown as BlockContext;
  return { ctx, calls };
}

describe.each([
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
])("a task waiting on a user (%s)", (_name, make) => {
  async function waiting(): Promise<{ collection: TaskCollectionRef; claim: TaskClaimTicket }> {
    const collection = await make();
    await collection.addTask({ id: "t", goal: "t" });
    const task = (await collection.claim("w", { leaseDurationMs: 10_000 }))!;
    const claim = ticketForClaim(collection.collectionId, task);
    await collection.setWaitingOn!("t", "wait", { claim, hold: STOP });
    return { collection, claim };
  }

  it("mirrors the stop it waits on in the write that drops the lease, and the run's own resume closes it", async () => {
    const { collection, claim } = await waiting();
    expect(collection.get("t")).toMatchObject({ status: "in_progress", waitingOn: "wait", holds: [STOP] });
    expect(openHolds(collection.get("t")!)).toEqual([STOP]);
    expect(collection.get("t")!.leaseUntil).toBeUndefined();
    // A later request admitted while the run stays parked keeps it; the run's own resume closes it.
    await collection.setWaitingOn!("t", null, { claim, leaseUntil: 50_000 });
    expect(collection.get("t")).toMatchObject({ holds: [STOP] });
    expect(collection.get("t")!.waitingOn).toBeUndefined();
    await collection.setWaitingOn!("t", null, { claim, leaseUntil: 50_000, resume: true });
    expect(collection.get("t")!.holds).toBeUndefined();
  });

  it("refuses to mirror a stop on a row a question holds: one wait per turn", async () => {
    const { collection, claim } = await waiting();
    await collection.setWaitingOn!("t", null, { claim, leaseUntil: 50_000, resume: true });
    expect((await collection.ask!("t", [{ kind: "question", prompt: "Which date column?" }], { claim })).outcome).toBe("recorded");
    const refused = await collection.setWaitingOn!("t", "wait", { claim, hold: STOP });
    expect(refused).toMatchObject({ outcome: "declined", reason: "held" });
    expect(openHolds(collection.get("t")!).map((hold) => hold.source.kind)).toEqual(["row"]);
  });

  it("a cancel owes the parked run its resume in the same write, keeping the stop it is owed to; the clear drops both", async () => {
    const { collection } = await waiting();
    await collection.cancel("t", "no longer needed");
    const ended = collection.get("t")!;
    // Closed with the row (no open hold), its address kept for the debt.
    expect(ended).toMatchObject({ status: "cancelled", resumeOwed: true, holds: [STOP] });
    expect(openHolds(ended)).toEqual([]);
    expect(ended.waitingOn).toBeUndefined();
    // A later write to the ended row keeps the debt's address.
    await collection.patchMetadata("t", { note: "x" });
    expect(collection.get("t")!.holds).toEqual([STOP]);
    await collection.clearResumeOwed!("t");
    expect(collection.get("t")!.resumeOwed).toBeUndefined();
    expect(collection.get("t")!.holds).toBeUndefined();
  });

  it("an ending of a row that waits on nothing owes nothing", async () => {
    const collection = await make();
    await collection.addTask({ id: "t", goal: "t" });
    await collection.cancel("t");
    expect(collection.get("t")!.resumeOwed).toBeUndefined();
  });

  it("the touch pays the owed resume to the stop the row names, cancelled, and clears it once paid", async () => {
    const { collection } = await waiting();
    await collection.cancel("t");
    const busy = hostThat(async () => ({ ok: false, refused: "busy", detail: "held" }));
    expect((await payOwedResumes(busy.ctx, collection)).stillOwed).toEqual(["t"]);
    expect(busy.calls).toEqual([{ suspension: ADDRESS, outcome: { cancelled: true }, taskCancelled: true }]);
    expect(collection.get("t")!.resumeOwed).toBe(true);

    const paid = hostThat(async () => ({ ok: true }));
    expect((await payOwedResumes(paid.ctx, collection)).resumed).toEqual(["t"]);
    expect(collection.get("t")!.resumeOwed).toBeUndefined();
    expect(collection.get("t")!.holds).toBeUndefined();
  });

  it("cancelAndResume writes the cancel under the stop's fence, then the resume is paid and nothing stays owed", async () => {
    const { collection } = await waiting();
    const order: string[] = [];
    const host = hostThat(async (input) => {
      order.push("fence");
      if ("suspension" in input) await input.first?.();
      order.push(`resolved:${collection.get("t")!.status}`);
      return { ok: true };
    });
    expect(await cancelAndResume(host.ctx, collection, "t", "stop")).toEqual({ outcome: "recorded" });
    // The row was cancelled inside the fence, before the stop resolved.
    expect(order).toEqual(["fence", "resolved:cancelled"]);
    expect(collection.get("t")).toMatchObject({ status: "cancelled" });
    expect(collection.get("t")!.resumeOwed).toBeUndefined();
  });

  it("cancelAndResume still cancels when an answer resolved the stop first, and owes nothing further", async () => {
    const { collection } = await waiting();
    const host = hostThat(async () => ({ ok: false, refused: "already-resolved", detail: "answered" }));
    expect(await cancelAndResume(host.ctx, collection, "t")).toEqual({ outcome: "recorded" });
    expect(collection.get("t")!.status).toBe("cancelled");
    expect(collection.get("t")!.resumeOwed).toBeUndefined();
  });

  it("cancelAndResume leaves the resume owed when the stop's request is busy", async () => {
    const { collection } = await waiting();
    const host = hostThat(async () => ({ ok: false, refused: "busy", detail: "held" }));
    await cancelAndResume(host.ctx, collection, "t");
    expect(collection.get("t")).toMatchObject({ status: "cancelled", resumeOwed: true, holds: [STOP] });
  });

  it("refuses a filing by a task that is already cancelled, on the same board", async () => {
    const collection = await make();
    await collection.addTask({ id: "parent", goal: "p" });
    await collection.addTask({ id: "early", goal: "c", filedByTask: "parent" });
    await collection.cancel("parent");
    await expect(collection.addTask({ id: "late", goal: "c", filedByTask: "parent" })).rejects.toMatchObject({
      name: TaskFilingRefusedError.name,
      rule: "parent_cancelled",
    });
    await expect(collection.addTasks([{ id: "late2", goal: "c", filedByTask: "parent" }])).rejects.toMatchObject({ rule: "parent_cancelled" });
    expect(collection.get("late")).toBeUndefined();
  });
});

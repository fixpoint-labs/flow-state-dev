/**
 * One ending signal (FIX-1794 P2 with FIX-1816).
 *
 * Every write that changes a row goes through `applyTransition` or
 * `applyAbandonmentSettlement`, on both backings, and that is the one place an
 * ending is detected and every recorder runs, in the ending's own write:
 * orchestration's resume recorder first (a waited-on row's typed
 * `Task.resumeOwed`), then the ledger's declared `recordEnding`, metadata
 * only. Nothing else records an ending, so none is recorded twice.
 *
 * The resume recorder must fire on every way a waited-on row ends, a cancel
 * among them, and never on a row whose wait lapsed at its deadline (FIX-2082):
 * nobody is parked on that one.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import { applyAbandonmentSettlement, applyTransition } from "../../src/tasks/collection/internal";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  ticketForClaim,
  type Task,
  type TaskCollectionRef,
  type TaskEnding,
} from "../../src/tasks";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

/** A cancel someone else made. */
const CANCEL_REASON = "not needed any more";

const NOW = 1_000_000;

/** A row a request is waiting on, its slot taken when the wait started, now running. */
function waitedRow(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    goal: "find out",
    status: "in_progress",
    attempts: 1,
    createdAt: 1,
    updatedAt: 2,
    wait: { gateId: "g1", deadline: NOW + 60_000, requestId: "r1" },
    ...patch,
  } as Task;
}

describe("the choke point both backings write through", () => {
  for (const [ending, patch] of [
    ["completes", { status: "completed", output: "the answer" }],
    ["fails for good", { status: "errored", error: "unreachable" }],
    ["is cancelled", { status: "cancelled", error: "not needed" }],
  ] as const) {
    it(`owes the waiting turn a resume when a waited-on row ${ending}`, () => {
      expect(applyTransition(waitedRow(), patch as Partial<Task>, NOW).resumeOwed).toBe(true);
    });
  }

  it("owes no resume when the row's wait lapsed at its deadline: nobody is parked on it", () => {
    const lapsed = waitedRow({ wait: { gateId: "g1", deadline: NOW - 1, requestId: "r1", lapsed: true } });
    const next = applyTransition(lapsed, { status: "completed", output: "late" }, NOW);
    expect(next.status).toBe("completed");
    expect(next.resumeOwed).toBeUndefined();
  });

  it("owes the resume when the board settles a waited-on row whose worker died too often", () => {
    expect(applyAbandonmentSettlement(waitedRow(), NOW, 3)).toMatchObject({ status: "errored", resumeOwed: true });
  });

  it("owes nothing for a retried failure, a row nobody waits on, or a write that ends nothing", () => {
    expect(applyTransition(waitedRow(), { status: "pending", feedback: "try again" }, NOW).resumeOwed).toBeUndefined();
    expect(applyTransition(waitedRow({ wait: undefined }), { status: "completed" }, NOW).resumeOwed).toBeUndefined();
    expect(applyTransition(waitedRow({ status: "errored" }), { status: "errored" }, NOW).resumeOwed).toBeUndefined();
  });

  it("runs the resume recorder first and the declared one after it, in the same write; the declared one keeps only metadata", () => {
    const seen: Array<{ resumeOwed: unknown; ending: TaskEnding }> = [];
    const next = applyTransition(waitedRow(), { status: "cancelled", error: CANCEL_REASON }, NOW, {
      recordEnding: (row, ending) => {
        seen.push({ resumeOwed: row.resumeOwed, ending });
        return { ...row, resumeOwed: false, metadata: { told: ending.kind } };
      },
    });
    expect(seen).toEqual([{ resumeOwed: true, ending: { kind: "cancelled", reason: CANCEL_REASON } }]);
    expect(next).toMatchObject({ resumeOwed: true, metadata: { told: "cancelled" } });
  });

  it("tells the declared recorder each ending once, and nothing for a write that ends nothing", () => {
    const kinds: string[] = [];
    const recording = {
      recordEnding: (row: Task, ending: TaskEnding) => {
        kinds.push(ending.kind);
        return row;
      },
    };
    applyTransition(waitedRow(), { status: "pending", feedback: "boom" }, NOW, recording);
    applyTransition(waitedRow(), { priority: 3 }, NOW, recording);
    applyTransition(waitedRow({ status: "errored" }), { status: "errored" }, NOW, recording);
    expect(kinds).toEqual(["retried"]);
  });
});

function ctxFor(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } },
  } as unknown as BlockContext;
}

/** A durable ledger with a declared recorder that counts what it is told. */
async function resourceLedger() {
  const told: string[] = [];
  const declared = defineTaskCollection({
    id: "waits",
    scope: "user",
    recordEnding: (row, ending) => {
      told.push(ending.kind);
      return { ...row, metadata: { ...(row.metadata ?? {}), told: ending.kind } };
    },
  });
  const store = Object.assign(createFakeResourceCollection<JsonObject>("waits/**"), { config: declared });
  const ref = await getOrCreateTaskCollection({
    ctx: ctxFor(),
    backing: "resource",
    collectionId: "waits",
    collection: store as ResourceCollectionRef<JsonObject>,
  });
  return { ref, told };
}

async function stateLedger(): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    ctx: ctxFor(),
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "waits",
  });
}

describe("a waited-on row's ending, on each backing", () => {
  it("resource: a cancel writes the resume and the declared recorder's marker in one write, told once", async () => {
    const { ref, told } = await resourceLedger();
    await ref.createTask({ id: "t1", goal: "find out" });
    await ref.markWait!("t1", { gateId: "g1", deadline: Date.now() + 60_000, requestId: "r1" });
    const before = ref.get("t1")!.revision!;
    await ref.cancel("t1", "not needed");
    expect(ref.get("t1")).toMatchObject({ status: "cancelled", resumeOwed: true, metadata: { told: "cancelled" } });
    expect(ref.get("t1")!.revision).toBe(before + 1);
    expect(told).toEqual(["cancelled"]);
  });

  it("resource: a cancel of a running waited-on row owes the resume too", async () => {
    const { ref } = await resourceLedger();
    await ref.createTask({ id: "t1", goal: "find out" });
    await ref.markWait!("t1", { gateId: "g1", deadline: Date.now() + 60_000, requestId: "r1" });
    const task = (await ref.claim("w"))!;
    expect(task.id).toBe("t1");
    await ref.cancel("t1", CANCEL_REASON);
    expect(ref.get("t1")).toMatchObject({ status: "cancelled", resumeOwed: true });
  });

  it("resource: a completion is told once, with the resume beside it", async () => {
    const { ref, told } = await resourceLedger();
    await ref.createTask({ id: "t1", goal: "find out" });
    await ref.markWait!("t1", { gateId: "g1", deadline: Date.now() + 60_000, requestId: "r1" });
    const task = (await ref.claim("w"))!;
    await ref.complete("t1", "the answer", { claim: ticketForClaim(ref.collectionId, task) });
    expect(ref.get("t1")).toMatchObject({ status: "completed", resumeOwed: true, metadata: { told: "completed" } });
    expect(told).toEqual(["completed"]);
  });

  it("state: a cancel of a waited-on row owes the resume, pending or running", async () => {
    const ref = await stateLedger();
    await ref.createTask({ id: "t1", goal: "find out" });
    await ref.createTask({ id: "t2", goal: "find out too" });
    await ref.markWait!("t1", { gateId: "g1", deadline: Date.now() + 60_000, requestId: "r1" });
    await ref.markWait!("t2", { gateId: "g2", deadline: Date.now() + 60_000, requestId: "r2" });
    await ref.claim("w", { eligibility: (row) => row.id === "t2" });
    await ref.cancel("t1", "not needed");
    await ref.cancel("t2", CANCEL_REASON);
    expect(ref.get("t1")).toMatchObject({ status: "cancelled", resumeOwed: true });
    expect(ref.get("t2")).toMatchObject({ status: "cancelled", resumeOwed: true });
  });
});

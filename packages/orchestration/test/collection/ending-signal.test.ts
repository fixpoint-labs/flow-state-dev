/**
 * One ending signal (FIX-1794 P2 with FIX-1816).
 *
 * Every write that changes a row goes through `applyTransition` or
 * `applyAbandonmentSettlement`, on both backings, and that is the one place an
 * ending is detected and every recorder runs, in the ending's own write:
 * orchestration's resume recorder first (an asked row's typed
 * `Task.resumeOwed`), then the ledger's declared `recordEnding`, metadata
 * only. Nothing else records an ending, so none is recorded twice.
 *
 * The resume recorder must fire on every way an asked row ends, a cancel and
 * the cancel its ask's timeout writes among them (`addTaskAndWait` cancels
 * the row with {@link TIMEOUT_REASON} when its gate resumes it timed out).
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
import { ASK_TIMED_OUT_REASON } from "../../src/tasks/helpers/wait-for-response";
import { createFakeResourceCollection, createFakeSequencerState } from "../helpers";

/** The reason `addTaskAndWait` cancels its row with when the ask times out. */
const TIMEOUT_REASON = ASK_TIMED_OUT_REASON;

const NOW = 1_000_000;

/** A row a turn is waiting on, as `addTaskAndWait` files it, now running. */
function askedRow(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    goal: "find out",
    status: "in_progress",
    attempts: 1,
    createdAt: 1,
    updatedAt: 2,
    ask: { gateId: "g1", deadline: NOW + 60_000 },
    ...patch,
  } as Task;
}

describe("the choke point both backings write through", () => {
  for (const [ending, patch] of [
    ["completes", { status: "completed", output: "the answer" }],
    ["fails for good", { status: "errored", error: "unreachable" }],
    ["is cancelled", { status: "cancelled", error: "not needed" }],
  ] as const) {
    it(`owes the asking turn a resume when an asked row ${ending}`, () => {
      expect(applyTransition(askedRow(), patch as Partial<Task>, NOW).resumeOwed).toBe(true);
    });
  }

  it("owes the resume when the ask's timeout cancels its row", () => {
    const timedOut = askedRow({ ask: { gateId: "g1", deadline: NOW - 1 } });
    const next = applyTransition(timedOut, { status: "cancelled", error: TIMEOUT_REASON }, NOW);
    expect(next).toMatchObject({ status: "cancelled", error: TIMEOUT_REASON, resumeOwed: true });
  });

  it("owes the resume when the board settles an asked row whose worker died too often", () => {
    expect(applyAbandonmentSettlement(askedRow(), NOW, 3)).toMatchObject({ status: "errored", resumeOwed: true });
  });

  it("owes nothing for a retried failure, a row nobody asked about, or a write that ends nothing", () => {
    expect(applyTransition(askedRow(), { status: "pending", feedback: "try again" }, NOW).resumeOwed).toBeUndefined();
    expect(applyTransition(askedRow({ ask: undefined }), { status: "completed" }, NOW).resumeOwed).toBeUndefined();
    expect(applyTransition(askedRow({ status: "errored" }), { status: "errored" }, NOW).resumeOwed).toBeUndefined();
  });

  it("runs the resume recorder first and the declared one after it, in the same write; the declared one keeps only metadata", () => {
    const seen: Array<{ resumeOwed: unknown; ending: TaskEnding }> = [];
    const next = applyTransition(askedRow(), { status: "cancelled", error: TIMEOUT_REASON }, NOW, {
      recordEnding: (row, ending) => {
        seen.push({ resumeOwed: row.resumeOwed, ending });
        return { ...row, resumeOwed: false, metadata: { told: ending.kind } };
      },
    });
    expect(seen).toEqual([{ resumeOwed: true, ending: { kind: "cancelled", reason: TIMEOUT_REASON } }]);
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
    applyTransition(askedRow(), { status: "pending", feedback: "boom" }, NOW, recording);
    applyTransition(askedRow(), { status: "parked", feedback: "which one?" }, NOW, recording);
    applyTransition(askedRow(), { priority: 3 }, NOW, recording);
    applyTransition(askedRow({ status: "errored" }), { status: "errored" }, NOW, recording);
    expect(kinds).toEqual(["retried", "parked"]);
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
    id: "asks",
    scope: "user",
    recordEnding: (row, ending) => {
      told.push(ending.kind);
      return { ...row, metadata: { ...(row.metadata ?? {}), told: ending.kind } };
    },
  });
  const store = Object.assign(createFakeResourceCollection<JsonObject>("asks/**"), { config: declared });
  const ref = await getOrCreateTaskCollection({
    ctx: ctxFor(),
    backing: "resource",
    collectionId: "asks",
    collection: store as ResourceCollectionRef<JsonObject>,
  });
  return { ref, told };
}

async function stateLedger(): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    ctx: ctxFor(),
    backing: "state",
    state: createFakeSequencerState<Record<string, unknown>>({ tasks: {} }),
    collectionId: "asks",
  });
}

describe("an asked row's ending, on each backing", () => {
  it("resource: a cancel writes the resume and the declared recorder's marker in one write, told once", async () => {
    const { ref, told } = await resourceLedger();
    await ref.addTask({ id: "t1", goal: "find out", ask: { gateId: "g1", deadline: Date.now() + 60_000 } });
    const before = ref.get("t1")!.revision!;
    await ref.cancel("t1", "not needed");
    expect(ref.get("t1")).toMatchObject({ status: "cancelled", resumeOwed: true, metadata: { told: "cancelled" } });
    expect(ref.get("t1")!.revision).toBe(before + 1);
    expect(told).toEqual(["cancelled"]);
  });

  it("resource: the ask's timeout cancel owes the resume too", async () => {
    const { ref } = await resourceLedger();
    await ref.addTask({ id: "t1", goal: "find out", ask: { gateId: "g1", deadline: Date.now() - 1 } });
    const task = (await ref.claim("w"))!;
    expect(task.id).toBe("t1");
    await ref.cancel("t1", TIMEOUT_REASON);
    expect(ref.get("t1")).toMatchObject({ status: "cancelled", resumeOwed: true });
  });

  it("resource: a completion is told once, with the resume beside it", async () => {
    const { ref, told } = await resourceLedger();
    await ref.addTask({ id: "t1", goal: "find out", ask: { gateId: "g1", deadline: Date.now() + 60_000 } });
    const task = (await ref.claim("w"))!;
    await ref.complete("t1", "the answer", { claim: ticketForClaim(ref.collectionId, task) });
    expect(ref.get("t1")).toMatchObject({ status: "completed", resumeOwed: true, metadata: { told: "completed" } });
    expect(told).toEqual(["completed"]);
  });

  it("state: a cancel, and the ask's timeout cancel, each owe the resume", async () => {
    const ref = await stateLedger();
    await ref.addTask({ id: "t1", goal: "find out", ask: { gateId: "g1", deadline: Date.now() + 60_000 } });
    await ref.addTask({ id: "t2", goal: "find out too", ask: { gateId: "g2", deadline: Date.now() - 1 } });
    await ref.cancel("t1", "not needed");
    await ref.cancel("t2", TIMEOUT_REASON);
    expect(ref.get("t1")).toMatchObject({ status: "cancelled", resumeOwed: true });
    expect(ref.get("t2")).toMatchObject({ status: "cancelled", resumeOwed: true });
  });
});

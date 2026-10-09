/**
 * A durable ledger's ending recorder (`defineTaskCollection({ recordEnding })`,
 * FIX-1794 P2).
 *
 * Every write that records how a task ended hands the row it is about to
 * commit, and what the ending was, to the ledger's `recordEnding`, inside the
 * same atomic write. Whatever the recorder adds to the row's `metadata` lands
 * with the ending or not at all, so a composing layer can keep "this ending is
 * still owed to someone" on the row the ending is written on, with no window
 * in which the ending is stored and the debt is not.
 *
 * "In the same write" is pinned by the row's `revision`, which every committed
 * write bumps by one: an ending plus its marker advances it once. Moving the
 * marker into a second write (a `patchMetadata` after the transition) makes
 * each of these advance it twice, and these fail.
 */
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@flow-state-dev/core";
import type { BlockContext, ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  defineTaskCollection,
  getOrCreateTaskCollection,
  ticketForClaim,
  type DefinedTaskCollection,
  type Task,
  type TaskCollectionRef,
  type TaskEnding,
} from "../../src/tasks";
import { createFakeResourceCollection } from "../helpers";

const LEDGER = "ending-tasks";

function ctxFor(): BlockContext {
  return {
    emit: { component: () => undefined },
    session: { identity: { type: "session", id: "s_1", userId: "alice" } },
    request: { identity: { type: "request", id: "r_1" } },
  } as unknown as BlockContext;
}

/** A recorder that notes each ending it is handed and marks the row with it. */
function recorder() {
  const seen: Array<{ status: string; ending: TaskEnding }> = [];
  const recordEnding = (row: Task, ending: TaskEnding): Task => {
    seen.push({ status: row.status, ending });
    return { ...row, metadata: { ...(row.metadata ?? {}), owed: ending.kind } };
  };
  return { seen, recordEnding };
}

async function ledgerWith(
  recordEnding: ((row: Task, ending: TaskEnding) => Task) | undefined,
  now?: () => number
): Promise<{ ref: TaskCollectionRef; declared: DefinedTaskCollection }> {
  const declared = defineTaskCollection({
    id: LEDGER,
    scope: "user",
    ...(recordEnding !== undefined ? { recordEnding } : {}),
  });
  const store = Object.assign(createFakeResourceCollection<JsonObject>(`${LEDGER}/**`), {
    config: declared,
  }) as ResourceCollectionRef<JsonObject>;
  const ref = await getOrCreateTaskCollection({
    ctx: ctxFor(),
    backing: "resource",
    collectionId: LEDGER,
    collection: store,
    ...(now !== undefined ? { now } : {}),
  });
  return { ref, declared };
}

/** Add and claim one row, returning its ticket and the revision the claim left. */
async function claimed(ref: TaskCollectionRef, init: { id: string; maxAttempts?: number }) {
  await ref.addTask({ goal: "g", ...init });
  const task = (await ref.claim("w"))!;
  return { ticket: ticketForClaim(ref.collectionId, task), revision: ref.get(init.id)!.revision! };
}

describe("defineTaskCollection({ recordEnding })", () => {
  it("refuses a recorder that is not a function", () => {
    expect(() =>
      defineTaskCollection({ id: LEDGER, scope: "user", recordEnding: "mark" as never })
    ).toThrow(/recordEnding must be a function/);
  });

  it("keeps the recorder on the declaration", () => {
    const { recordEnding } = recorder();
    expect(defineTaskCollection({ id: LEDGER, scope: "user", recordEnding }).__taskCollection.recordEnding).toBe(
      recordEnding
    );
  });
});

describe("an ending written with its recorder's metadata, in one write", () => {
  it("completed: the output, and the marker beside it", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    const { ticket, revision } = await claimed(ref, { id: "t1" });
    expect(await ref.complete("t1", { done: true }, { claim: ticket })).toEqual({ outcome: "recorded" });
    const row = ref.get("t1")!;
    expect(row).toMatchObject({ status: "completed", output: { done: true }, metadata: { owed: "completed" } });
    expect(row.revision).toBe(revision + 1);
    expect(r.seen).toEqual([{ status: "completed", ending: { kind: "completed", output: { done: true } } }]);
  });

  it("errored: a failure with no attempts left", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    const { ticket, revision } = await claimed(ref, { id: "t1" });
    await ref.fail("t1", "broke", { claim: ticket });
    expect(ref.get("t1")).toMatchObject({ status: "errored", metadata: { owed: "errored" } });
    expect(ref.get("t1")!.revision).toBe(revision + 1);
    expect(r.seen.map((s) => s.ending)).toEqual([{ kind: "errored", error: "broke" }]);
  });

  it("retried: a failure with attempts left goes back to pending, marked", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    const { ticket, revision } = await claimed(ref, { id: "t1", maxAttempts: 2 });
    await ref.fail("t1", "flaky", { claim: ticket });
    expect(ref.get("t1")).toMatchObject({ status: "pending", metadata: { owed: "retried" } });
    expect(ref.get("t1")!.revision).toBe(revision + 1);
    expect(r.seen.map((s) => s.ending)).toEqual([{ kind: "retried", error: "flaky" }]);
  });

  it("parked: the question, and whether the park asks anyone anything", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    const asked = await claimed(ref, { id: "asked" });
    await ref.awaitReview("asked", "which region?", { claim: asked.ticket });
    expect(ref.get("asked")!.revision).toBe(asked.revision + 1);
    const quiet = await claimed(ref, { id: "quiet" });
    await ref.awaitReview("quiet", "waiting on my pieces", { claim: quiet.ticket, quiet: true });
    const turn = await claimed(ref, { id: "turn" });
    await ref.awaitReview("turn", undefined, { claim: turn.ticket, forTurn: true });
    expect(r.seen.map((s) => s.ending)).toEqual([
      { kind: "parked", question: "which region?", quiet: false },
      { kind: "parked", question: "waiting on my pieces", quiet: true },
      { kind: "parked", quiet: true },
    ]);
    expect(ref.get("asked")).toMatchObject({ status: "parked", metadata: { owed: "parked" } });
  });

  it("cancelled: told, with the reason", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    await ref.addTask({ id: "t1", goal: "g" });
    await ref.cancel("t1", "not needed");
    expect(r.seen.map((s) => s.ending)).toEqual([{ kind: "cancelled", reason: "not needed" }]);
  });

  it("errored by the claim path, when a dead worker's row has no abandonments left", async () => {
    let clock = 1_000;
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding, () => clock);
    await ref.addTask({ id: "t1", goal: "g" });
    // Claim and let the lease lapse, past the abandonment allowance.
    for (let i = 0; i < 4; i += 1) {
      await ref.claim("w", { leaseDurationMs: 1_000 });
      clock += 5_000;
    }
    await ref.claim("w", { leaseDurationMs: 1_000 });
    expect(ref.get("t1")).toMatchObject({ status: "errored", metadata: { owed: "errored" } });
    expect(r.seen.map((s) => s.ending.kind)).toEqual(["errored"]);
  });

  it("takes only metadata from the recorder: the transition decides every other field", async () => {
    const { ref } = await ledgerWith((row) => ({ ...row, status: "pending", output: "forged", metadata: { owed: 1 } }));
    const { ticket } = await claimed(ref, { id: "t1" });
    await ref.complete("t1", "real", { claim: ticket });
    expect(ref.get("t1")).toMatchObject({ status: "completed", output: "real", metadata: { owed: 1 } });
  });

  it("removes the metadata when the recorder returns none: its metadata is what the row keeps", async () => {
    const { ref } = await ledgerWith((row) => {
      const { metadata: _dropped, ...rest } = row;
      return rest as Task;
    });
    await ref.addTask({ goal: "g", id: "t1", metadata: { stale: true } });
    const task = (await ref.claim("w"))!;
    await ref.complete("t1", "done", { claim: ticketForClaim(ref.collectionId, task) });
    expect(ref.get("t1")).toMatchObject({ status: "completed", output: "done" });
    expect(ref.get("t1")!.metadata).toBeUndefined();
  });

  it("is not called for a write that declined, and the decline writes nothing", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    const { ticket } = await claimed(ref, { id: "t1" });
    await ref.complete("t1", "first", { claim: ticket });
    const before = ref.get("t1")!.revision;
    expect(await ref.complete("t1", "second", { claim: ticket, ifAllowed: true })).toMatchObject({
      outcome: "declined",
    });
    expect(ref.get("t1")!.revision).toBe(before);
    expect(r.seen).toHaveLength(1);
  });

  it("is not called for a write that is not an ending", async () => {
    const r = recorder();
    const { ref } = await ledgerWith(r.recordEnding);
    const { ticket } = await claimed(ref, { id: "t1" });
    await ref.renewLease("t1", ref.now() + 60_000, { claim: ticket });
    await ref.setPriority("t1", 3);
    await ref.patchMetadata("t1", { note: "x" });
    expect(r.seen).toEqual([]);
  });

  it("changes nothing on a ledger declared without one", async () => {
    const { ref } = await ledgerWith(undefined);
    const { ticket } = await claimed(ref, { id: "t1" });
    await ref.complete("t1", "done", { claim: ticket });
    expect(ref.get("t1")!.metadata).toBeUndefined();
  });
});

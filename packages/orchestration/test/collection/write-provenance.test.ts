/**
 * Durable write provenance (FIX-989) — can a caller tell a committed write from
 * one that never landed?
 *
 * The defect: both backings announce a change *after* the durable write
 * resolves, so a write can commit and then throw. A rejected promise carries no
 * value, so FIX-976's write verdict cannot reach that caller, and reading the
 * task back does not help — a committed retry followed by another worker's
 * claim reads exactly like a write that never landed followed by a reclaim and
 * another worker's claim.
 *
 * The suite is built around that pair. `both histories, told apart` runs them
 * side by side and first asserts that they are **indistinguishable** on status
 * and attempts, so the separation below it is measured against the real
 * ambiguity rather than against a strawman. A stub that always answers "landed"
 * fails on history 2; one that treats an absent receipt as "did not land" fails
 * on history 1 and on the eviction cases.
 *
 * Everything is driven off declines and an injected throwing announcement —
 * chosen interleavings, never sampled timing.
 *
 * Parameterized over both backings wherever the stamp is involved: they carry
 * separately maintained copies of the transition wrapper AND of the patch
 * helper, so a stamp added to one and not the other is the failure mode this
 * exists to catch.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  beginTaskWrite,
  createResourceBackedTaskCollection,
  createSequencerBackedTaskCollection,
  didWriteLand,
  ticketForClaim,
  type Task,
  type TaskChangeEvent,
  type TaskCollectionRef,
  type TaskWriteToken,
} from "../../src/tasks";
import { taskEnvelopeSchema } from "../../src/tasks/collection/define-task-collection";
import {
  createCapturedChanges,
  createFakeResourceCollection,
  createFakeSequencerState,
} from "../helpers";

/** The cap the implementation enforces. Asserted through behaviour, never imported. */
const CAP = 4;

// ---------------------------------------------------------------------------
// The read rule, exercised directly
// ---------------------------------------------------------------------------

/**
 * Tested against hand-built records as well as through the backings, because
 * the *order* of the arms is the contract and several of them are only
 * reachable through a record a live board takes many writes to produce (a full
 * log whose oldest receipt predates the caller's baseline, a legacy row).
 * Building the record directly is what keeps every arm asserted.
 */
describe("didWriteLand — the three answers", () => {
  /** A task record carrying exactly the provenance fields under test. */
  function record(provenance: Partial<Task>): Task {
    return {
      id: "t",
      goal: "t",
      status: "in_progress",
      attempts: 1,
      createdAt: 0,
      updatedAt: 0,
      ...provenance,
    } as Task;
  }

  const token = (id: string, sinceRevision: number | undefined): TaskWriteToken => ({
    id,
    sinceRevision,
  });

  it("answers landed when the receipt is in the log", () => {
    const task = record({
      revision: 5,
      writeLog: [{ id: "mine", revision: 5 }],
      writeLogTruncated: false,
    });
    expect(didWriteLand(task, token("mine", 4))).toBe(true);
  });

  it("answers landed from membership alone, with no baseline on the token", () => {
    // A legacy task's FIRST correlated write: `beginTaskWrite` saw no revision
    // to record, but the write created one and left its receipt. Membership is
    // tested ahead of the baseline guard precisely so the proof already sitting
    // in the record is not thrown away. Move the guard first and this goes red.
    const task = record({
      revision: 1,
      writeLog: [{ id: "mine", revision: 1 }],
      writeLogTruncated: false,
    });
    expect(didWriteLand(task, token("mine", undefined))).toBe(true);
  });

  it("answers cannot-tell for a task carrying no provenance at all", () => {
    // A row persisted before this shipped, or one written by a hand-written ref
    // that maintains none. Absence is the cannot-tell signal — answering "did
    // not land" here is the confident wrong answer the primitive exists to
    // remove, and needs no migration or brand to avoid.
    expect(didWriteLand(record({}), token("mine", 3))).toBeUndefined();
  });

  it("answers cannot-tell for a missing task", () => {
    expect(didWriteLand(undefined, token("mine", 3))).toBeUndefined();
  });

  it("answers did-not-land when nothing has committed since the baseline", () => {
    const task = record({ revision: 4, writeLogTruncated: false });
    expect(didWriteLand(task, token("mine", 4))).toBe(false);
  });

  it("answers did-not-land when a retained receipt predates the baseline", () => {
    // The busy-task proof. The log is FULL, so "under the cap" says nothing —
    // what proves coverage is that a receipt at revision 3 survived, and
    // eviction is oldest-first, so nothing at or below 3 can have been dropped
    // while it is still here.
    const task = record({
      revision: 9,
      writeLog: [
        { id: "older", revision: 3 },
        { id: "a", revision: 6 },
        { id: "b", revision: 7 },
        { id: "c", revision: 9 },
      ],
      writeLogTruncated: true,
    });
    expect(didWriteLand(task, token("mine", 3))).toBe(false);
  });

  it("answers did-not-land on a first attempt, whose log is empty", () => {
    // The commonest routine history, and the one the never-dropped marker
    // exists for: `addTask`, the claim, a reclaim and the replacement claim all
    // bump the revision and mint no receipt, so there is no older receipt to
    // prove coverage with. Without the marker this would escalate to
    // cannot-tell on the ordinary path.
    const task = record({ revision: 4, writeLog: [], writeLogTruncated: false });
    expect(didWriteLand(task, token("mine", 1))).toBe(false);
  });

  it("answers cannot-tell when the receipt may have been evicted", () => {
    // Every retained receipt is NEWER than the baseline and the log has dropped
    // something, so mine may have been one of them. A membership test answers a
    // confident "did not land" here — this is the case it gets wrong.
    const task = record({
      revision: 9,
      writeLog: [
        { id: "a", revision: 6 },
        { id: "b", revision: 7 },
        { id: "c", revision: 8 },
        { id: "d", revision: 9 },
      ],
      writeLogTruncated: true,
    });
    expect(didWriteLand(task, token("mine", 3))).toBeUndefined();
  });

  it("answers cannot-tell rather than did-not-land when the window evicted past the baseline", () => {
    // Sound, deliberately NOT complete. The truth here is "did not land", and
    // the rule withholds it rather than inventing the reasoning to reach it.
    // Pinned so a later "optimisation" that turns this into `false` fails a
    // test instead of shipping a lie.
    const task = record({
      revision: 12,
      writeLog: [
        { id: "a", revision: 9 },
        { id: "b", revision: 10 },
        { id: "c", revision: 11 },
        { id: "d", revision: 12 },
      ],
      writeLogTruncated: true,
    });
    expect(didWriteLand(task, token("never-written", 2))).toBeUndefined();
  });

  it("answers cannot-tell when the record's revision went backwards", () => {
    // Only reachable through the documented mixed-writer precondition: a
    // hand-written ref sharing the storage wrote this row from a stale
    // snapshot. Both coverage proofs assume a monotonic revision, so on a
    // record that broke it they establish nothing. Without this guard the
    // never-dropped arm below would answer a confident "did not land".
    const task = record({ revision: 2, writeLog: [], writeLogTruncated: false });
    expect(didWriteLand(task, token("mine", 7))).toBeUndefined();
  });

  it("reads no cap constant, so an old record survives a cap change", () => {
    // A log of six under a hypothetical larger cap still answers from the same
    // two proofs. The arms compare revisions and one boolean; nothing counts
    // entries, which is what makes changing the cap a size decision rather than
    // a correctness one.
    const task = record({
      revision: 20,
      writeLog: [
        { id: "a", revision: 4 },
        { id: "b", revision: 8 },
        { id: "c", revision: 12 },
        { id: "d", revision: 16 },
        { id: "e", revision: 18 },
        { id: "f", revision: 20 },
      ],
      writeLogTruncated: true,
    });
    expect(didWriteLand(task, token("mine", 5))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Backing harness
// ---------------------------------------------------------------------------

interface Backing {
  collection: TaskCollectionRef;
  events: TaskChangeEvent[];
  /** Make the next change announcement throw — the commit-then-throw seam. */
  breakAnnouncements: (broken: boolean) => void;
  setNow: (n: number) => void;
}

type BackingFactory = () => Promise<Backing>;

/** Wrap a capture so announcements can be made to throw on demand. */
function breakableChanges() {
  const captured = createCapturedChanges();
  let broken = false;
  return {
    events: captured.events,
    breakAnnouncements: (next: boolean) => {
      broken = next;
    },
    onChange: (event: TaskChangeEvent) => {
      captured.onChange(event);
      if (broken) throw new Error("the change announcement fell over");
    },
  };
}

const sequencerBacking: BackingFactory = async () => {
  let clock = 1000;
  const captured = breakableChanges();
  return {
    collection: createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: createFakeSequencerState<{ tasks: Record<string, unknown> }>({ tasks: {} }),
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
    breakAnnouncements: captured.breakAnnouncements,
    setNow: (n) => {
      clock = n;
    },
  };
};

const resourceBacking: BackingFactory = async () => {
  let clock = 1000;
  const captured = breakableChanges();
  return {
    collection: await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: createFakeResourceCollection(),
      onChange: captured.onChange,
      now: () => clock,
    }),
    events: captured.events,
    breakAnnouncements: captured.breakAnnouncements,
    setNow: (n) => {
      clock = n;
    },
  };
};

const backings: Array<[string, BackingFactory]> = [
  ["sequencer-backed", sequencerBacking],
  ["resource-backed", resourceBacking],
];

/**
 * One correlated, committed write on a `pending`/`blocked` task.
 *
 * `pending → blocked → pending` is the only round trip that can be repeated
 * indefinitely without settling the task, which is what filling and then
 * overflowing the log needs.
 */
function correlatedWrite(
  collection: TaskCollectionRef,
  id: string,
  blocked: boolean,
  write: TaskWriteToken
): Promise<unknown> {
  return blocked
    ? collection.unblock(id, { write })
    : collection.block(id, "parked", { write });
}

/** The provenance a task is carrying right now. */
function provenanceOf(collection: TaskCollectionRef, id: string) {
  const task = collection.get(id);
  return {
    revision: task?.revision,
    writeLog: task?.writeLog ?? [],
    truncated: task?.writeLogTruncated,
  };
}

// ---------------------------------------------------------------------------
// The two histories
// ---------------------------------------------------------------------------

describe.each(backings)("%s — the two histories", (_name, makeBacking) => {
  /**
   * Play out FIX-963's histories on one board.
   *
   * Both end with the task `in_progress` on attempt 2, held by a second worker.
   * `landed` says whether the first worker's retry write actually committed.
   */
  async function history(landed: boolean) {
    const backing = await makeBacking();
    const { collection } = backing;
    await collection.addTask({ id: "t", goal: "t", maxAttempts: 3 });

    // Worker A takes the task and opens a correlated write against it.
    const mine = await collection.claim("worker-a");
    const claim = ticketForClaim(collection.collectionId, mine!);
    const write = beginTaskWrite(collection.get("t"));

    if (landed) {
      // A's retry write COMMITS, and the announcement then falls over. The
      // rejection is the whole problem: it carries no verdict, so without
      // provenance A has nothing but a later read to go on.
      backing.breakAnnouncements(true);
      await expect(
        collection.fail("t", "worker crashed", { ifAllowed: true, claim, write })
      ).rejects.toThrow("the change announcement fell over");
      backing.breakAnnouncements(false);
    } else {
      // A's write NEVER LANDS. The lease expires, a reclaim re-queues the task,
      // and A's late write is then refused — nothing is written at all.
      backing.setNow(999_999);
      expect(await collection.reclaim(999_999)).toBe(1);
    }

    // Either way, a second worker picks the task up.
    const theirs = await collection.claim("worker-b");
    expect(theirs?.id).toBe("t");

    if (!landed) {
      const refused = await collection.fail("t", "worker crashed", {
        ifAllowed: true,
        claim,
        write,
      });
      expect(refused).toEqual({
        outcome: "declined",
        reason: "lost-claim",
        status: "in_progress",
      });
    }

    return { collection, write };
  }

  it("both histories, told apart — and identical without provenance", async () => {
    const committed = await history(true);
    const lost = await history(false);

    const a = committed.collection.get("t")!;
    const b = lost.collection.get("t")!;

    // FIRST: the ambiguity is real. Everything a post-hoc classifier can read
    // agrees across the two. If this assertion ever fails, the separation below
    // is being measured against a difference that was already visible and the
    // test has stopped proving anything.
    expect({ status: a.status, attempts: a.attempts }).toEqual({
      status: b.status,
      attempts: b.attempts,
    });
    expect(a.status).toBe("in_progress");
    expect(a.attempts).toBe(2);

    // THEN: provenance separates them. Both arms in one test, so a stub that
    // always answers `true` — or a membership test that answers `false` on the
    // committed history — fails here rather than passing half the suite.
    expect(didWriteLand(a, committed.write)).toBe(true);
    expect(didWriteLand(b, lost.write)).toBe(false);
  });

  it("the committed write's receipt survives the claim that follows it", async () => {
    // The property inference cannot have: the answer outlives the next write.
    const { collection, write } = await history(true);
    const task = collection.get("t")!;
    expect(task.writeLog?.some((r) => r.id === write.id)).toBe(true);
    // The claim after it bumped the revision past the receipt's, which is
    // exactly the state a "has anything changed" check would call displaced.
    expect(task.revision).toBeGreaterThan(task.writeLog![0]!.revision);
  });

  it("the lost write leaves no receipt, and the reclaim and claim leave none either", async () => {
    const { collection } = await history(false);
    expect(provenanceOf(collection, "t").writeLog).toEqual([]);
    expect(provenanceOf(collection, "t").truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The stamp
// ---------------------------------------------------------------------------

describe.each(backings)("%s — what the stamp records", (_name, makeBacking) => {
  it("starts a task at revision 1 with no log and nothing dropped", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t" });
    expect(provenanceOf(collection, "t")).toEqual({
      revision: 1,
      writeLog: [],
      truncated: false,
    });
  });

  it("bumps the revision on every committed write, whichever method made it", async () => {
    // Tenet 5's enumeration, as a test: a method that writes without bumping is
    // not just missing its own answer, it makes a LATER eviction judgment
    // wrong. Every mutating path on the ref is walked here, in one legal
    // lifecycle, and each is checked against what it should have done.
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t", maxAttempts: 5 });

    /** Run one write and assert whether it advanced the record. */
    async function step(what: string, run: () => Promise<unknown>, commits: boolean) {
      const before = provenanceOf(collection, "t").revision!;
      await run();
      const after = provenanceOf(collection, "t").revision!;
      expect({ what, delta: after - before }).toEqual({ what, delta: commits ? 1 : 0 });
    }

    expect(provenanceOf(collection, "t").revision).toBe(1);

    await step("claim", () => collection.claim("w"), true);
    await step("setPriority", () => collection.setPriority("t", 5), true);
    await step("addLabel", () => collection.addLabel("t", "x"), true);
    await step("removeLabel", () => collection.removeLabel("t", "x"), true);
    await step("patchMetadata", () => collection.patchMetadata("t", { k: 1 }), true);
    await step("setAssignee", () => collection.setAssignee("t", "someone"), true);
    await step("awaitReview", () => collection.awaitReview("t", "look"), true);
    await step("resumeFromReview", () => collection.resumeFromReview("t"), true);
    await step("block", () => collection.block("t", "waiting"), true);
    await step("unblock", () => collection.unblock("t"), true);
    await step("claim (2nd)", () => collection.claim("w"), true);
    await step("fail (soft, re-pends)", () => collection.fail("t", "boom"), true);
    await step("claim (3rd)", () => collection.claim("w"), true);
    await step("reclaim", () => collection.reclaim(999_999), true);
    await step("claim (4th)", () => collection.claim("w"), true);
    await step("complete", () => collection.complete("t", { ok: true }), true);
    // The one that must NOT move it: declined on a settled task.
    await step("cancel (declined)", () => collection.cancel("t", "too late"), false);

    // No token was ever supplied, so nothing accumulated a receipt.
    expect(provenanceOf(collection, "t").writeLog).toEqual([]);
  });

  it("mints a receipt only when a caller supplied a token", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t", maxAttempts: 5 });
    await collection.claim("w");

    // Off-state (BP-035): a call omitting the token still advances the record.
    await collection.awaitReview("t", "no token");
    expect(provenanceOf(collection, "t").writeLog).toEqual([]);
    const before = provenanceOf(collection, "t").revision!;

    const write = beginTaskWrite(collection.get("t"));
    await collection.resumeFromReview("t", "with a token", { write });
    const after = provenanceOf(collection, "t");
    expect(after.revision).toBe(before + 1);
    expect(after.writeLog).toEqual([{ id: write.id, revision: after.revision }]);
  });

  it("records nothing for a declined write", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t" });
    await collection.claim("w");
    await collection.complete("t", { ok: true });
    const settled = provenanceOf(collection, "t");

    const write = beginTaskWrite(collection.get("t"));
    const verdict = await collection.complete("t", { ok: false }, { ifAllowed: true, write });
    expect(verdict.outcome).toBe("declined");
    expect(provenanceOf(collection, "t")).toEqual(settled);
    expect(didWriteLand(collection.get("t"), write)).toBe(false);
  });

  it("records nothing for a no-op write", async () => {
    // Stamping on every call would make "my receipt is absent" stop meaning
    // "my write changed nothing", which is the question this answers.
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t", priority: 3 });
    const before = provenanceOf(collection, "t");
    const verdict = await collection.setPriority("t", 3);
    expect(verdict).toEqual({ outcome: "unchanged" });
    expect(provenanceOf(collection, "t")).toEqual(before);
  });

  it("evicts oldest-first at the cap and flips the marker exactly once", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t" });
    const tokens: TaskWriteToken[] = [];

    for (let i = 0; i < CAP + 2; i += 1) {
      const write = beginTaskWrite(collection.get("t"));
      tokens.push(write);
      await correlatedWrite(collection, "t", i % 2 === 1, write);
      if (i < CAP - 1) {
        expect(provenanceOf(collection, "t").truncated).toBe(false);
      }
    }

    const state = provenanceOf(collection, "t");
    expect(state.writeLog).toHaveLength(CAP);
    expect(state.truncated).toBe(true);
    // Newest-last, oldest gone.
    expect(state.writeLog.map((r) => r.id)).toEqual(tokens.slice(-CAP).map((t) => t.id));
    // Revisions ascend, which is what makes the coverage proofs sound.
    expect(state.writeLog.map((r) => r.revision)).toEqual(
      [...state.writeLog].map((r) => r.revision).sort((a, b) => a - b)
    );
  });

  it("never unflips the marker once a receipt has been dropped", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t" });
    for (let i = 0; i < CAP + 1; i += 1) {
      const write = beginTaskWrite(collection.get("t"));
      await correlatedWrite(collection, "t", i % 2 === 1, write);
    }
    expect(provenanceOf(collection, "t").truncated).toBe(true);

    // Later writes that mint no receipt must not reset it.
    await collection.setPriority("t", 9);
    await collection.patchMetadata("t", { k: 1 });
    expect(provenanceOf(collection, "t").truncated).toBe(true);
  });

  it("an evicted caller gets cannot-tell, never a false did-not-land", async () => {
    const { collection } = await makeBacking();
    await collection.addTask({ id: "t", goal: "t" });
    const first = beginTaskWrite(collection.get("t"));
    await correlatedWrite(collection, "t", false, first);

    // CAP more correlated writes push `first` out of the window.
    for (let i = 0; i < CAP; i += 1) {
      const write = beginTaskWrite(collection.get("t"));
      await correlatedWrite(collection, "t", i % 2 === 0, write);
    }

    expect(provenanceOf(collection, "t").writeLog.some((r) => r.id === first.id)).toBe(false);
    expect(didWriteLand(collection.get("t"), first)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CAS replay
// ---------------------------------------------------------------------------

describe("a lost CAS round stamps once, off the state that committed", () => {
  /** Stand in for the writer that won the race, advancing the row it wrote. */
  const concurrent = (task: Task): Task => ({
    ...task,
    revision: (task.revision ?? 0) + 1,
    updatedAt: task.updatedAt + 1,
  });

  it("sequencer-backed", async () => {
    let clock = 1000;
    const seedState = createFakeSequencerState<{ tasks: Record<string, unknown> }>({
      tasks: {},
    });
    const seed = createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: seedState,
      now: () => clock,
    });
    await seed.addTask({ id: "t", goal: "t" });
    await seed.claim("w");

    const replaying = createFakeSequencerState<{ tasks: Record<string, unknown> }>(
      { tasks: { ...(seedState.__raw().tasks as Record<string, unknown>) } },
      {
        onReplay: (state) => {
          const tasks = state.tasks as Record<string, Task>;
          const next: Record<string, Task> = {};
          for (const [id, task] of Object.entries(tasks)) next[id] = concurrent(task);
          return { ...state, tasks: next };
        },
      }
    );
    const collection = createSequencerBackedTaskCollection({
      collectionId: "tasks",
      sequencer: replaying,
      now: () => clock,
    });

    const before = collection.get("t")!.revision!;
    const write = beginTaskWrite(collection.get("t"));
    await collection.complete("t", { ok: true }, { write });

    const after = collection.get("t")!;
    // +2: the concurrent writer's bump, then exactly one of ours. A stamp
    // derived from anything captured outside the mutator would double-count.
    expect(after.revision).toBe(before + 2);
    expect(after.writeLog).toEqual([{ id: write.id, revision: before + 2 }]);
    expect(didWriteLand(after, write)).toBe(true);
  });

  it("resource-backed", async () => {
    let clock = 1000;
    const resources = createFakeResourceCollection<Record<string, unknown>>(undefined, {
      onReplay: (state) => concurrent(state as unknown as Task) as unknown as typeof state,
    });
    // `addTask` goes through `create`, not `updateState`, so seeding through
    // the same collection is not itself replayed.
    const seed = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: resources,
      now: () => clock,
    });
    await seed.addTask({ id: "t", goal: "t" });

    const collection = await createResourceBackedTaskCollection({
      collectionId: "tasks",
      collection: resources,
      now: () => clock,
    });
    const before = collection.get("t")!.revision!;
    const write = beginTaskWrite(collection.get("t"));
    await collection.claim("w");
    await collection.complete("t", { ok: true }, { write });

    const after = collection.get("t")!;
    // Two replayed writes (the claim and the completion), each preceded by the
    // concurrent writer's bump: +4, and still exactly one receipt.
    expect(after.revision).toBe(before + 4);
    expect(after.writeLog).toEqual([{ id: write.id, revision: before + 4 }]);
    expect(didWriteLand(after, write)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The durable strip
// ---------------------------------------------------------------------------

describe("the persisted shape carries provenance", () => {
  it("round-trips all three fields through the durable task envelope", () => {
    // The single most likely way to ship this broken: a durable task is
    // validated by `taskEnvelopeSchema` on its way to the store, Zod object
    // schemas strip keys they do not declare, and the two in-memory backings
    // run no schema at all — so undeclared fields would look perfect in every
    // other test in this file and vanish on the one backing that persists.
    const envelope = taskEnvelopeSchema(z.object({ topic: z.string() }));
    const parsed = envelope.parse({
      id: "t",
      goal: "t",
      status: "in_progress",
      attempts: 1,
      createdAt: 0,
      updatedAt: 0,
      input: { topic: "x" },
      revision: 7,
      writeLog: [{ id: "w", revision: 7 }],
      writeLogTruncated: true,
    }) as Task;

    expect(parsed.revision).toBe(7);
    expect(parsed.writeLog).toEqual([{ id: "w", revision: 7 }]);
    expect(parsed.writeLogTruncated).toBe(true);
  });

  it("accepts a legacy task that carries none of them", () => {
    const envelope = taskEnvelopeSchema(z.unknown());
    const parsed = envelope.parse({
      id: "t",
      goal: "t",
      status: "pending",
      attempts: 0,
      createdAt: 0,
      updatedAt: 0,
    }) as Task;
    expect(parsed.revision).toBeUndefined();
    expect(parsed.writeLogTruncated).toBeUndefined();
  });
});

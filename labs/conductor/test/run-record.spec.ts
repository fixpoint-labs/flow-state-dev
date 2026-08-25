/**
 * The run record: its two key vocabularies, and obligation A's fence.
 *
 * The fence is tested at its own seam with fake collections, because the thing
 * under test is a RELATIONSHIP between two rows at one instant — the board's
 * claim and the run row's marker disagreeing — and staging that through a live
 * board would mean racing a lease renewal to reproduce it.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { conductorFlow } from "../src/flow";
import { encodeSegment, joinIdentity } from "../src/workspace";
import { runRecordCollection } from "../src/run-record";
import {
  RUNS,
  openRunRow,
  runTopic,
  runTopicPrefix,
  writeRunRow,
  type AttemptIdentity,
  type RunRecordState,
} from "../src/run-record";

const BOARD = "conductor-tasks-test";
const ISSUE = "FIX-1219";
const PHASE = "implement";
const EPIC = "conductor-tasks-test-epic";
const TOPIC = runTopic(EPIC, ISSUE, PHASE);
const TASK = "task_1";

/**
 * A collection that keys and merges the way a real one does.
 *
 * The pattern prefix is prepended here exactly as `resolveCollectionKey` does,
 * so `path` is the STORAGE key and the doubled-prefix bug is visible rather than
 * abstracted away. `upsert` patch-merges, which is what makes the clearing rule
 * necessary in the first place.
 */
function fakeCollection(prefix: string) {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async getOptional(key: string) {
      const stored = rows.get(key);
      return stored === undefined
        ? undefined
        : { state: stored, path: `${prefix}/${key}` };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      rows.set(key, { ...rows.get(key), ...update });
      return { state: rows.get(key), path: `${prefix}/${key}` };
    },
    async list(keyPrefix?: string) {
      return [...rows.entries()]
        .filter(([key]) => keyPrefix === undefined || key.startsWith(keyPrefix))
        .map(([key, state]) => ({ state, path: `${prefix}/${key}` }));
    },
  };
}

/** A context carrying just the two collections the fence reads. */
function contextWith(runs: ReturnType<typeof fakeCollection>, board: ReturnType<typeof fakeCollection>) {
  return { resources: { [RUNS]: runs, [BOARD]: board } } as unknown as BlockContext;
}

function identity(attempt: number): AttemptIdentity {
  return { taskId: TASK, attempt, topic: TOPIC, boardCollectionId: BOARD };
}

/** A board row as a claim leaves it. */
function claimed(attempts: number, status = "in_progress") {
  return { id: TASK, status, attempts };
}

describe("the run record — the two key vocabularies", () => {
  it("resolves what it is written with, in both spellings", async () => {
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    await board.upsert(TASK, claimed(1));
    const ctx = contextWith(runs, board);

    await openRunRow(ctx, identity(1), { workspacePath: "/w/a", branch: "b" });

    // Written and read by the BARE topic.
    expect(await runs.getOptional(TOPIC)).toBeDefined();
    // A prefix listing of one issue's phases takes the bare prefix too.
    expect(await runs.list(runTopicPrefix(EPIC, ISSUE))).toHaveLength(1);

    // And the STORAGE key it produced carries the prefix exactly once. A
    // doubled `runs/runs/…` is the failure this pins, and every read written
    // the same wrong way would agree with it — which is why the literal is
    // asserted rather than a round trip.
    const stored = (await runs.getOptional(TOPIC))!.path;
    expect(stored).toBe(`runs/${EPIC}/${ISSUE}/${PHASE}`);
    // Which is what a route's `topicPrefix=runs/<epic>/<issue>/` then matches.
    expect(stored.startsWith(`runs/${runTopicPrefix(EPIC, ISSUE)}`)).toBe(true);
  });
});

describe("the run record — obligation A", () => {
  /**
   * **The restaged behaviour.** The original staged the older attempt writing
   * *after* the replacement already wrote — an ordering the real sequence
   * cannot produce, because the replacement spends that window WAITING for
   * ownership of the checkout and has not reached this row yet. A check that
   * cannot fire is not a check.
   *
   * This stages the ordering the reclaim actually produces: the board has
   * already moved to attempt 2 (the counter is incremented inside the claim
   * write, before anything is dispatched), the replacement has not yet opened
   * the row, and the displaced attempt 1 — still alive, still unaware — writes
   * its verdict.
   *
   * A row-local fence PERMITS this write: the row carries attempt 1's own
   * marker, and such a fence has to permit same-attempt progress or the live
   * attempt could never write at all. Only a fence that reads the board refuses
   * it. Verified by reverting `writeRunRow` to a row-local check and watching
   * this go red.
   */
  it("refuses a displaced attempt's write while the row still carries its own marker", async () => {
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);

    // Attempt 1 claims and opens the row.
    await board.upsert(TASK, claimed(1));
    await openRunRow(ctx, identity(1), { workspacePath: "/w/a", branch: "b" });

    // The lease lapses and attempt 2 is claimed. The board's counter moves; the
    // run row does not, because attempt 2 is still waiting for the checkout.
    await board.upsert(TASK, claimed(2));
    const rowBefore = (await runs.getOptional(TOPIC))!.state as RunRecordState;
    expect(rowBefore.attempt).toBe(1);

    // Attempt 1, still running, writes its verdict.
    const verdict = await writeRunRow(ctx, identity(1), {
      outcome: "succeeded",
      sessionId: "sess_displaced",
      reason: "attempt 1 thinks it finished",
    });

    expect(verdict).toBe("refused");
    const after = (await runs.getOptional(TOPIC))!.state as RunRecordState;
    expect(after.sessionId).toBeNull();
    expect(after.outcome).toBe("running");
    expect(after.reason).toBeNull();
  });

  it("still refuses once the replacement HAS opened the row", async () => {
    // The other half of the same window — the replacement got the checkout
    // first. Both orderings must refuse, and the row must read the
    // replacement's values afterwards.
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);

    await board.upsert(TASK, claimed(1));
    await openRunRow(ctx, identity(1), { workspacePath: "/w/a", branch: "b" });
    await board.upsert(TASK, claimed(2));
    await openRunRow(ctx, identity(2), { workspacePath: "/w/a", branch: "b" });
    await writeRunRow(ctx, identity(2), { sessionId: "sess_live" });

    expect(await writeRunRow(ctx, identity(1), { sessionId: "sess_stale" })).toBe(
      "refused",
    );
    const after = (await runs.getOptional(TOPIC))!.state as RunRecordState;
    expect(after.attempt).toBe(2);
    expect(after.sessionId).toBe("sess_live");
  });

  it("permits the live attempt's own progress", async () => {
    // The constraint that rules out the naive "refuse anything that is not
    // strictly newer": one attempt writes its row several times.
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);

    await board.upsert(TASK, claimed(3));
    expect(await openRunRow(ctx, identity(3), { workspacePath: "/w/a", branch: "b" })).toBe(
      "applied",
    );
    expect(await writeRunRow(ctx, identity(3), { sessionId: "s" })).toBe("applied");
    expect(await writeRunRow(ctx, identity(3), { outcome: "succeeded" })).toBe("applied");
  });

  it("refuses a write once the row is no longer in a status an attempt owns", async () => {
    // The counter alone is not ownership: `reclaim()` returns a row to
    // `pending` WITHOUT touching `attempts`, so in the window before the next
    // claim a displaced worker matches the counter by construction.
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);

    await board.upsert(TASK, claimed(1));
    await openRunRow(ctx, identity(1), { workspacePath: "/w/a", branch: "b" });
    await board.upsert(TASK, claimed(1, "pending"));

    expect(await writeRunRow(ctx, identity(1), { sessionId: "s" })).toBe("refused");
  });
});

describe("the run record — the clearing rule", () => {
  it("clears the previous attempt's metadata when a new attempt opens", async () => {
    // `upsert` patch-merges, so a field an update omits survives. Writing only
    // what this attempt can report would leave attempt 1's session id and cost
    // beside attempt 2's outcome — a row claiming to describe a run it does not
    // describe.
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);

    await board.upsert(TASK, claimed(1));
    await openRunRow(ctx, identity(1), { workspacePath: "/w/a", branch: "b" });
    await writeRunRow(ctx, identity(1), {
      sessionId: "sess_one",
      finalMessage: "attempt one said this",
      costUsd: 1.25,
      outcome: "failed",
      reason: "ran out of turns",
    });

    await board.upsert(TASK, claimed(2));
    await openRunRow(ctx, identity(2), { workspacePath: "/w/a", branch: "b" });

    const row = (await runs.getOptional(TOPIC))!.state as RunRecordState;
    expect(row.sessionId).toBeNull();
    expect(row.finalMessage).toBeNull();
    expect(row.costUsd).toBeNull();
    expect(row.reason).toBeNull();
    // The checkout and branch are re-stated, not cleared — they describe the
    // issue-phase, not the attempt.
    expect(row.workspacePath).toBe("/w/a");
    expect(row.attempt).toBe(2);
  });
});

describe("the manager — a phase cannot claim the manager's own collections", () => {
  const EPIC = "reserved-test";
  const workspace = { root: "/tmp/conductor-reserved", sourceRepo: "/tmp/x", baseRef: "main" };

  /** Build a conductor whose phase declares `readable`, and nothing else. */
  const withReadable = (readable: Record<string, unknown>) => () =>
    conductorFlow({
      epic: EPIC,
      workspace,
      runTimeoutMs: 30_000,
      phase: {
        phase: "implement",
        readable: readable as never,
        buildPrompt: () => "go",
        isDone: () => true,
      },
    });

  it("refuses a phase whose readable set names the run record", () => {
    // Overriding `runs` sends the manager's bookkeeping into a collection
    // `status` never reads: the row is written, and every read answers nothing.
    expect(withReadable({ [RUNS]: runRecordCollection })).toThrow(/the manager owns/);
  });

  it("refuses a phase whose readable set names the board ledger", () => {
    // Worse than the run record. The live-claim fence would consult unrelated
    // rows — defeating obligation A while every test that does not stage two
    // attempts still passes.
    expect(withReadable({
        // The manager's own board accessor, derived the way the flow derives it
        // rather than spelled out — so an encoding change cannot make this test
        // silently stop naming the reserved key.
        [joinIdentity("conductor-tasks", encodeSegment("single-tenant"), EPIC)]: runRecordCollection,
      })).toThrow(
      /the manager owns/,
    );
  });

  it("accepts a phase that declares a collection of its own", () => {
    expect(withReadable({ "phase-notes": runRecordCollection })).not.toThrow();
  });
});

describe("two epics on one issue-phase get different run rows", () => {
  // The half that made this a WRONG answer rather than a missing one: without
  // the discriminator, either epic's manager overwrites the other's checkout,
  // session, cost and outcome, and `status` returns `run:` present and
  // belonging to someone else.
  it("resolves distinct topics and distinct storage keys", async () => {
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);
    await board.upsert(TASK, claimed(1));

    const alpha = runTopic("conductor-tasks-alpha", ISSUE, PHASE);
    const beta = runTopic("conductor-tasks-beta", ISSUE, PHASE);
    expect(alpha).not.toBe(beta);

    await writeRunRow(ctx, { ...identity(1), topic: alpha }, { sessionId: "sess_alpha" });
    await writeRunRow(ctx, { ...identity(1), topic: beta }, { sessionId: "sess_beta" });

    // Neither overwrote the other.
    expect(((await runs.getOptional(alpha))!.state as RunRecordState).sessionId).toBe(
      "sess_alpha",
    );
    expect(((await runs.getOptional(beta))!.state as RunRecordState).sessionId).toBe(
      "sess_beta",
    );
    // And each key stays under `runs/`, exactly once.
    expect((await runs.getOptional(alpha))!.path).toBe(`runs/${alpha}`);
  });

  it("still lists one epic's phases without seeing the other's", async () => {
    const runs = fakeCollection(RUNS);
    const board = fakeCollection(BOARD);
    const ctx = contextWith(runs, board);
    await board.upsert(TASK, claimed(1));

    await writeRunRow(
      ctx,
      { ...identity(1), topic: runTopic("conductor-tasks-alpha", ISSUE, PHASE) },
      { sessionId: "a" },
    );
    await writeRunRow(
      ctx,
      { ...identity(1), topic: runTopic("conductor-tasks-beta", ISSUE, PHASE) },
      { sessionId: "b" },
    );

    expect(await runs.list(runTopicPrefix("conductor-tasks-alpha", ISSUE))).toHaveLength(1);
  });
});

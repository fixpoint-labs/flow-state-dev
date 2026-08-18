import { describe, it, expect } from "vitest";
import { resolve as resolvePath } from "node:path";
import {
  canonicalFilePathKey,
  createWorkRecorder,
  type UpsertableCollection,
} from "../../src/sdk/work-recorder";
import type { TranslatedEvent } from "../../src/sdk/types";

/**
 * A collection that records what it was asked to write and merges it the way a
 * real `upsert` does.
 *
 * `list` and `count` are present and THROW on purpose. They are not on the
 * `UpsertableCollection` surface, but a type-level absence proves nothing at run
 * time — and on a lazily-prefetched collection either of them triggers a load of
 * every historical row in the workstream, which is the cost the lazy
 * declaration exists to avoid. If the recorder ever reaches for one, these turn
 * a silent performance regression into a red test.
 */
function fakeCollection(): UpsertableCollection & {
  rows: Map<string, Record<string, unknown>>;
  writes: Array<{ key: string; update: Record<string, unknown> }>;
} {
  const rows = new Map<string, Record<string, unknown>>();
  const writes: Array<{ key: string; update: Record<string, unknown> }> = [];
  return {
    rows,
    writes,
    async upsert(key, update) {
      writes.push({ key, update: { ...update } });
      rows.set(key, { ...rows.get(key), ...update });
    },
    list() {
      throw new Error("the recorder must never list a lazily-prefetched collection");
    },
    count() {
      throw new Error("the recorder must never count a lazily-prefetched collection");
    },
  } as UpsertableCollection & {
    rows: Map<string, Record<string, unknown>>;
    writes: Array<{ key: string; update: Record<string, unknown> }>;
  };
}

/**
 * A run id shaped like a real request id, invented rather than borrowed.
 *
 * The keys below are the COLLECTION keys the recorder passes to `upsert`
 * (`<runId>/<segment>`). A live ref prepends the collection's pattern prefix on
 * top, so the same row is `observed-file-ops/<runId>/<segment>` in the store and
 * `<runId>/<segment>` as the read route's `topic`.
 */
/**
 * A path the collection key normalizer REJECTS. The escape is spelled out
 * rather than pasted raw so a reader can see what makes it unkeyable: a
 * control character survives canonicalization (a `..` does not — it gets
 * collapsed away), and the normalizer refuses it.
 */
const BAD_PATH = `/work/src/bad${String.fromCharCode(7)}name.ts`;

const RUN = "req_alpha";
const OTHER_RUN = "req_beta";

/** Build a recorder over two fresh fakes and hand back all three. */
function harness(overrides: { runId?: string; flushIntervalMs?: number } = {}) {
  const files = fakeCollection();
  const plan = fakeCollection();
  const gaps = fakeCollection();
  const notes: string[] = [];
  const recorder = createWorkRecorder({
    runId: overrides.runId ?? RUN,
    files,
    plan,
    gaps,
    ...(overrides.flushIntervalMs !== undefined
      ? { flushIntervalMs: overrides.flushIntervalMs }
      : {}),
    onSkipped: (note) => notes.push(note),
    now: () => 1_700_000_000_000,
  });
  return { files, plan, gaps, notes, recorder };
}

/**
 * One call's attempt on a path. `callId` defaults to the path, so a fixture
 * that does not care about concurrency still gets ONE stable identity per
 * subject — and a fixture that does care can name two calls on one path, which
 * is the case the recorder has to keep apart.
 */
const fileCall = (path: string, callId = `call:${path}`): TranslatedEvent => ({
  kind: "file_op_observed",
  callId,
  path,
  op: "created",
  outcome: "pending",
});
const fileSettled = (
  path: string,
  outcome: "applied" | "failed",
  callId = `call:${path}`,
): TranslatedEvent => ({
  kind: "file_op_observed",
  callId,
  path,
  op: "created",
  outcome,
});

describe("createWorkRecorder — file operations", () => {
  it("records an attempted mutation before its result arrives, so a killed run keeps it", async () => {
    const { files, recorder } = harness();
    recorder.observe(fileCall("/work/src/checkout.ts"));
    await recorder.stop();

    expect([...files.rows.keys()]).toEqual([`${RUN}/work/src/checkout.ts`]);
    expect(files.rows.get(`${RUN}/work/src/checkout.ts`)).toMatchObject({
      lastKind: "created",
      outcome: "pending",
    });
  });

  it("settles the entry to applied when the result confirms it", async () => {
    const { files, recorder } = harness();
    recorder.observe(fileCall("/work/src/checkout.ts"));
    await recorder.flush();
    recorder.observe(fileSettled("/work/src/checkout.ts", "applied"));
    await recorder.stop();

    expect(files.rows.get(`${RUN}/work/src/checkout.ts`)).toMatchObject({
      outcome: "applied",
    });
  });

  it("records a failed mutation rather than dropping it", async () => {
    // Absence would be indistinguishable from "never attempted", which is the
    // one reading a record of what a run did must not make ambiguous.
    const { files, recorder } = harness();
    recorder.observe(fileCall("/work/src/checkout.ts"));
    recorder.observe(fileSettled("/work/src/checkout.ts", "failed"));
    await recorder.stop();

    expect(files.rows.get(`${RUN}/work/src/checkout.ts`)).toMatchObject({
      outcome: "failed",
    });
  });

  it("coalesces repeated touches of one path into a single write", async () => {
    const { files, recorder } = harness();
    recorder.observe(fileCall("/work/src/checkout.ts"));
    recorder.observe(fileSettled("/work/src/checkout.ts", "applied"));
    recorder.observe(fileSettled("/work/src/checkout.ts", "applied"));
    await recorder.stop();

    expect(files.writes).toHaveLength(1);
  });

  it("flushes on its own interval, without waiting to be stopped", async () => {
    // The half that keeps a killed run's record: a run cancelled between the
    // write and the end of the run has to have already persisted something.
    const { files, recorder } = harness({ flushIntervalMs: 5 });
    recorder.observe(fileCall("/work/src/checkout.ts"));
    expect(files.writes).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 40));
    expect(files.writes).toHaveLength(1);
    await recorder.stop();
  });

  it("keeps a row unsettled while another call on the same path is in flight", async () => {
    // The record is keyed by SUBJECT (the path); mutations are per CALL. Two
    // calls can be open on one path at once, and the first result to arrive
    // must not settle the row the second is still using — otherwise an
    // interrupted second call leaves an `applied` row and its unresolved
    // mutation disappears from the readback entirely.
    const { files, recorder } = harness();
    const path = "/work/src/checkout.ts";
    recorder.observe(fileCall(path, "call_a"));
    recorder.observe(fileCall(path, "call_b"));
    recorder.observe(fileSettled(path, "applied", "call_a"));
    await recorder.stop();

    // `call_b` never came back, so the path still has an unresolved mutation.
    expect(files.rows.get(`${RUN}/work/src/checkout.ts`)).toMatchObject({
      outcome: "pending",
    });
  });

  it("keeps the unfinished call's kind while its outcome is still pending", async () => {
    // Metadata and outcome must describe the SAME call. A Write and an Edit
    // overlap on one path; the Write settles first. The outcome correctly stays
    // `pending` for the Edit — so letting the Write's `created` overwrite the
    // kind leaves a row whose outcome refers to one call and whose kind refers
    // to another, and a run that ends there records exactly that.
    const { files, recorder } = harness();
    const path = "/work/src/checkout.ts";
    recorder.observe(fileCall(path, "call_write"));
    recorder.observe({
      kind: "file_op_observed",
      callId: "call_edit",
      path,
      op: "edited",
      outcome: "pending",
    });
    recorder.observe(fileSettled(path, "applied", "call_write"));
    await recorder.stop();

    expect(files.rows.get(`${RUN}/work/src/checkout.ts`)).toMatchObject({
      lastKind: "edited",
      outcome: "pending",
    });
  });

  it("settles once the last in-flight call on a path comes back", async () => {
    const { files, recorder } = harness();
    const path = "/work/src/checkout.ts";
    recorder.observe(fileCall(path, "call_a"));
    recorder.observe(fileCall(path, "call_b"));
    recorder.observe(fileSettled(path, "applied", "call_a"));
    recorder.observe(fileSettled(path, "applied", "call_b"));
    await recorder.stop();

    expect(files.rows.get(`${RUN}/work/src/checkout.ts`)).toMatchObject({
      outcome: "applied",
    });
  });

  it("keeps two runs in one workstream apart", async () => {
    // A workstream session is REUSED across runs, so without the run id in the
    // key the second run's entry would merge into the first run's row by path
    // and the readback would answer for the workstream, not the run.
    // One shared store, as a reused workstream would have.
    const shared = fakeCollection();
    const a = createWorkRecorder({ runId: RUN, files: shared, plan: fakeCollection() });
    const b = createWorkRecorder({ runId: OTHER_RUN, files: shared, plan: fakeCollection() });

    a.observe(fileCall("/work/src/checkout.ts"));
    await a.stop();
    b.observe(fileCall("/work/src/checkout.ts"));
    await b.stop();

    expect([...shared.rows.keys()].sort()).toEqual([
      `${RUN}/work/src/checkout.ts`,
      `${OTHER_RUN}/work/src/checkout.ts`,
    ]);
  });
});

describe("canonicalFilePathKey", () => {
  it("gives one key to one file however the run spelled the path", () => {
    expect(canonicalFilePathKey("/work/repo/./src/a.ts")).toBe(
      canonicalFilePathKey("/work/repo/src/a.ts"),
    );
  });

  it("resolves a relative path against the run's working directory", () => {
    expect(canonicalFilePathKey("src/a.ts")).toBe(
      resolvePath("src/a.ts").replace(/\\/g, "/").replace(/^\/+/, ""),
    );
  });

  it("leaves no traversal segment behind, whatever it is handed", () => {
    // The collection key normalizer REJECTS `..`, and the recorder swallows the
    // rejection — so a canonicalization that emitted one would silently drop
    // every entry while the run looked healthy.
    for (const raw of ["/work/repo/../outside/a.ts", "../../way/outside/a.ts", "/../a.ts"]) {
      expect(canonicalFilePathKey(raw).split("/")).not.toContain("..");
    }
  });

  it("keeps a path outside the working directory, rather than dropping it", () => {
    // The goal check writes to an OS temp directory, which is outside any
    // checkout root. Encoding relative-to-a-root would make this the `..` case
    // above and the record would come back empty on a perfectly good run.
    expect(canonicalFilePathKey("/tmp/scratch-1234/notes.txt")).toBe("tmp/scratch-1234/notes.txt");
  });
});

describe("createWorkRecorder — plan items", () => {
  const created = (itemId: string, title: string): TranslatedEvent => ({
    kind: "plan_item_observed",
    callId: `call:create:${itemId}`,
    itemId,
    title,
    outcome: "applied",
  });
  const moved = (itemId: string, status: string): TranslatedEvent => ({
    kind: "plan_item_observed",
    callId: `call:move:${itemId}:${status}`,
    itemId,
    status,
    outcome: "applied",
  });

  it("records the item's wording under the harness's own id", async () => {
    const { plan, recorder } = harness();
    recorder.observe(created("5", "Create the file"));
    await recorder.stop();

    // No status: a create result does not say what state the item is in, and
    // inventing one would be recording a guess. The row's `status` reaches the
    // reader as the schema's null default, not as something observed.
    expect(plan.rows.get(`${RUN}/5`)).toMatchObject({
      title: "Create the file",
      lastOutcome: "applied",
    });
    expect(plan.rows.get(`${RUN}/5`)).not.toHaveProperty("status");
  });

  it("moves the previous status aside when the item moves", async () => {
    const { plan, recorder } = harness();
    recorder.observe(created("5", "Create the file"));
    recorder.observe(moved("5", "in_progress"));
    await recorder.flush();
    recorder.observe(moved("5", "completed"));
    await recorder.stop();

    expect(plan.rows.get(`${RUN}/5`)).toMatchObject({
      title: "Create the file",
      status: "completed",
      previousStatus: "in_progress",
    });
  });

  it("records the harness's own prior status on a FIRST move", async () => {
    // The case a derived `previousStatus` cannot serve: an item's first move
    // has nothing to derive from, because the create carried no status. The
    // harness described the whole transition, so the row must show it rather
    // than leaving `previousStatus` empty on data that was never missing.
    const { plan, recorder } = harness();
    recorder.observe(created("5", "Create the file"));
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call:inline",
      itemId: "5",
      status: "in_progress",
      previousStatus: "pending",
      outcome: "applied",
    });
    await recorder.stop();

    expect(plan.rows.get(`${RUN}/5`)).toMatchObject({
      status: "in_progress",
      previousStatus: "pending",
    });
  });

  it("prefers the harness's prior status over the one it derived itself", async () => {
    const { plan, recorder } = harness();
    recorder.observe(moved("5", "in_progress"));
    await recorder.flush();
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call:inline",
      itemId: "5",
      status: "completed",
      // The harness disagrees with what this recorder last saw. It is the one
      // holding the item; we are only watching.
      previousStatus: "blocked",
      outcome: "applied",
    });
    await recorder.stop();

    expect(plan.rows.get(`${RUN}/5`)).toMatchObject({
      status: "completed",
      previousStatus: "blocked",
    });
  });

  it("records a confirmed status even when the move was a no-op", async () => {
    // `{ from: "pending", to: "pending" }` is still the harness confirming the
    // item's current state. Gating the status on a CHANGE left the row at
    // `status: null` — a create records none — so the record denied a state the
    // harness had just confirmed.
    const { plan, recorder } = harness();
    recorder.observe(created("5", "Create the file"));
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call:inline",
      itemId: "5",
      status: "pending",
      previousStatus: "pending",
      outcome: "applied",
    });
    await recorder.stop();

    const row = plan.rows.get(`${RUN}/5`);
    expect(row).toMatchObject({ status: "pending" });
    // …and no transition is invented from a move that did not happen.
    expect(row).not.toHaveProperty("previousStatus");
  });

  it("does not derive a transition while another call on the item is in flight", async () => {
    // Deriving `previousStatus` assumes the statuses this recorder saw arrived
    // in the order they happened. Concurrent updates do not guarantee that, so
    // settling two out of order would assert a move backwards — one the harness
    // never described. When the ordering is unknowable, record no transition.
    const { plan, recorder } = harness();
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_a",
      itemId: "5",
      outcome: "pending",
    });
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_b",
      itemId: "5",
      outcome: "pending",
    });
    // `call_b` comes back first, with no `statusChange` to settle the question.
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_b",
      itemId: "5",
      status: "completed",
      outcome: "applied",
    });
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_a",
      itemId: "5",
      status: "in_progress",
      outcome: "applied",
    });
    await recorder.stop();

    const row = plan.rows.get(`${RUN}/5`);
    // The current status is still recorded — the harness confirmed it.
    expect(row).toMatchObject({ status: "in_progress" });
    // …but no transition is invented from an arrival order we cannot trust.
    expect(row).not.toHaveProperty("previousStatus");
  });

  it("still derives a transition when the harness reports the move itself", async () => {
    // The authoritative `from` describes the transition, not the arrival order,
    // so concurrency does not disqualify it.
    const { plan, recorder } = harness();
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_a",
      itemId: "5",
      outcome: "pending",
    });
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_b",
      itemId: "5",
      outcome: "pending",
    });
    recorder.observe({
      kind: "plan_item_observed",
      callId: "call_b",
      itemId: "5",
      status: "completed",
      previousStatus: "in_progress",
      outcome: "applied",
    });
    await recorder.stop();

    expect(plan.rows.get(`${RUN}/5`)).toMatchObject({
      status: "completed",
      previousStatus: "in_progress",
    });
  });

  it("does not invent a transition when a status is merely re-confirmed", async () => {
    const { plan, recorder } = harness();
    recorder.observe(moved("5", "in_progress"));
    await recorder.flush();
    recorder.observe(moved("5", "in_progress"));
    await recorder.stop();

    const row = plan.rows.get(`${RUN}/5`);
    expect(row?.status).toBe("in_progress");
    expect(row?.previousStatus).toBeUndefined();
  });

  it("records a rejected update as failed WITHOUT applying the status it asked for", async () => {
    // The worst available outcome is recording a move the harness refused, so
    // a failed attempt carries no status at all and leaves the row where the
    // harness has it.
    const { plan, recorder } = harness();
    recorder.observe(created("5", "Create the file"));
    recorder.observe(moved("5", "in_progress"));
    await recorder.flush();
    recorder.observe({ kind: "plan_item_observed", itemId: "5", outcome: "failed" });
    await recorder.stop();

    expect(plan.rows.get(`${RUN}/5`)).toMatchObject({
      status: "in_progress",
      lastOutcome: "failed",
    });
  });
});

describe("createWorkRecorder — watching the work never breaks the work", () => {
  it("does not propagate a collection write that throws, and leaves a durable gap", async () => {
    const exploding: UpsertableCollection = {
      async upsert() {
        throw new Error("store is down");
      },
    };
    const gaps = fakeCollection();
    const notes: string[] = [];
    const recorder = createWorkRecorder({
      runId: RUN,
      files: exploding,
      plan: fakeCollection(),
      gaps,
      onSkipped: (note) => notes.push(note),
    });

    recorder.observe(fileCall("/work/src/checkout.ts"));
    await expect(recorder.stop()).resolves.toBeUndefined();
    expect(notes.join(" ")).toContain("store is down");
    // The note is live-only in practice; this row is what a reader finds later.
    expect([...gaps.rows.values()]).toHaveLength(1);
    expect(String([...gaps.rows.values()][0].reason)).toContain("store is down");
  });

  it("still records the gap when a run's LAST act is a failing write", async () => {
    // Gaps drain after the two records inside the same flush, so a failure
    // raised by the final flush is written by that same flush rather than
    // waiting for a window that will never come.
    const exploding: UpsertableCollection = {
      async upsert() {
        throw new Error("store is down");
      },
    };
    const gaps = fakeCollection();
    const recorder = createWorkRecorder({
      runId: RUN,
      files: exploding,
      plan: fakeCollection(),
      gaps,
      flushIntervalMs: 60_000, // long enough that only `stop()` can flush
    });
    recorder.observe(fileCall("/work/src/checkout.ts"));
    await recorder.stop();

    expect([...gaps.rows.keys()]).toEqual([`${RUN}/000001`]);
  });

  it("does not let a THROWING report hook fail the run", async () => {
    // The hole this closes is in the reporting path — the one place nobody
    // defends, because it is the thing that reports failures. An unguarded
    // callback here rejects the serialized flush chain, so `stop()` throws and
    // a successful coding run is turned into a bookkeeping failure: exactly the
    // outcome the recorder exists to make impossible.
    const exploding: UpsertableCollection = {
      async upsert() {
        throw new Error("store is down");
      },
    };
    const recorder = createWorkRecorder({
      runId: RUN,
      files: exploding,
      plan: fakeCollection(),
      gaps: exploding,
      onSkipped: () => {
        throw new Error("the reporting hook itself is broken");
      },
    });

    recorder.observe(fileCall("/work/src/checkout.ts"));
    await expect(recorder.flush()).resolves.toBeUndefined();
    await expect(recorder.stop()).resolves.toBeUndefined();
  });

  it("leaves the attempt unsettled when the harness names a different path", async () => {
    // The settling event's fields describe the write the harness actually
    // performed, at ITS path. Stamping them onto a row keyed by the path the run
    // named would assert something happened to a file that may never have been
    // touched — so the gap is the whole record and the attempt keeps the
    // `pending` state it already had. Same rule as a plan update the harness
    // applied to a different item.
    const { files, gaps, recorder } = harness();
    recorder.observe(fileCall("/work/notes.txt"));
    recorder.observe({
      kind: "file_op_observed",
      callId: "call:inline",
      path: "/work/notes.txt",
      resolvedPath: "/work/elsewhere/notes.txt",
      op: "created",
      outcome: "applied",
    });
    await recorder.stop();

    expect([...files.rows.keys()]).toEqual([`${RUN}/work/notes.txt`]);
    // Unsettled — NOT "applied", which would claim a write we cannot confirm.
    expect(files.rows.get(`${RUN}/work/notes.txt`)).toMatchObject({ outcome: "pending" });
    expect([...gaps.rows.values()]).toHaveLength(1);
    expect(String([...gaps.rows.values()][0].reason)).toContain("/work/elsewhere/notes.txt");
  });

  it("stays quiet when canonicalization reconciles the two paths", async () => {
    // `notes.txt` and the absolute path it resolves to are the SAME key, so
    // comparing raw strings would raise a divergence that does not exist. This
    // is why the comparison lives here rather than in the translation layer.
    const { gaps, recorder } = harness();
    recorder.observe({
      kind: "file_op_observed",
      callId: "call:inline",
      path: "/work/./notes.txt",
      resolvedPath: "/work/notes.txt",
      op: "created",
      outcome: "applied",
    });
    await recorder.stop();

    expect([...gaps.rows.values()]).toHaveLength(0);
  });

  it("persists a gap raised by a write that failed mid-flush", async () => {
    // The invariant `stop()` depends on, and the reason it can flush once
    // rather than draining to quiescence: a flush drains gaps LAST, in the same
    // chained body as the file and plan writes, so a failure in either lands in
    // that same flush's gap batch. Snapshot the gaps any earlier and a gap
    // raised by a failing write waits for a flush that may never come — at
    // shutdown, never — losing it in the case where it is most informative,
    // because the thing that produced it was a failed write.
    let releaseWrite: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const slowFailingFiles: UpsertableCollection = {
      async upsert() {
        await held;
        throw new Error("store went away mid-write");
      },
    };
    const gaps = fakeCollection();
    const recorder = createWorkRecorder({
      runId: RUN,
      files: slowFailingFiles,
      plan: fakeCollection(),
      gaps,
      flushIntervalMs: 5,
    });

    recorder.observe(fileCall("/work/src/checkout.ts"));
    // Let the interval fire, so the write is genuinely in flight and the
    // pending maps are empty by the time `stop()` looks at them.
    await new Promise((r) => setTimeout(r, 40));

    const stopping = recorder.stop();
    releaseWrite();
    await stopping;

    expect([...gaps.rows.keys()]).toEqual([`${RUN}/000001`]);
    expect(String([...gaps.rows.values()][0].reason)).toContain("store went away mid-write");
  });

  it("keeps working without a gaps collection at all", async () => {
    const notes: string[] = [];
    const recorder = createWorkRecorder({
      runId: RUN,
      files: fakeCollection(),
      plan: fakeCollection(),
      onSkipped: (note) => notes.push(note),
    });
    recorder.observe(fileCall(BAD_PATH));
    await expect(recorder.stop()).resolves.toBeUndefined();
    expect(notes.join(" ")).toContain("could not be keyed");
  });

  it("skips a path that cannot be keyed, notes it, and keeps going", async () => {
    // A control character is the case that survives canonicalization: a `..`
    // is collapsed away, but the key normalizer rejects these outright.
    const { files, notes, recorder } = harness();
    recorder.observe(fileCall(BAD_PATH));
    recorder.observe(fileCall("/work/src/good.ts"));
    await recorder.stop();

    expect(notes.join(" ")).toContain("could not be keyed");
    expect([...files.rows.keys()]).toEqual([`${RUN}/work/src/good.ts`]);
  });

  it("leaves a durable gap row carrying the path that could not be keyed", async () => {
    // The commonest skip is a path that cannot BECOME a key, so the gap record
    // must not be keyed by it — the raw value lives in the row's state, where a
    // control character is just a character.
    const { gaps, recorder } = harness();
    recorder.observe(fileCall(BAD_PATH));
    await recorder.stop();

    expect([...gaps.rows.keys()]).toEqual([`${RUN}/000001`]);
    expect(gaps.rows.get(`${RUN}/000001`)).toMatchObject({
      rawPath: BAD_PATH,
      at: 1_700_000_000_000,
    });
    expect(String(gaps.rows.get(`${RUN}/000001`)?.reason)).toContain("could not be keyed");
  });

  it("says which record each gap stands in for, structurally", async () => {
    // A reader correlating tool activity against these records has to know
    // whether a gap accounts for a missing file row or a missing plan row. The
    // pathless cases carry no `rawPath` to infer it from, and recovering it by
    // matching words in `reason` would be grading by substring.
    const { gaps, recorder } = harness();
    recorder.observe(fileCall(BAD_PATH));
    recorder.observe({
      kind: "work_gap_observed",
      subject: "plan",
      reason: "a plan item was created and its id could not be read from the result",
    });
    recorder.observe({
      kind: "work_gap_observed",
      subject: "run",
      reason: "confirmation arrived for a batch and could not be attributed",
    });
    await recorder.stop();

    expect([...gaps.rows.values()].map((r) => r.kind)).toEqual(["file", "plan", "run"]);
  });

  it("records one gap row per skip, in the order they happened", async () => {
    // Not a count plus a capped reason list: a row per gap needs no cap policy
    // and no truncation flag, and the zero-padded ordinal makes the route's
    // lexicographic key order the order they occurred in.
    const { gaps, recorder } = harness();
    recorder.observe(fileCall(`${BAD_PATH}-one`));
    recorder.observe(fileCall(`${BAD_PATH}-two`));
    await recorder.stop();

    expect([...gaps.rows.keys()]).toEqual([`${RUN}/000001`, `${RUN}/000002`]);
    expect(gaps.rows.get(`${RUN}/000001`)?.rawPath).toBe(`${BAD_PATH}-one`);
    expect(gaps.rows.get(`${RUN}/000002`)?.rawPath).toBe(`${BAD_PATH}-two`);
  });

  it("records a gap the translation layer reported", async () => {
    // A recognised tool whose call carried nothing to key on is a gap, and it is
    // noticed one layer up — so the recorder has to accept one it did not raise.
    const { gaps, recorder } = harness();
    recorder.observe({
      kind: "work_gap_observed",
      reason: "a file mutation arrived with no path to record it under",
    });
    await recorder.stop();

    expect([...gaps.rows.keys()]).toEqual([`${RUN}/000001`]);
    // No path to carry — the gap is real, the raw value simply does not exist.
    expect(gaps.rows.get(`${RUN}/000001`)).not.toHaveProperty("rawPath");
    expect(String(gaps.rows.get(`${RUN}/000001`)?.reason)).toContain("no path");
  });

  it("ignores every event kind it does not consume", async () => {
    const { files, plan, recorder } = harness();
    recorder.observe({ kind: "message_complete", text: "hello" });
    recorder.observe({ kind: "tool_call", callId: "t1", name: "Bash", arguments: "{}" });
    recorder.observe({ kind: "status", message: "started" });
    await recorder.stop();

    expect(files.writes).toHaveLength(0);
    expect(plan.writes).toHaveLength(0);
  });
});

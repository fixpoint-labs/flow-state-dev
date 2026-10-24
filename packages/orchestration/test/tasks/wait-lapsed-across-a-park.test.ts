/**
 * A park ends what a lapsed wait slot holds (FIX-2170).
 *
 * A request's wait on T1 lapses at its deadline, with T1 still running. While
 * the request runs, an ending T1 reaches is held for it, so its next read of
 * T1 gets the ending. Once the request parks (on a person, or on another
 * wait), it holds nothing: T1's ending goes to the filer's `onTaskSettled`
 * within seconds of the park, the way a task the parked request filed does
 * (FIX-2149), and a wait on T1 after the resume, the notice heard, answers
 * with T1 (FIX-2181). The filer's notice runs once.
 *
 * Each runs on the in-memory stores and on SQLite.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inMemoryStores, type StoreAdapter } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import type { TaskSettledInput } from "../../src";
import { NOTICE_DUE_MS } from "../../src/tasks";
import { lapsedSlotsHeldInProcess } from "../../src/tasks/helpers/wait-on-task";
import {
  act,
  approve,
  awaitApproval,
  fileCall,
  finalAnswer,
  finishTask,
  rows,
  runtimeFor,
  stepModel,
  toolResults,
  until,
  untilTakersEnded,
  waitAgain,
  waitCall,
  waitedTaskId,
  waitFlow,
  type StepFn
} from "./wait-fixture";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const STORES: ReadonlyArray<readonly [string, () => Promise<StoreAdapter>]> = [
  ["in-memory", async () => inMemoryStores()],
  [
    "sqlite",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fsd-wait-park-"));
      dirs.push(dir);
      return sqliteStores({ filename: join(dir, "store.db") });
    }
  ]
];

/** Deadlines the tests can wait out. */
const SHORT = { minMs: 10 };

/** How soon after the park the ending must be heard: the park's wake, then the released notice's due time, with slack. */
const HEARD_AFTER_PARK_MS = 8_000;

/** The notices `onTaskSettled` heard for `taskId`. */
const heardFor = (notices: TaskSettledInput[], taskId: string) => notices.filter((n) => n.taskId === taskId);

/** Wait out the notice's due time (about two seconds), so a notice owed would have been sent. */
const pastNoticeDue = () => new Promise((r) => setTimeout(r, 2_600));

async function eventually(check: () => boolean, withinMs: number, what: string): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what}: not within ${withinMs} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Until `taskId`'s notice is delivered: the notice turn ran, cleared its marker and ended. */
async function untilDelivered(state: ReturnType<typeof runtimeFor>, flow: Parameters<typeof rows>[1], taskId: string): Promise<void> {
  const owed = (row: { metadata?: Record<string, unknown> } | undefined) =>
    Object.entries(row?.metadata ?? {}).some(([key, value]) => key.startsWith("noticeOwed:") && value !== null);
  for (const deadline = Date.now() + 5_000; owed((await rows(state, flow)).find((row) => row.id === taskId)); ) {
    if (Date.now() > deadline) throw new Error(`${taskId}'s notice was never acknowledged`);
    await new Promise((r) => setTimeout(r, 10));
  }
  await untilTakersEnded(state, (await rows(state, flow)).find((row) => row.id === taskId)!);
}

/** Wait until the model has been called `n` times: the turn is past the steps before them. */
const stepped = (seen: unknown[], n: number) => eventually(() => seen.length >= n, 10_000, `the model called ${n} times`);

describe.each(STORES)("a park ends what a lapsed wait slot holds (%s)", { timeout: 30_000 }, (_name, stores) => {
  it("an ending held for a timed-out wait is heard within seconds of its request parking on a person", async () => {
    // The person may take hours to answer: the request parked on them must
    // not sit on an ending the conversation is owed.
    const notices: TaskSettledInput[] = [];
    const heardAt: number[] = [];
    const seen: Parameters<typeof stepModel>[1] = [];
    let first = "";
    const script: StepFn[] = [
      // T1, with a deadline it lapses at.
      waitCall("c1", "first question", 50),
      (opts) => {
        first = waitedTaskId([opts], 0);
        // T1 ends while the request still runs: held for it.
        return finishTask("x1", () => first, "T1 done")(opts);
      },
      awaitApproval("p1"),
      // After the person approves: wait on T1 again.
      waitAgain("w1", () => first),
      finalAnswer
    ];
    const { model } = stepModel(script, seen);
    const flow = waitFlow(model, { heard: notices, heardGate: async () => void heardAt.push(Date.now()) });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const run = await act(state, flow, "run");
      // Past T1's own wait, parked on the person.
      await stepped(seen, 3);
      await until(state, run.requestId!, "suspended", 10_000);
      const parkedAt = Date.now();
      expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');

      // Parked on the person: the ending goes out, without waiting for them.
      await eventually(() => heardFor(notices, first).length > 0, HEARD_AFTER_PARK_MS, "T1's ending heard at the park");
      expect(heardFor(notices, first)).toEqual([expect.objectContaining({ ending: "completed", output: "T1 done" })]);
      expect(heardAt[0]! - parkedAt).toBeLessThan(HEARD_AFTER_PARK_MS);
      expect((await rows(state, flow)).find((row) => row.id === first)?.wait).toBeUndefined();

      // The notice was heard, so none is coming: the resumed wait answers with the task (FIX-2181).
      await untilDelivered(state, flow, first);
      await approve(state, run.requestId!);
      await until(state, run.requestId!, "completed", 10_000);
      const answer = toolResults(seen[4]!.messages);
      expect(answer).not.toContain("arrivesAsNotice");
      expect(answer).toContain("T1 done");
      await pastNoticeDue();
      expect(heardFor(notices, first)).toHaveLength(1);
      expect(lapsedSlotsHeldInProcess().has(run.requestId!)).toBe(false);
    } finally {
      await state.dispose();
    }
  });

  it("a request that parks on a task it didn't file still lets that task's held ending go at the park", async () => {
    // T1 is filed by an earlier turn. The turn that waits on it files nothing,
    // so only its lapsed wait ties it to the board. T1 ends while that turn
    // runs, and the turn runs on past the pass the ending woke: only the park
    // is left to wake the pass that lets the ending go.
    const notices: TaskSettledInput[] = [];
    const seen: Parameters<typeof stepModel>[1] = [];
    let first = "";
    const script: StepFn[] = [
      // The earlier turn files T1 and ends.
      fileCall("f1", "first question"),
      finalAnswer,
      // The next turn waits on T1 with a deadline it lapses at.
      (opts) => waitAgain("w1", () => first, 50)(opts),
      finishTask("x1", () => first, "T1 done"),
      // The turn runs on past the pass its task's ending woke, then parks.
      async (opts) => {
        await new Promise((r) => setTimeout(r, NOTICE_DUE_MS + 1_500));
        return awaitApproval("p1")(opts);
      },
      finalAnswer
    ];
    const { model } = stepModel(script, seen);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const filing = await act(state, flow, "run");
      await until(state, filing.requestId!, "completed", 10_000);
      first = waitedTaskId(seen, 1);
      const run = await act(state, flow, "run");
      await stepped(seen, 5);
      await until(state, run.requestId!, "suspended", 10_000);
      expect(toolResults(seen[3]!.messages)).toContain('"status":"pending"');

      await eventually(() => heardFor(notices, first).length > 0, HEARD_AFTER_PARK_MS, "T1's ending heard at the park");
      expect(heardFor(notices, first)).toEqual([expect.objectContaining({ ending: "completed", output: "T1 done" })]);

      await approve(state, run.requestId!);
      await until(state, run.requestId!, "completed", 10_000);
      await pastNoticeDue();
      expect(heardFor(notices, first)).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("a request resumed before the pass reached its slot lets the held ending go at its next park", async () => {
    // The person answers at once, so the pass the first park woke finds the
    // request running again and leaves the slot. Back from the park, the turn
    // files nothing and waits on nothing: only its read of the board ties it
    // to the slot it lapsed, and its second park must still let the ending go.
    const notices: TaskSettledInput[] = [];
    const seen: Parameters<typeof stepModel>[1] = [];
    let first = "";
    const script: StepFn[] = [
      fileCall("f1", "first question"),
      finalAnswer,
      (opts) => waitAgain("w1", () => first, 50)(opts),
      awaitApproval("p1"),
      // Resumed: T1 ends while the turn runs, held for it.
      finishTask("x1", () => first, "T1 done"),
      // The turn runs on past the pass the ending woke, then parks again.
      async (opts) => {
        await new Promise((r) => setTimeout(r, NOTICE_DUE_MS + 1_500));
        return awaitApproval("p2")(opts);
      },
      finalAnswer
    ];
    const { model } = stepModel(script, seen);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const filing = await act(state, flow, "run");
      await until(state, filing.requestId!, "completed", 10_000);
      first = waitedTaskId(seen, 1);
      const run = await act(state, flow, "run");
      await stepped(seen, 4);
      await until(state, run.requestId!, "suspended", 10_000);
      await approve(state, run.requestId!);
      await stepped(seen, 6);
      await until(state, run.requestId!, "suspended", 10_000);
      expect((await rows(state, flow)).find((row) => row.id === first)?.wait).toMatchObject({ lapsed: true });
      expect(heardFor(notices, first)).toEqual([]);

      await eventually(() => heardFor(notices, first).length > 0, HEARD_AFTER_PARK_MS, "T1's ending heard at the second park");
      expect(heardFor(notices, first)).toEqual([expect.objectContaining({ ending: "completed", output: "T1 done" })]);

      await approve(state, run.requestId!);
      await until(state, run.requestId!, "completed", 10_000);
      await pastNoticeDue();
      expect(heardFor(notices, first)).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("an ending while the request is parked on another wait is heard during the park, and the resumed wait answers with the task, the notice already heard", async () => {
    const notices: TaskSettledInput[] = [];
    let first = "";
    const seen: Parameters<typeof stepModel>[1] = [];
    const script: StepFn[] = [
      // T1, with a deadline it lapses at.
      waitCall("c1", "first question", 50),
      (opts) => {
        first = waitedTaskId([opts], 0);
        // T2, waited on long: the request parks here.
        return waitCall("c2", "second question", 60_000)(opts);
      },
      // After the resume: wait on T1 again.
      (opts) => waitAgain("c3", () => first)(opts),
      finalAnswer
    ];
    const { model } = stepModel(script, seen);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const run = await act(state, flow, "run");
      // Parked on T2, T1's slot lapsed.
      for (let i = 0; i < 500 && seen.length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
      await until(state, run.requestId!, "suspended", 10_000);
      expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');

      // T1 ends while the request is parked: the filer hears it then, not after the resume.
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T1 done" } });
      await eventually(() => heardFor(notices, first).length > 0, HEARD_AFTER_PARK_MS, "T1's ending heard during the park");
      expect(heardFor(notices, first)).toEqual([expect.objectContaining({ ending: "completed", output: "T1 done" })]);

      // T2 ends; the request resumes and waits on T1 again. The notice was
      // heard, so none is coming: the wait answers with the task (FIX-2181).
      await untilDelivered(state, flow, first);
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T2 done" } });
      await act(state, flow, "touch");
      await until(state, run.requestId!, "completed", 10_000);
      const read = toolResults(seen[3]!.messages);
      expect(read).not.toContain("arrivesAsNotice");
      expect(read).toContain("T1 done");

      // One delivery: the notice.
      await pastNoticeDue();
      expect(heardFor(notices, first)).toHaveLength(1);
      expect((await rows(state, flow)).find((row) => row.id === first)?.wait).toBeUndefined();
      expect(lapsedSlotsHeldInProcess().has(run.requestId!)).toBe(false);
    } finally {
      await state.dispose();
    }
  });

  it("a request that resumes and ends without reading has had the ending heard once, at the park", async () => {
    const notices: TaskSettledInput[] = [];
    let first = "";
    const seen: Parameters<typeof stepModel>[1] = [];
    const script: StepFn[] = [
      waitCall("c1", "first question", 50),
      (opts) => {
        first = waitedTaskId([opts], 0);
        return waitCall("c2", "second question", 60_000)(opts);
      },
      finalAnswer
    ];
    const { model } = stepModel(script, seen);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const run = await act(state, flow, "run");
      for (let i = 0; i < 500 && seen.length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
      await until(state, run.requestId!, "suspended", 10_000);

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T1 done" } });
      await eventually(() => heardFor(notices, first).length > 0, HEARD_AFTER_PARK_MS, "T1's ending heard during the park");
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T2 done" } });
      await act(state, flow, "touch");
      await until(state, run.requestId!, "completed", 10_000);

      // Heard once, at the park: the request's end sends nothing more.
      expect(heardFor(notices, first)).toEqual([expect.objectContaining({ ending: "completed", output: "T1 done" })]);
      await pastNoticeDue();
      expect(heardFor(notices, first)).toHaveLength(1);
      expect(lapsedSlotsHeldInProcess().has(run.requestId!)).toBe(false);
    } finally {
      await state.dispose();
    }
  });
});

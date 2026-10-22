/**
 * A lapsed wait slot outlives a park of the request that lapsed it (FIX-2082).
 *
 * A request's wait on T1 lapses at its deadline, with T1 still running. The
 * request then parks on a second wait. A park is not the request's end: T1's
 * slot stays lapsed for it, so an ending T1 reaches while the request is parked
 * is held for that request. Once it resumes, its read of T1 gets the ending,
 * and the filer's `onTaskSettled` never hears it. If the request ends without
 * that read, the ending goes to `onTaskSettled` once.
 */
import { describe, expect, it } from "vitest";
import { inMemoryStores } from "@flow-state-dev/engine";
import type { TaskSettledInput } from "../../src";
import { lapsedSlotsHeldInProcess } from "../../src/tasks/helpers/wait-on-task";
import {
  act,
  finalAnswer,
  readTask,
  rows,
  runtimeFor,
  stepModel,
  toolResults,
  until,
  waitCall,
  waitedTaskId,
  waitFlow,
  type StepFn
} from "./wait-fixture";

/** Deadlines the tests can wait out. */
const SHORT = { minMs: 10 };

/** The notices `onTaskSettled` heard for `taskId`. */
const heardFor = (notices: TaskSettledInput[], taskId: string) => notices.filter((n) => n.taskId === taskId);

/** Wait out the notice's due time (about two seconds), so a notice owed would have been sent. */
const pastNoticeDue = () => new Promise((r) => setTimeout(r, 2_600));

describe("a lapsed wait slot outlives a park of the request that lapsed it", () => {
  it("an ending while the request is parked on another wait reaches it once, on its read after the resume", async () => {
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
      // After the resume: read T1.
      (opts) => readTask("c3", () => first)(opts),
      finalAnswer
    ];
    const { model } = stepModel(script, seen);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, inMemoryStores(), true, 25, SHORT);
    try {
      const run = await act(state, flow, "run");
      // Parked on T2, T1's slot lapsed.
      for (let i = 0; i < 500 && seen.length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
      await until(state, run.requestId!, "suspended", 10_000);
      expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');
      expect((await rows(state, flow)).find((row) => row.id === first)?.wait).toMatchObject({ lapsed: true });
      // Parked, not ended: this process still holds the slot to release at the request's end.
      expect(lapsedSlotsHeldInProcess().get(run.requestId!)).toEqual(new Set([first]));

      // T1 ends while the request is parked: held for it, not owed to the filer.
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T1 done" } });
      await pastNoticeDue();
      expect(heardFor(notices, first)).toEqual([]);

      // T2 ends; the request resumes and reads T1.
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T2 done" } });
      await act(state, flow, "touch");
      await until(state, run.requestId!, "completed", 10_000);
      const read = toolResults(seen[3]!.messages);
      expect(read).toContain("T1 done");

      // One delivery: the read. The filer never hears T1.
      await pastNoticeDue();
      expect(heardFor(notices, first)).toEqual([]);
      expect((await rows(state, flow)).find((row) => row.id === first)?.wait).toBeUndefined();
      // Nothing is left for this process to release at the request's end.
      expect(lapsedSlotsHeldInProcess().has(run.requestId!)).toBe(false);
    } finally {
      await state.dispose();
    }
  }, 30_000);

  it("a request that resumes and ends without reading leaves the ending to one onTaskSettled", async () => {
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
    const state = runtimeFor(flow, inMemoryStores(), true, 25, SHORT);
    try {
      const run = await act(state, flow, "run");
      for (let i = 0; i < 500 && seen.length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
      await until(state, run.requestId!, "suspended", 10_000);

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T1 done" } });
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "T2 done" } });
      await act(state, flow, "touch");
      await until(state, run.requestId!, "completed", 10_000);

      // The request ended without reading T1: the filer hears it, once.
      for (let i = 0; i < 500 && heardFor(notices, first).length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(heardFor(notices, first)).toEqual([expect.objectContaining({ ending: "completed", output: "T1 done" })]);
      await pastNoticeDue();
      expect(heardFor(notices, first)).toHaveLength(1);
      // Released at the end of the run after the park, which armed its own hook: nothing is left held.
      expect(lapsedSlotsHeldInProcess().has(run.requestId!)).toBe(false);
    } finally {
      await state.dispose();
    }
  }, 30_000);
});

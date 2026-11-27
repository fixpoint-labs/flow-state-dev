/**
 * `readSessionRunRecord`, the run record a session's views read (its changes, its talk).
 *
 * A follow-up takes its root's record over, so once it has, the record names the follow-up. Under a mode's
 * former key, the reader keeps another task's record out, so asking for the root's run must still find the
 * one its follow-up continued: a run of the root's chain. Read with the root's id alone, it finds nothing, and
 * the root's changes read as an empty diff.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "@flow-state-dev/orchestration/tasks";
import { createStateBackedTaskCollection } from "@flow-state-dev/orchestration/internal";
import { RUNS, runTopic } from "../src/run-record";
import { readSessionRunRecord } from "../src/session-door";
import { runBoardSegment, taskIssueSegment } from "../src/workspace";

const BOARD = "eng.coding.work";

function fakeSequencerState(): unknown {
  let state: Record<string, unknown> = { tasks: {} };
  return {
    name: "fake-sequencer",
    instanceId: "fake-sequencer#0",
    input: undefined,
    get state() {
      return state;
    },
    async patchState(updates: Record<string, unknown>) {
      state = { ...state, ...updates };
    },
    async setState(next: Record<string, unknown>) {
      state = { ...next };
    },
    async atomicState(mutator: (s: Record<string, unknown>) => Record<string, unknown>) {
      state = { ...state, ...mutator(state) };
    },
  };
}

function runsCollection() {
  const records = new Map<string, Record<string, unknown>>();
  return {
    records,
    async getOptional(key: string) {
      const stored = records.get(key);
      return stored === undefined ? undefined : { state: stored, path: `${RUNS}/${key}` };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      records.set(key, { ...records.get(key), ...update });
      return { state: records.get(key), path: `${RUNS}/${key}` };
    },
  };
}

describe("a session reading its run after a follow-up took over a record under the mode's former key", () => {
  it("finds the run the root's follow-up continued, when the root's run is asked for", async () => {
    let clock = 0;
    const tasks: TaskCollectionRef = createStateBackedTaskCollection({
      collectionId: BOARD,
      state: fakeSequencerState() as never,
      onChange: () => undefined,
      now: () => ++clock,
    });
    await tasks.createTask({ id: "t-root", goal: "add the feature" });
    await tasks.createTask({ id: "t-root-f1", goal: "now also handle X", followUpOf: "t-root" });
    const runs = runsCollection();
    const formerTopic = runTopic(runBoardSegment(BOARD, undefined), taskIssueSegment("t-root"), "code");
    await runs.upsert(formerTopic, { taskId: "t-root-f1", attempt: 1, filesOnly: true, workspacePath: "/w/run" });
    const ctx = { resources: { [RUNS]: runs } } as unknown as BlockContext;
    const board = {
      tasks,
      runOf: (task: { id: string; followUpOf?: string }) => ({
        issue: taskIssueSegment(task.followUpOf ?? task.id),
        mode: { name: "default", formerName: "code" },
      }),
    };

    expect(await readSessionRunRecord(ctx, board, tasks.get("t-root")!)).toMatchObject({ taskId: "t-root-f1", workspacePath: "/w/run" });
    expect(await readSessionRunRecord(ctx, board, tasks.get("t-root-f1")!)).toMatchObject({ taskId: "t-root-f1" });
  });

  it("still keeps out a record another task's run left under the former key", async () => {
    let clock = 0;
    const tasks: TaskCollectionRef = createStateBackedTaskCollection({
      collectionId: BOARD,
      state: fakeSequencerState() as never,
      onChange: () => undefined,
      now: () => ++clock,
    });
    await tasks.createTask({ id: "t-root", goal: "add the feature" });
    const runs = runsCollection();
    const formerTopic = runTopic(runBoardSegment(BOARD, undefined), taskIssueSegment("t-root"), "code");
    await runs.upsert(formerTopic, { taskId: "t-other", attempt: 1, workspacePath: "/w/other" });
    const ctx = { resources: { [RUNS]: runs } } as unknown as BlockContext;
    const board = { tasks, runOf: () => ({ issue: taskIssueSegment("t-root"), mode: { name: "default", formerName: "code" } }) };

    expect(await readSessionRunRecord(ctx, board, tasks.get("t-root")!)).toBeUndefined();
  });
});

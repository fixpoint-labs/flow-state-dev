/**
 * A mode's run is keyed by its name, and a run stored under the mode's former
 * name is still found there (BP-030).
 *
 * The kit's coding mode was keyed `code` before modes had names; it is now
 * `default`. A run that started before the rename and resumes after it must
 * keep its branch, checkout and coding session, and finish under the key it
 * was stored at. Nothing is copied to the new key. A run that starts after the
 * rename is keyed by the new name.
 */
import { afterAll, describe, expect, it } from "vitest";
import { HARNESS_FEATURE_KEY, runTopic } from "../src";
import { runBoardSegment } from "../src/workspace";
import { CONVERSATIONS, FIXED_BOARD, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

const PARTITION = "conv-a";
const SEGMENT = runBoardSegment(CONVERSATIONS, PARTITION);

/** A run on the old name that is not done after its first attempt, so its task goes back to the board. */
async function runStartedBeforeTheRename() {
  const before = claimHost({ mode: "claim", modeName: "code", isDone: () => false, script: [{ answer: "half done", commits: 1 }] });
  await before.seed({ ledgerId: CONVERSATIONS, partition: PARTITION, id: "t1", goal: "change the README", input: {}, maxAttempts: 3 });
  await before.runAttempt(CONVERSATIONS, "t1", PARTITION);
  expect((await before.row(CONVERSATIONS, "t1", PARTITION)).status).toBe("pending");
  const stored = (await before.record(runTopic(SEGMENT, "t1", "code")))!;
  expect(stored.sessionId).toBe("sess_1");
  return { before, stored };
}

describe("a run stored under its mode's former name", () => {
  it("is found there after the rename, and finishes there: same branch, checkout and session, nothing under the new key", async () => {
    const { before, stored } = await runStartedBeforeTheRename();

    const after = claimHost({ mode: "claim", modeName: "default", formerName: "code", restartOf: { dir: before.dir, stores: before.stores } });
    const resumed = await after.runAttempt(CONVERSATIONS, "t1", PARTITION);
    expect(resumed.result.error, messageOf(resumed.result.error)).toBeUndefined();

    expect(after.seen).toHaveLength(1);
    expect(after.seen[0]!.resume).toBe(stored.sessionId);
    expect(after.seen[0]!.cwd).toBe(before.seen[0]!.cwd);
    const finished = (await after.record(runTopic(SEGMENT, "t1", "code")))!;
    expect(finished.attempt).toBe(2);
    expect(finished.outcome).toBe("succeeded");
    expect(finished.branch).toBe(stored.branch);
    expect(await after.record(runTopic(SEGMENT, "t1", "default"))).toBeNull();
    expect((await after.row(CONVERSATIONS, "t1", PARTITION)).status).toBe("completed");
  }, 60_000);

  it("a run that starts after the rename is keyed by the new name", async () => {
    const lab = claimHost({ mode: "claim", modeName: "default", formerName: "code" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: PARTITION, id: "t2", goal: "change the README", input: {} });
    const { result } = await lab.runAttempt(CONVERSATIONS, "t2", PARTITION);
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect((await lab.record(runTopic(SEGMENT, "t2", "default")))?.outcome).toBe("succeeded");
    expect(await lab.record(runTopic(SEGMENT, "t2", "code"))).toBeNull();
  }, 60_000);

  it("a mode with no former name does not look under the old key: the resumed task starts a new run", async () => {
    const { before, stored } = await runStartedBeforeTheRename();

    const after = claimHost({ mode: "claim", modeName: "default", restartOf: { dir: before.dir, stores: before.stores } });
    const resumed = await after.runAttempt(CONVERSATIONS, "t1", PARTITION);
    expect(resumed.result.error, messageOf(resumed.result.error)).toBeUndefined();

    expect(after.seen[0]!.resume).toBeNull();
    const fresh = (await after.record(runTopic(SEGMENT, "t1", "default")))!;
    expect(fresh.branch).not.toBe(stored.branch);
  }, 60_000);
});

describe("a fixed-board row filed before the rename", () => {
  // A fixed board's row carries its segment in its payload (`{ issue, phase }`),
  // and its id derives from it. A row filed as `code` is the same mode as the
  // manager's `default`, formerly `code`: it runs, under the segment it names.
  it("runs on the renamed mode, and finishes under the segment its payload names", async () => {
    const id = "fix-1--code";
    const before = claimHost({ mode: "fixed", modeName: "code", isDone: () => false, script: [{ answer: "half done", commits: 1 }] });
    await before.seed({ ledgerId: FIXED_BOARD, id, goal: "the feature", input: { issue: "FIX-1", phase: "code" }, maxAttempts: 3 });
    await before.runAttempt(FIXED_BOARD, id);
    const stored = (await before.record(runTopic(FIXED_BOARD, "FIX-1", "code")))!;
    expect(stored.sessionId).toBe("sess_1");

    const after = claimHost({ mode: "fixed", modeName: "default", formerName: "code", restartOf: { dir: before.dir, stores: before.stores } });
    const resumed = await after.runAttempt(FIXED_BOARD, id);
    expect(resumed.result.error, messageOf(resumed.result.error)).toBeUndefined();
    expect(after.seen[0]?.resume).toBe(stored.sessionId);
    const finished = (await after.record(runTopic(FIXED_BOARD, "FIX-1", "code")))!;
    expect(finished.attempt).toBe(2);
    expect(finished.outcome).toBe("succeeded");
    expect(finished.branch).toBe(stored.branch);
    expect(await after.record(runTopic(FIXED_BOARD, "FIX-1", "default"))).toBeNull();
    expect((await after.row(FIXED_BOARD, id)).status).toBe("completed");
  }, 60_000);

  it("on a board read from the claim, a feature marker naming the former name runs, under that segment", async () => {
    const lab = claimHost({ mode: "claim", modeName: "default", formerName: "code" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: PARTITION, id: "t3", goal: "the feature", input: { [HARNESS_FEATURE_KEY]: { issue: "FIX-1", phase: "code" } } });
    const { result } = await lab.runAttempt(CONVERSATIONS, "t3", PARTITION);
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect((await lab.record(runTopic(SEGMENT, "t3", "code")))?.outcome).toBe("succeeded");
    expect(await lab.record(runTopic(SEGMENT, "t3", "default"))).toBeNull();
  }, 60_000);

  it("is still refused on a manager whose mode it is not", async () => {
    const id = "fix-1--review";
    const lab = claimHost({ mode: "fixed", modeName: "default", formerName: "code" });
    await lab.seed({ ledgerId: FIXED_BOARD, id, goal: "the review", input: { issue: "FIX-1", phase: "review" }, maxAttempts: 1 });
    const { result } = await lab.runAttempt(FIXED_BOARD, id);
    const task = await lab.row(FIXED_BOARD, id);
    expect(task.status).toBe("errored");
    expect(`${task.error} ${messageOf(result.error)}`).toContain(`is a "review" task on a manager configured for "default"`);
    expect(lab.seen).toHaveLength(0);
  }, 60_000);
});

describe("the former-name read is the task's own", () => {
  // The former key is read only for the run of THIS task. Another row for the
  // same issue that names the mode's new name has no run there yet; finding
  // the old row's record under the former key must not hand it that row's
  // session, checkout or record.
  it("a second fixed-board row for the same issue, filed under the new name, does not adopt the old row's run", async () => {
    const oldId = "fix-1--code";
    const before = claimHost({ mode: "fixed", modeName: "code", isDone: () => false, script: [{ answer: "half done", commits: 1 }] });
    await before.seed({ ledgerId: FIXED_BOARD, id: oldId, goal: "the feature", input: { issue: "FIX-1", phase: "code" }, maxAttempts: 3 });
    await before.runAttempt(FIXED_BOARD, oldId);
    const stored = (await before.record(runTopic(FIXED_BOARD, "FIX-1", "code")))!;
    expect(stored.taskId).toBe(oldId);

    const after = claimHost({ mode: "fixed", modeName: "default", formerName: "code", restartOf: { dir: before.dir, stores: before.stores } });
    const newId = "fix-1--default";
    await after.seed({ ledgerId: FIXED_BOARD, id: newId, goal: "another feature", input: { issue: "FIX-1", phase: "default" }, maxAttempts: 1 });
    const { result } = await after.runAttempt(FIXED_BOARD, newId);
    expect(result.error, messageOf(result.error)).toBeUndefined();

    expect(after.seen[0]?.resume).toBeNull();
    expect(after.seen[0]?.cwd).not.toBe(before.seen[0]!.cwd);
    const own = (await after.record(runTopic(FIXED_BOARD, "FIX-1", "default")))!;
    expect(own.taskId).toBe(newId);
    expect(own.branch).not.toBe(stored.branch);
    // The old row's record is as it left it: its attempt, its session, its task.
    const untouched = (await after.record(runTopic(FIXED_BOARD, "FIX-1", "code")))!;
    expect({ taskId: untouched.taskId, attempt: untouched.attempt, sessionId: untouched.sessionId }).toEqual({ taskId: oldId, attempt: stored.attempt, sessionId: stored.sessionId });
  }, 60_000);

  it("a payload naming the mode in another case finds the run under the mode's own key", async () => {
    // `DEFAULT` and `default` are one task id, one checkout and one branch (the
    // segment folds), so they are one run record too.
    const id = "fix-1--default";
    const lab = claimHost({ mode: "fixed", modeName: "default", formerName: "code" });
    await lab.seed({ ledgerId: FIXED_BOARD, id, goal: "the feature", input: { issue: "FIX-1", phase: "DEFAULT" }, maxAttempts: 2 });
    await lab.putRecord(runTopic(FIXED_BOARD, "FIX-1", "default"), { taskId: id, sessionId: "sess_kept", outcome: "failed" });
    const { result } = await lab.runAttempt(FIXED_BOARD, id);
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect(lab.seen[0]?.resume).toBe("sess_kept");
    expect(await lab.record(runTopic(FIXED_BOARD, "FIX-1", "DEFAULT"))).toBeNull();
  }, 60_000);

  // BP-030: before the key folded, a payload's own spelling was the key, so a
  // run filed as `CODE` was stored at `…/CODE`. It is still found there, and
  // finishes there, when it is this task's.
  it("a run stored under the payload's own spelling, before the key folded, is found there", async () => {
    const id = "fix-1--code";
    const lab = claimHost({ mode: "fixed", modeName: "default", formerName: "code" });
    await lab.seed({ ledgerId: FIXED_BOARD, id, goal: "the feature", input: { issue: "FIX-1", phase: "CODE" }, maxAttempts: 2 });
    await lab.putRecord(runTopic(FIXED_BOARD, "FIX-1", "CODE"), { taskId: id, sessionId: "sess_spelled", outcome: "failed" });
    const { result } = await lab.runAttempt(FIXED_BOARD, id);
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect(lab.seen[0]?.resume).toBe("sess_spelled");
    expect((await lab.record(runTopic(FIXED_BOARD, "FIX-1", "CODE")))?.outcome).toBe("succeeded");
    expect(await lab.record(runTopic(FIXED_BOARD, "FIX-1", "code"))).toBeNull();
  }, 60_000);

  it("a record under that spelling that names another task is not adopted", async () => {
    const id = "fix-1--code";
    const lab = claimHost({ mode: "fixed", modeName: "default", formerName: "code" });
    await lab.seed({ ledgerId: FIXED_BOARD, id, goal: "the feature", input: { issue: "FIX-1", phase: "CODE" }, maxAttempts: 2 });
    await lab.putRecord(runTopic(FIXED_BOARD, "FIX-1", "CODE"), { taskId: "another-task", sessionId: "sess_other", outcome: "failed" });
    const { result } = await lab.runAttempt(FIXED_BOARD, id);
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect(lab.seen[0]?.resume).toBeNull();
    expect((await lab.record(runTopic(FIXED_BOARD, "FIX-1", "CODE")))?.sessionId).toBe("sess_other");
    expect((await lab.record(runTopic(FIXED_BOARD, "FIX-1", "code")))?.taskId).toBe(id);
  }, 60_000);
});

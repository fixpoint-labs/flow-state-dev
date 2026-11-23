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
import { runTopic } from "../src";
import { runBoardSegment } from "../src/workspace";
import { CONVERSATIONS, claimHost, cleanUpHosts, messageOf } from "./claim-host";

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

/**
 * A refused run on a board read from the claim fails the row for good.
 *
 * A refusal of where to work, or of a row that names only half a feature
 * payload, reads the same on every attempt, so it is never retried. On a
 * fixed board the row is cancelled, as it always was. On a conversation's
 * board a cancelled row reaches nobody: the person who asked hears nothing.
 * So there the row ends `errored`, on its first attempt, with the refusal as
 * its error, which is what the conversation reports.
 */
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { localWorkspaceHost, type RunSourceAnswer } from "@flow-state-dev/workspace";
import { CONVERSATIONS, FIXED_BOARD, PHASE, claimHost, cleanUpHosts } from "./claim-host";

afterAll(cleanUpHosts);

/** A workspace host whose source refuses every run. */
function refusingWorkspace(dir: string) {
  return localWorkspaceHost({
    root: join(dir, "places"),
    remotes: { allow: ["file"] },
    source: (): RunSourceAnswer => ({ kind: "refused", reason: "no-project", message: "the task names no project" }),
    provisionTimeoutMs: 10_000,
  });
}

describe("a refused run on a board read from the claim", () => {
  it("ends a row naming only an issue errored after one attempt, and runs nothing", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "half a feature", input: { issue: "FIX-1" }, maxAttempts: 2 });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(row).toMatchObject({ status: "errored", attempts: 1 });
    expect(row.error).toContain("names only part of a feature payload");
    expect(lab.seen).toHaveLength(0);
  }, 60_000);

  it("ends a row whose source refuses errored after one attempt, naming why", async () => {
    const lab = claimHost({ mode: "claim" });
    const refusing = claimHost({ mode: "claim", manager: { workspace: refusingWorkspace(lab.dir) } });
    await refusing.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {}, maxAttempts: 2 });

    await refusing.runAttempt(CONVERSATIONS, "t1", "conv-a");

    const row = await refusing.row(CONVERSATIONS, "t1", "conv-a");
    expect(row).toMatchObject({ status: "errored", attempts: 1 });
    expect(row.error).toContain("the task names no project");
    expect(refusing.seen).toHaveLength(0);
  }, 60_000);

  it("cancels a task that depends on the refused row, as any failed task's dependent is", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "half a feature", input: { issue: "FIX-1" }, maxAttempts: 2 });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t2", goal: "after it", input: {}, deps: ["t1"] });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(await lab.row(CONVERSATIONS, "t1", "conv-a")).toMatchObject({ status: "errored", attempts: 1 });
    expect((await lab.row(CONVERSATIONS, "t2", "conv-a")).status).toBe("cancelled");
  }, 60_000);
});

describe("a refused run on a fixed board", () => {
  it("is still cancelled, as before", async () => {
    const lab = claimHost({ mode: "claim" });
    const refusing = claimHost({ mode: "fixed", manager: { workspace: refusingWorkspace(lab.dir) } });
    const id = "fix-1--implement";
    await refusing.seed({ ledgerId: FIXED_BOARD, id, goal: "the feature", input: { issue: "FIX-1", phase: PHASE }, maxAttempts: 2 });

    await refusing.runAttempt(FIXED_BOARD, id);

    const row = await refusing.row(FIXED_BOARD, id);
    expect(row.status).toBe("cancelled");
    expect(refusing.seen).toHaveLength(0);
  }, 60_000);

  it("still fails, as an attempt, a row that names no feature at all: a fixed board runs feature rows only", async () => {
    const lab = claimHost({ mode: "fixed" });
    await lab.seed({ ledgerId: FIXED_BOARD, id: "t1", goal: "look at the repo", input: {}, maxAttempts: 2 });

    await lab.runAttempt(FIXED_BOARD, "t1");

    const row = await lab.row(FIXED_BOARD, "t1");
    expect(row.status).toBe("pending");
    expect(row.feedback).toContain("carries no usable issue/phase payload");
    expect(lab.seen).toHaveLength(0);
  }, 60_000);
});

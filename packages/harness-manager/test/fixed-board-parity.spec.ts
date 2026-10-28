/**
 * A manager on one fixed board keeps every run where it already was.
 *
 * Run records, checkouts and branches already on disk are found by the keys
 * the manager derives, so a manager that also reads boards from a claim must
 * derive exactly the same keys, and write exactly the same record, for a fixed
 * board's rows. The snapshot beside this file was written by the manager as it
 * stood before boards could be read from a claim; this compares against it
 * rather than re-deriving, which would only prove the code agrees with itself.
 * It was rewritten once, deliberately, when the organization became part of a
 * run's checkout and branch; a run recorded before that keeps its older place
 * (`org-place.spec.ts`).
 */
import { afterAll, describe, expect, it } from "vitest";
import { relative } from "node:path";
import { harnessTaskId } from "../src/workspace";
import { runTopic } from "../src";
import { FIXED_BOARD, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

const ISSUE = "FIX-1";
const TASK_ID = harnessTaskId(ISSUE, PHASE);

/** The record with what differs per run (clock, temp dir, runtime ids) replaced by its kind. */
function normalized(record: Record<string, unknown>, dir: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        if (key === "updatedAt") return [key, typeof value];
        if (key === "childSessionId" || key === "requestId" || key === "runKey" || key === "incarnationId" || key === "baseCommit") return [key, typeof value];
        if ((key === "workspacePath" || key === "remote") && typeof value === "string") return [key, relative(dir, value)];
        return [key, value];
      }),
  );
}

describe("a fixed board's run, as the manager writes it", () => {
  it("derives the same checkout, branch and run record as before", async () => {
    const lab = claimHost({ mode: "fixed", script: [{ answer: "the answer", commits: 1 }] });
    await lab.seed({ ledgerId: FIXED_BOARD, id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE } });
    const { result } = await lab.runAttempt(FIXED_BOARD, TASK_ID);
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect((await lab.row(FIXED_BOARD, TASK_ID)).status).toBe("completed");

    const record = await lab.record(runTopic(FIXED_BOARD, ISSUE, PHASE));
    expect(record).not.toBeNull();
    await expect(
      JSON.stringify(
        {
          topic: runTopic(FIXED_BOARD, ISSUE, PHASE),
          checkout: relative(lab.dir, lab.seen[0]!.cwd),
          record: normalized(record as Record<string, unknown>, lab.dir),
        },
        null,
        2,
      ) + "\n",
    ).toMatchFileSnapshot("./fixed-board-parity.snapshot.json");
  }, 60_000);
});

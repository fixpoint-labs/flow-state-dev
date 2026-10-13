/**
 * A coding run's checkout and branch belong to one organization.
 *
 * One person working in two organizations, on one host, with no tenant
 * header: the run record is kept per user and organization by the framework,
 * but the filesystem and git keep nothing per anything, so unless the
 * organization is in the place and the branch, the second organization's run
 * opens the first one's tree and pushes to its branch. Drop the organization
 * segment and the first test shares one checkout.
 *
 * And a run already under way before the organization joined the place keeps
 * the place its record names, so the change strands no one's work. Drop that
 * and the second test cuts a fresh tree beside the old one.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runTopic } from "../src";
import { harnessTaskId } from "../src/workspace";
import { FIXED_BOARD, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

const ISSUE = "FIX-1";
const TASK_ID = harnessTaskId(ISSUE, PHASE);
const TOPIC = runTopic(FIXED_BOARD, ISSUE, PHASE);

describe("one person, two organizations, one host", () => {
  it("gives each organization its own checkout, branch and run record", async () => {
    const lab = claimHost({ mode: "fixed", script: [{ commits: 1 }, { commits: 1 }] });

    await lab.seed({ ledgerId: FIXED_BOARD, id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE } });
    const first = await lab.runAttempt(FIXED_BOARD, TASK_ID);
    expect(first.result.error, messageOf(first.result.error)).toBeUndefined();
    const inA = await lab.record(TOPIC);

    lab.inOrg("org_other");
    await lab.seed({ ledgerId: FIXED_BOARD, id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE } });
    const second = await lab.runAttempt(FIXED_BOARD, TASK_ID);
    expect(second.result.error, messageOf(second.result.error)).toBeUndefined();
    const inB = await lab.record(TOPIC);

    const [a, b] = lab.seen;
    expect(b!.cwd, "the second organization's run was handed the first one's checkout").not.toBe(a!.cwd);
    // What sharing would cost: the first run's commit sitting in the second's tree.
    expect(existsSync(join(a!.cwd, "call1-0.txt"))).toBe(true);
    expect(existsSync(join(b!.cwd, "call1-0.txt"))).toBe(false);

    expect(inA?.branch).toBeTruthy();
    expect(inB?.branch, "both organizations' runs push one branch").not.toBe(inA?.branch);
    // Each organization reads its own record, naming its own place.
    expect(inA?.workspacePath).toBe(a!.cwd);
    expect(inB?.workspacePath).toBe(b!.cwd);
  }, 60_000);
});

describe("a run opened before the organization was part of its place", () => {
  it("keeps the checkout and branch its record names", async () => {
    const lab = claimHost({ mode: "fixed", script: [{ commits: 1 }] });
    // Spelled, not derived: what the manager wrote for this run before the
    // change (the same values `fixed-board-parity` pinned then).
    const before = {
      checkout: "checkouts/t0/hdfb6f541ef82e9100159f12a84e635d4dce04b31004d05980fc3cae9f5a19737/feature-board/fix-1--implement",
      branch: "conductor/t0/hdfb6f541ef82e9100159f12a84e635d4dce04b31004d05980fc3cae9f5a19737/feature-board/fix-1--implement",
    };

    await lab.seed({ ledgerId: FIXED_BOARD, id: TASK_ID, goal: "the feature", input: { issue: ISSUE, phase: PHASE } });
    await lab.putRecord(TOPIC, {
      attempt: 0,
      taskId: TASK_ID,
      workspacePath: join(lab.dir, before.checkout),
      branch: before.branch,
      outcome: "failed",
    });
    const { result } = await lab.runAttempt(FIXED_BOARD, TASK_ID);
    expect(result.error, messageOf(result.error)).toBeUndefined();

    expect(relative(lab.dir, lab.seen[0]!.cwd), "the run was moved off the place its record names").toBe(
      before.checkout,
    );
    expect((await lab.record(TOPIC))?.branch).toBe(before.branch);
  }, 60_000);
});

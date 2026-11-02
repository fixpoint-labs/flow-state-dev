/**
 * A board task that names the tracker issue it is for (FIX-2388).
 *
 * On a board read from the claim a task names its issue under
 * `harnessFeature: { issue }`. The run is keyed by the task id as before, so
 * its record and checkout are found where they always were. What the issue
 * adds: the branch leads with it, the phase is handed it as `trackerIssue`,
 * and with `issueSpec` on, the brief opens with the issue's spec from the
 * run's checkout.
 *
 * Red states produced before these were trusted:
 *   - `branchIssue` answering `{}`: the branch test fails (no `fix-77` in it).
 *   - the spec section dropped from `prepare`: the brief test fails.
 *   - `locationFor` without the unlabelled check: the run under way is moved
 *     to a new branch and its checkout refused.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HARNESS_FEATURE_KEY, runTopic } from "../src";
import { runBoardSegment } from "../src/workspace";
import { CONVERSATIONS, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

const ISSUE = "FIX-77";
const SPEC_TEXT = "# FIX-77 spec\n\nThe marker sentence only this spec holds: aubergine-lighthouse.";

/** Commit the issue's spec into the lab's source repository, so a checkout cut from it holds the file. */
function commitSpec(dir: string): void {
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "specs/issues", ISSUE), { recursive: true });
  writeFileSync(join(repo, "specs/issues", ISSUE, "SPEC.md"), `${SPEC_TEXT}\n`);
  execFileSync("git", ["add", "specs"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "spec"], { cwd: repo, stdio: "pipe" });
}

describe("a board task that names its issue", () => {
  it("runs a key naming only the issue as the manager's phase, keyed by its task id", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_issue", goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: ISSUE } } });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_issue", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect((await lab.row(CONVERSATIONS, "task_issue", "conv-a")).status).toBe("completed");
    expect((await lab.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-a"), "task_issue", PHASE)))?.outcome).toBe("succeeded");
  }, 60_000);

  // Linear links a pull request to an issue by the issue's id in its branch.
  it("leads the branch with the issue and keeps the task id, so two tasks on one issue stay apart", async () => {
    const lab = claimHost({ mode: "claim" });
    for (const id of ["task_a", "task_b"]) {
      await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id, goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: ISSUE } } });
      const { result } = await lab.runAttempt(CONVERSATIONS, id, "conv-a");
      expect(result.error, messageOf(result.error)).toBeUndefined();
    }
    const segment = runBoardSegment(CONVERSATIONS, "conv-a");
    const [a, b] = await Promise.all(["task_a", "task_b"].map((id) => lab.record(runTopic(segment, id, PHASE))));
    expect(a!.branch).toMatch(/\/fix-77--task_a--implement$/);
    expect(b!.branch).toMatch(/\/fix-77--task_b--implement$/);
  }, 60_000);

  it("leaves the branch of a task naming no issue as it was", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_plain", goal: "an ask", input: {} });
    await lab.runAttempt(CONVERSATIONS, "task_plain", "conv-a");
    const record = await lab.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-a"), "task_plain", PHASE));
    expect(record!.branch).toMatch(/\/task_plain--implement$/);
  }, 60_000);

  it("opens the brief with the issue's spec from the run's checkout when the host turns it on", async () => {
    const lab = claimHost({ mode: "claim", manager: { issueSpec: true } });
    commitSpec(lab.dir);
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_spec", goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: ISSUE } } });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_spec", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();
    const prompt = lab.seen[0]!.prompt;
    expect(prompt.startsWith(`## This work is for issue ${ISSUE}`)).toBe(true);
    expect(prompt).toContain("aubergine-lighthouse");
    // The phase's own prompt still follows.
    expect(prompt).toContain("implement it");
  }, 60_000);

  it("adds no spec when the host leaves the brief off, or when the task names no issue", async () => {
    const off = claimHost({ mode: "claim" });
    commitSpec(off.dir);
    await off.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_off", goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: ISSUE } } });
    await off.runAttempt(CONVERSATIONS, "task_off", "conv-a");
    expect(off.seen[0]!.prompt).not.toContain("aubergine-lighthouse");

    const on = claimHost({ mode: "claim", manager: { issueSpec: true } });
    commitSpec(on.dir);
    await on.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_none", goal: "an ask", input: {} });
    await on.runAttempt(CONVERSATIONS, "task_none", "conv-a");
    expect(on.seen[0]!.prompt).not.toContain("## This work is for issue");
  }, 60_000);

  it("says in one line that an issue has no spec, and still runs", async () => {
    const lab = claimHost({ mode: "claim", manager: { issueSpec: true } });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_nospec", goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: ISSUE } } });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_nospec", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect(lab.seen[0]!.prompt).toContain(`There is no spec for it at specs/issues/${ISSUE}/SPEC.md`);
  }, 60_000);

  it("refuses an issue no branch could carry, before anything runs", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_bad", goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: "../etc" } }, maxAttempts: 2 });
    await lab.runAttempt(CONVERSATIONS, "task_bad", "conv-a");
    const row = await lab.row(CONVERSATIONS, "task_bad", "conv-a");
    expect(row).toMatchObject({ status: "errored", attempts: 1 });
    expect(lab.seen).toHaveLength(0);
  }, 60_000);
});

describe("a claim-board run opened before its branch led with the issue", () => {
  it("keeps the branch and checkout its record names", async () => {
    // What the manager derived for this task before: the same task id, no issue.
    const earlier = claimHost({ mode: "claim" });
    await earlier.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_old", goal: "implement it", input: {} });
    await earlier.runAttempt(CONVERSATIONS, "task_old", "conv-a");
    const topic = runTopic(runBoardSegment(CONVERSATIONS, "conv-a"), "task_old", PHASE);
    const before = (await earlier.record(topic))!;
    expect(before.branch).not.toContain("fix-77");

    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_old", goal: "implement it", input: { [HARNESS_FEATURE_KEY]: { issue: ISSUE } } });
    const checkout = join(lab.dir, relative(earlier.dir, before.workspacePath!));
    await lab.putRecord(topic, { attempt: 0, taskId: "task_old", workspacePath: checkout, branch: before.branch, outcome: "failed" });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_old", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect(lab.seen[0]!.cwd).toBe(checkout);
    expect((await lab.record(topic))?.branch).toBe(before.branch);
  }, 60_000);
});

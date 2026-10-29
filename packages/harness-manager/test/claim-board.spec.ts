/**
 * A manager that reads its board from the claim: one manager, many
 * conversations' boards, each run kept to the board and partition its claim
 * names.
 *
 * The manager is given a resolver instead of one fixed board. The claim gate
 * verifies a dispatch against the row it names; the entry adapter (played here
 * by the test) hands the gate's ledger id and partition to the manager on its
 * input. The manager trusts neither: every read and write goes through the
 * attempt fence against the row at that ledger and partition.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runTopic } from "../src";
import { runBoardSegment, taskIssueSegment } from "../src/workspace";
import { CONVERSATIONS, FIXED_BOARD, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

describe("a manager reading its board from the claim", () => {
  it("runs each conversation's row on its own board, and settles only that row", async () => {
    const lab = claimHost({ mode: "claim", script: [{ answer: "answer for A" }, { answer: "answer for B" }] });
    for (const partition of ["conv-a", "conv-b"]) {
      await lab.seed({ ledgerId: CONVERSATIONS, partition, id: "t1", goal: `look at the repo for ${partition}`, input: {} });
    }

    const first = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(first.result.error, messageOf(first.result.error)).toBeUndefined();
    expect((await lab.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("completed");
    expect((await lab.row(CONVERSATIONS, "t1", "conv-b")).status).toBe("pending");

    const second = await lab.runAttempt(CONVERSATIONS, "t1", "conv-b");
    expect(second.result.error, messageOf(second.result.error)).toBeUndefined();
    expect((await lab.row(CONVERSATIONS, "t1", "conv-b")).status).toBe("completed");
    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[0]!.prompt).toContain("look at the repo for conv-a");
    expect(lab.seen[1]!.prompt).toContain("look at the repo for conv-b");
  }, 60_000);

  it("keeps two conversations' runs of one task id apart: checkout, branch and run record", async () => {
    const lab = claimHost({ mode: "claim" });
    for (const partition of ["conv-a", "conv-b"]) {
      await lab.seed({ ledgerId: CONVERSATIONS, partition, id: "t1", goal: "the same ask", input: {} });
      const { result } = await lab.runAttempt(CONVERSATIONS, "t1", partition);
      expect(result.error, messageOf(result.error)).toBeUndefined();
    }
    const [a, b] = await Promise.all(
      ["conv-a", "conv-b"].map((partition) => lab.record(runTopic(runBoardSegment(CONVERSATIONS, partition), "t1", PHASE))),
    );
    expect(a?.outcome).toBe("succeeded");
    expect(b?.outcome).toBe("succeeded");
    expect(lab.seen[0]!.cwd).not.toBe(lab.seen[1]!.cwd);
    expect(a!.workspacePath).toBe(lab.seen[0]!.cwd);
    expect(b!.workspacePath).toBe(lab.seen[1]!.cwd);
    expect(a!.branch).not.toBe(b!.branch);
    // Nothing was written under the bare ledger id, the key a fixed board of that name would use.
    expect(await lab.record(runTopic(CONVERSATIONS, "t1", PHASE))).toBeNull();
  }, 60_000);

  // A conversation's board mints its task ids (`createTask` takes none), so a
  // worker filing feature work there can never write the id the payload
  // derives. If this refused, no feature task filed from a conversation could
  // ever run, and the commit rule that comes with naming an issue and a phase
  // would be unreachable off the fixed board.
  it("runs a feature row under the id its board minted, keyed by that task id in the row's phase", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({
      ledgerId: CONVERSATIONS,
      partition: "conv-a",
      id: "task_minted",
      goal: "the feature",
      input: { issue: "FIX-1", phase: PHASE },
    });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_minted", "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect(lab.seen).toHaveLength(1);
    expect((await lab.row(CONVERSATIONS, "task_minted", "conv-a")).status).toBe("completed");
    const segment = runBoardSegment(CONVERSATIONS, "conv-a");
    expect((await lab.record(runTopic(segment, "task_minted", PHASE)))?.outcome).toBe("succeeded");
    // Not under the issue: two tasks naming it would share that key.
    expect(await lab.record(runTopic(segment, "FIX-1", PHASE))).toBeNull();
  }, 60_000);

  // The coordinator mints a routed task's id as `routed:<request>:<round>:<delegate>`.
  // No checkout path, branch or run topic can carry that, so before the issue
  // was derived through `taskIssueSegment` every routed task failed at once.
  it("runs a row whose board-minted id the segment grammar refuses, as a routed task's is", async () => {
    const lab = claimHost({ mode: "claim" });
    const routed = "routed:req_01J9.x%2Fy:0:eng.coder";
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: routed, goal: "answer the routed message", input: {} });
    const { result } = await lab.runAttempt(CONVERSATIONS, routed, "conv-a");
    expect(result.error, messageOf(result.error)).toBeUndefined();
    expect((await lab.row(CONVERSATIONS, routed, "conv-a")).status).toBe("completed");
    const record = await lab.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-a"), taskIssueSegment(routed), PHASE));
    expect(record?.outcome).toBe("succeeded");
    expect(record!.workspacePath).toBe(lab.seen[0]!.cwd);
  }, 60_000);

  // What the derived-id check guards on a fixed board, held here by the task id.
  it("keeps two feature rows naming one issue in one conversation apart: checkout, branch and run record", async () => {
    const lab = claimHost({ mode: "claim" });
    for (const id of ["task_first", "task_second"]) {
      await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id, goal: "the feature", input: { issue: "FIX-1", phase: PHASE } });
      const { result } = await lab.runAttempt(CONVERSATIONS, id, "conv-a");
      expect(result.error, messageOf(result.error)).toBeUndefined();
    }
    const segment = runBoardSegment(CONVERSATIONS, "conv-a");
    const [a, b] = await Promise.all(["task_first", "task_second"].map((id) => lab.record(runTopic(segment, id, PHASE))));
    expect(lab.seen[0]!.cwd).not.toBe(lab.seen[1]!.cwd);
    expect(a!.workspacePath).toBe(lab.seen[0]!.cwd);
    expect(b!.workspacePath).toBe(lab.seen[1]!.cwd);
    expect(a!.branch).not.toBe(b!.branch);
  }, 60_000);

  it("still refuses a feature row in another phase than the manager's", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "task_review", goal: "the review", input: { issue: "FIX-1", phase: "review" } });
    const { result } = await lab.runAttempt(CONVERSATIONS, "task_review", "conv-a");
    expect(lab.seen).toHaveLength(0);
    const row = await lab.row(CONVERSATIONS, "task_review", "conv-a");
    expect(`${row.feedback} ${messageOf(result.error)}`).toContain(`is a "review" row on a manager configured for "${PHASE}"`);
  }, 60_000);
});

describe("a fixed board's feature rows", () => {
  it("still refuses a row whose id is not the one its payload derives, and runs nothing", async () => {
    const lab = claimHost({ mode: "fixed" });
    await lab.seed({ ledgerId: FIXED_BOARD, id: "not-the-canonical-id", goal: "the feature", input: { issue: "FIX-1", phase: PHASE } });
    const { result } = await lab.runAttempt(FIXED_BOARD, "not-the-canonical-id");
    expect(lab.seen).toHaveLength(0);
    const row = await lab.row(FIXED_BOARD, "not-the-canonical-id");
    expect(`${row.feedback} ${messageOf(result.error)}`).toContain("carries the payload for fix-1--implement");
  }, 60_000);
});

describe("no manager carries a message door (FIX-2086)", () => {
  it("is absent on a manager with a fixed board and on one that reads its board from the claim", () => {
    // A person's words reach a run as steers on its task; a coding flow's own
    // door (`harnessSessionDoor`) writes them. No manager parks or re-queues a row for a line.
    expect("messageDoor" in claimHost({ mode: "claim" }).manager).toBe(false); // retired-name-refusal: refusal test
    expect("messageDoor" in claimHost({ mode: "fixed" }).manager).toBe(false); // retired-name-refusal: refusal test
  });
});

describe("the claim on the manager's input is checked, never trusted", () => {
  it("refuses a claim naming another conversation's row, and runs nothing", async () => {
    const lab = claimHost({ mode: "claim" });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "A's ask", input: {} });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-b", id: "t1", goal: "B's ask", input: {} });
    // B's row is claimed too, on the same attempt number, so only the
    // incarnation tells the two apart.
    await lab.act("claim", { ledgerId: CONVERSATIONS, partition: "conv-b", id: "t1" });
    const rowA = await lab.row(CONVERSATIONS, "t1", "conv-a");

    // The gate verified A's dispatch; the input's claim says B.
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a", {
      collectionId: CONVERSATIONS,
      partition: "conv-b",
      incarnationId: rowA.incarnationId!,
    });
    expect(lab.seen).toHaveLength(0);
    const rowB = await lab.row(CONVERSATIONS, "t1", "conv-b");
    expect(rowB.status).toBe("in_progress");
    expect(rowB.metadata ?? {}).toEqual({});
    expect(await lab.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-b"), "t1", PHASE))).toBeNull();
  }, 60_000);

  it("fences a stale attempt: a row cancelled mid-run takes no verdict, and the other conversation's run is untouched", async () => {
    // B's row is cancelled while its harness is still working, in the run's
    // own request, so the request's view of the board has moved too.
    const cancelB = async (ctx: BlockContext) =>
      (await scripted.ledgerAt(ctx, CONVERSATIONS, "conv-b"))!.cancel("t1", "withdrawn mid-run");
    const scripted = claimHost({
      mode: "claim",
      script: [{ answer: "A's answer" }, { answer: "B's answer", during: cancelB }],
    });
    for (const partition of ["conv-a", "conv-b"]) {
      await scripted.seed({ ledgerId: CONVERSATIONS, partition, id: "t1", goal: `ask ${partition}`, input: {} });
    }
    expect((await scripted.runAttempt(CONVERSATIONS, "t1", "conv-a")).result.error).toBeUndefined();
    await scripted.runAttempt(CONVERSATIONS, "t1", "conv-b");
    expect((await scripted.row(CONVERSATIONS, "t1", "conv-b")).status).toBe("cancelled");
    expect((await scripted.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("completed");
    const recordB = await scripted.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-b"), "t1", PHASE));
    expect(recordB?.outcome).toBe("running");
    expect(recordB?.finalMessage).toBeNull();
    const recordA = await scripted.record(runTopic(runBoardSegment(CONVERSATIONS, "conv-a"), "t1", PHASE));
    expect(recordA?.outcome).toBe("succeeded");
  }, 60_000);
});

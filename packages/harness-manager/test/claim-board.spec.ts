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
import { CONVERSATIONS, claimHost, cleanUpHosts, messageOf } from "./claim-host";

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
});

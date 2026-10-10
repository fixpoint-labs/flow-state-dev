/**
 * A question a run asks on a board read from the claim parks the row on that
 * board, the way a conversation's board parks any task, and the person's
 * answer comes back through the row.
 *
 * The fixed board's question inbox is that board's own channel. A
 * conversation already has one: the row parks on the worker's question, the
 * conversation tells the person, and their answer re-queues the row with it.
 * The next attempt is handed that answer where answered inbox questions go,
 * in the same checkout and the same harness session.
 */
import { afterAll, describe, expect, it } from "vitest";
import { CONVERSATIONS, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

describe("a question on a board read from the claim", () => {
  it("parks the row on its question, and the answer reaches the next attempt in the same session", async () => {
    const lab = claimHost({ mode: "claim", script: [{ ask: "which branch should I read?" }, { answer: "read main" }] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });

    const first = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(first.result.error, messageOf(first.result.error)).toBeUndefined();
    const parked = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(parked).toMatchObject({ status: "parked", parkedOnQuestion: true, feedback: "which branch should I read?" });

    await lab.act("answer", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", answer: "main, please" });
    const second = await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    expect(second.result.error, messageOf(second.result.error)).toBeUndefined();

    expect(lab.seen).toHaveLength(2);
    expect(lab.seen[1]!.prompt).toContain("ANSWERED: which branch should I read? => main, please");
    // The answer is not a failure: it never arrives as the last attempt's feedback.
    expect(lab.seen[1]!.prompt).not.toContain("FEEDBACK:");
    expect(lab.seen[1]!.resume).toBe("sess_1");
    expect(lab.seen[1]!.cwd).toBe(lab.seen[0]!.cwd);
    expect((await lab.row(CONVERSATIONS, "t1", "conv-a")).status).toBe("completed");
  }, 60_000);
});

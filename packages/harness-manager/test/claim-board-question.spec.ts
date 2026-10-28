/**
 * A run's question holds its task on that question, and the person's answer
 * carries the work on in the same coding session, on the same try.
 *
 * The run asks by writing its marker. The task then waits on the question
 * with no lease and no settlement: the Inbox lists it as a question. The
 * answer owes the task one more turn on its attempt, and that turn's run
 * resumes the session the first run confirmed, with the question and its
 * answer in its brief. No retry is spent.
 */
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { openRowHolds, ticketForClaim, untakenSteers } from "@flow-state-dev/orchestration/tasks";
import { ALICE, CONVERSATIONS, FIXED_BOARD, PHASE, claimHost, cleanUpHosts, messageOf } from "./claim-host";

afterAll(cleanUpHosts);

describe("a run's question holds its task", () => {
  for (const mode of ["claim", "fixed"] as const) {
    const ledger = mode === "claim" ? CONVERSATIONS : FIXED_BOARD;
    const partition = mode === "claim" ? "conv-a" : undefined;
    const id = mode === "claim" ? "t1" : "fix-1--implement";

    it(`${mode} board: holds the task on the question, and the answer's turn resumes the session on the same attempt`, async () => {
      const lab = claimHost({ mode, script: [{ ask: "which branch should I read?" }, { answer: "read main" }] });
      const input = mode === "claim" ? {} : { issue: "FIX-1", phase: PHASE };
      await lab.seed({ ledgerId: ledger, ...(partition !== undefined ? { partition } : {}), id, goal: "look at the repo", input });

      const first = await lab.runAttempt(ledger, id, partition);
      expect(first.result.error, messageOf(first.result.error)).toBeUndefined();
      const held = await lab.row(ledger, id, partition);
      // Held on the run's question: still this attempt's, with no lease, and not settled.
      expect(held).toMatchObject({ status: "in_progress", attempts: 1 });
      expect(held.leaseUntil ?? undefined).toBeUndefined();
      expect(openRowHolds(held).map((hold) => [hold.ask.kind, hold.ask.prompt])).toEqual([["question", "which branch should I read?"]]);

      await lab.act("answer", { ledgerId: ledger, ...(partition !== undefined ? { partition } : {}), id, answer: "main, please" });
      const second = await lab.runAttempt(ledger, id, partition);
      expect(second.result.error, messageOf(second.result.error)).toBeUndefined();

      expect(lab.seen).toHaveLength(2);
      expect(lab.seen[1]!.prompt).toContain("ANSWERED: which branch should I read? => main, please");
      // The answer is not a failure, and it reaches the run once, as an answer.
      expect(lab.seen[1]!.prompt).not.toContain("FEEDBACK:");
      expect(lab.seen[1]!.prompt.match(/main, please/g)).toHaveLength(1);
      // The same coding session, in the same checkout, on the same try.
      expect(lab.seen[1]!.resume).toBe("sess_1");
      expect(lab.seen[1]!.cwd).toBe(lab.seen[0]!.cwd);
      // A new marker per run: the answer's run is never pointed at the question already asked.
      const marker = (prompt: string) => /ASK: (\S+)/.exec(prompt)?.[1];
      expect(marker(lab.seen[1]!.prompt)).not.toBe(marker(lab.seen[0]!.prompt));
      const done = await lab.row(ledger, id, partition);
      expect(done).toMatchObject({ status: "completed", attempts: 1 });
    }, 60_000);
  }

  it("a second question in the same try holds it again, and each answer's turn resumes the same session", async () => {
    const lab = claimHost({
      mode: "claim",
      script: [{ ask: "which branch should I read?" }, { ask: "and which package?" }, { answer: "read it" }],
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    await lab.act("answer", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", answer: "main" });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const again = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(again).toMatchObject({ status: "in_progress", attempts: 1 });
    expect(openRowHolds(again).map((hold) => hold.ask.prompt)).toEqual(["and which package?"]);

    await lab.act("answer", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", answer: "storefront" });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(lab.seen).toHaveLength(3);
    expect(lab.seen.map((run) => run.resume)).toEqual([null, "sess_1", "sess_1"]);
    // Both answers, oldest first, each with its question.
    expect(lab.seen[2]!.prompt).toContain("ANSWERED: which branch should I read? => main\nANSWERED: and which package? => storefront");
    // Three runs, three markers: no run reads a question an earlier one asked.
    const markers = lab.seen.map((run) => /ASK: (\S+)/.exec(run.prompt)?.[1]);
    expect(new Set(markers).size).toBe(3);
    // No run is handed the same prompt twice.
    expect(new Set(lab.seen.map((run) => run.prompt)).size).toBe(3);
    expect(await lab.row(CONVERSATIONS, "t1", "conv-a")).toMatchObject({ status: "completed", attempts: 1 });
  }, 60_000);

  it("the answer's run in the asking run's own request (an inline drain) has a marker of its own, and completes", async () => {
    // An inline drain takes the owed turn in the request it ran the asking turn in.
    const lab = claimHost({ mode: "claim", script: [{ ask: "which branch should I read?" }, { answer: "read main" }] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });
    const request = "req_one_drain";

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a", undefined, request);
    await lab.act("answer", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", answer: "main, please" });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a", undefined, request);

    expect(lab.seen).toHaveLength(2);
    const marker = (prompt: string) => /ASK: (\S+)/.exec(prompt)?.[1];
    expect(marker(lab.seen[1]!.prompt)).not.toBe(marker(lab.seen[0]!.prompt));
    const done = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(openRowHolds(done)).toEqual([]);
    expect(done).toMatchObject({ status: "completed", attempts: 1 });
  }, 60_000);

  it("cancelled while it waits: no further run starts, and the work its run committed stays on its branch", async () => {
    const lab = claimHost({ mode: "claim", script: [{ ask: "which branch should I read?", commits: 1 }] });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    await lab.act("cancel", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1" });
    const cancelled = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(cancelled.status).toBe("cancelled");
    expect(openRowHolds(cancelled)).toEqual([]);
    await expect(lab.runAttempt(CONVERSATIONS, "t1", "conv-a")).rejects.toThrow(/not claimable/);
    expect(lab.seen).toHaveLength(1);

    const log = execFileSync("git", ["log", "--format=%s", "-1"], { cwd: lab.seen[0]!.cwd, encoding: "utf8" });
    expect(log.trim()).toBe("call1 commit 0");
  }, 60_000);
});

describe("a run presents the claim its turn was given", () => {
  // Two turns can share an attempt, so a run whose turn is over must not act
  // for the turn after it: it writes with the ticket its turn was claimed
  // with, never one minted from the row as it stands later.
  it("takes no message meant for a later turn of its attempt", async () => {
    let prompts = 0;
    const lab: ReturnType<typeof claimHost> = claimHost({
      mode: "claim",
      script: [{ ask: "which branch should I read?" }, { answer: "done" }],
      beforePrompt: async (ctx) => {
        // The answer's run (its attempt's second turn) is building its brief
        // when its turn ends and a third takes the row: asked, answered and
        // claimed again on the same attempt, through the board's own writes.
        if (++prompts !== 2) return;
        const ref = (await lab.ledgerAt(ctx, CONVERSATIONS, "conv-a"))!;
        const row = ref.get("t1")!;
        await ref.ask!("t1", [{ kind: "question", prompt: "a question" }], { claim: ticketForClaim(CONVERSATIONS, row, "conv-a") });
        await ref.answer!("t1", { hold: openRowHolds(ref.get("t1")!)[0]!.id, message: "an answer", from: "user", by: ALICE });
        const next = await ref.claim("next-turn", { leaseDurationMs: 120_000, eligibility: (t) => t.id === "t1" });
        expect(next).toMatchObject({ attempts: 1, turn: 3 });
        await ref.steer!("t1", { message: "for the next turn", from: "user", by: ALICE });
      },
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "look at the repo", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    await lab.act("answer", { ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", answer: "main" });

    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");

    expect(prompts).toBe(2);
    expect(lab.seen.map((run) => run.prompt).join("\n")).not.toContain("for the next turn");
    const row = await lab.row(CONVERSATIONS, "t1", "conv-a");
    expect(untakenSteers(row).map((steer) => steer.message)).toEqual(["for the next turn"]);
  }, 60_000);
});

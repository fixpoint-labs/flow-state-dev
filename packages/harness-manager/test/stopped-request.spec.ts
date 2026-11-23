// FIX-2795.
/**
 * A stopped request settles the task it works when it ends, never at its
 * lease's lapse: a person's stop cancels the task, and a stop from inside the
 * process (a host's shutdown) releases it for another attempt. Real
 * `createFlowState`, a real claim gate and real fenced settlement through the
 * claim host; the stop lands while the harness holds the checkout.
 */
import { afterAll, describe, expect, it } from "vitest";
import { abortRequest } from "@flow-state-dev/engine/host";
import { CONVERSATIONS, claimHost, cleanUpHosts } from "./claim-host";

afterAll(cleanUpHosts);

describe("a task whose request is stopped", () => {
  it("is cancelled at once when a person stops its request", async () => {
    const lab = claimHost({
      mode: "claim",
      // `stopRequest` is the abort route's write: the stop a person presses.
      script: [{ during: async (ctx) => void (await ctx.session.stopRequest(ctx.request.identity.id)) }],
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    // Cancelled, not failed: another attempt would redo the work the person stopped.
    expect(task.status).toBe("cancelled");
    expect(task.attempts).toBe(1);
  }, 60_000);

  it("is released for another attempt at once when the process stops its request", async () => {
    const lab = claimHost({
      mode: "claim",
      script: [{ during: async (ctx) => void abortRequest(ctx.request.identity.id) }],
    });
    await lab.seed({ ledgerId: CONVERSATIONS, partition: "conv-a", id: "t1", goal: "add a changelog line", input: {} });
    await lab.runAttempt(CONVERSATIONS, "t1", "conv-a");
    const task = await lab.row(CONVERSATIONS, "t1", "conv-a");
    // Read as the request ends, two minutes before the claim's lease would lapse: free for the
    // next claim, holding no lease.
    expect(task.status).toBe("pending");
    expect(task.leaseUntil).toBeUndefined();
    expect(task.attempts).toBe(1);
  }, 60_000);
});

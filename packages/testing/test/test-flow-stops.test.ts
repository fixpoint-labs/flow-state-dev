/**
 * A test of a step that waits for a person: `testFlow` runs it durably over
 * in-memory stores, so the run stops with the stop on it, and the test
 * answers it the way a screen does, through the engine's answer route.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { testFlow } from "../src";

/** A refund that asks the user before it pays. */
function refunds(seen: string[] = []) {
  const draft = handler({
    name: "draft",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.object({ amount: z.number() }),
    execute: (input) => {
      seen.push("draft");
      return input;
    }
  });
  const approve = handler({
    name: "approve",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.object({ refunded: z.number() }),
    execute: async (input, ctx) => {
      const answer = await ctx.suspendForUser({ kind: "approval", prompt: `Refund ${input.amount}?` });
      seen.push(`answered:${!answer.cancelled && answer.approved ? "yes" : "no"}`);
      return { refunded: !answer.cancelled && answer.approved ? input.amount : 0 };
    }
  });
  return defineFlow({
    kind: "refunds",
    actions: { refund: { inputSchema: z.object({ amount: z.number() }), block: sequencer({ name: "refund" }).step(draft).step(approve) } }
  })({ id: "refunds" });
}

describe("testFlow and a step that waits for a person", () => {
  it("stops the run with the stop on it", async () => {
    const run = await testFlow({ flow: refunds(), action: "refund", input: { amount: 5 }, userId: "u1" });

    expect(run.error).toBeUndefined();
    expect(run.status).toBe("suspended");
    expect(run.suspension).toMatchObject({ kind: "approval", message: "Refund 5?" });
  });

  it("answers the stop and returns the run that followed", async () => {
    const seen: string[] = [];
    const run = await testFlow({ flow: refunds(seen), action: "refund", input: { amount: 5 }, userId: "u1" });

    const after = await run.answer({ action: "approve" });

    expect(after.status).toBe("completed");
    expect(after.requestId).toBe(run.requestId);
    expect(after.suspension).toBeUndefined();
    expect(seen).toEqual(["draft", "answered:yes"]);
    // The items after the stop: its answer, and none of the ones before it.
    expect(after.items.some((item) => item.type === "suspension_resume")).toBe(true);
    expect(after.items.some((item) => item.type === "suspension")).toBe(false);
  });
});

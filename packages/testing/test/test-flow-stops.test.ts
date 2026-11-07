/**
 * A test of a step that waits for a person: `testFlow` runs it durably over
 * in-memory stores, so the run stops with the stop on it, and the test
 * answers it the way a screen does, through the engine's answer route.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createInProcessFetch,
  disposeFlowApiRouter,
  resolveDurabilityProvider
} from "@flow-state-dev/engine";
import { mockGenerator, StopRefusedError, testFlow } from "../src";

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

  it("a no reaches the block as a no", async () => {
    const seen: string[] = [];
    const run = await testFlow({ flow: refunds(seen), action: "refund", input: { amount: 5 }, userId: "u1" });

    const after = await run.answer({ action: "reject" });

    expect(after.status).toBe("completed");
    expect(seen).toEqual(["draft", "answered:no"]);
  });

  it("refuses a second answer, as the route refuses a screen", async () => {
    const run = await testFlow({ flow: refunds(), action: "refund", input: { amount: 5 }, userId: "u1" });
    await run.answer({ action: "approve" });

    const again = run.answer({ action: "approve" });

    await expect(again).rejects.toBeInstanceOf(StopRefusedError);
    await expect(again).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already been resolved") });
  });

  it("refuses a stop a screen already answered through the engine's own route", async () => {
    // The screen's answer goes through a router of its own on the same
    // stores; run.answer learns of it only from the route's refusal.
    const stores = createInMemoryStores();
    const flow = refunds();
    const run = await testFlow({ flow, action: "refund", input: { amount: 5 }, userId: "u1", stores });
    const registry = createFlowRegistry();
    registry.register(flow);
    const screen = createFlowApiRouter({
      registry,
      stores,
      runtimeConfig: { durabilityProvider: resolveDurabilityProvider({ stores, durable: true }) },
      staleSweepIntervalMs: 0,
      detectInterruptedOnStartup: false
    });
    try {
      const res = await createInProcessFetch(screen)(`/api/flows/refunds/requests/${run.requestId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: run.suspension!.suspensionId, action: "approve" })
      });
      expect(res.status).toBe(202);
      await res.text();
    } finally {
      await disposeFlowApiRouter(screen);
    }

    await expect(run.answer({ action: "approve" })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an action the stop doesn't allow", async () => {
    const run = await testFlow({ flow: refunds(), action: "refund", input: { amount: 5 }, userId: "u1" });

    await expect(run.answer({ action: "submit" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("not permitted")
    });
  });

  it("throws, before any route call, when the run is not waiting on a stop", async () => {
    const run = await testFlow({ flow: refunds(), action: "refund", input: { amount: 5 }, userId: "u1" });
    const after = await run.answer({ action: "approve" });

    await expect(after.answer({ action: "approve" })).rejects.toThrow("not waiting on a stop");
  });

  it("checks an input stop's answer against its schema", async () => {
    const ask = handler({
      name: "ask",
      inputSchema: z.object({}),
      outputSchema: z.object({ name: z.string() }),
      execute: async (_input, ctx) => {
        const answer = await ctx.suspendForUser<{ name: string }>({
          kind: "input",
          prompt: "Your name?",
          resumeSchema: z.object({ name: z.string() })
        });
        return { name: answer.cancelled ? "" : answer.answer.name };
      }
    });
    const flow = defineFlow({ kind: "ask", actions: { ask: { inputSchema: z.object({}), block: ask } } })({ id: "ask" });
    const run = await testFlow({ flow, action: "ask", input: {}, userId: "u1" });
    expect(run.suspension).toMatchObject({ kind: "input" });

    await expect(run.answer({ action: "submit", data: { name: 7 } })).rejects.toMatchObject({ status: 400 });
    const after = await run.answer({ action: "submit", data: { name: "Ada" } });
    expect(after.status).toBe("completed");
  });

  it("runs a generator after the answer on the test's mocks", async () => {
    const approve = handler({
      name: "approve",
      inputSchema: z.object({ topic: z.string() }),
      outputSchema: z.object({ topic: z.string() }),
      execute: async (input, ctx) => {
        await ctx.suspendForUser({ kind: "approval", prompt: `Write about ${input.topic}?` });
        return input;
      }
    });
    const write = generator({
      name: "writer",
      model: "openai/gpt-6-luna",
      prompt: "Write",
      outputSchema: z.object({ text: z.string() })
    });
    const flow = defineFlow({
      kind: "writes",
      actions: { write: { inputSchema: z.object({ topic: z.string() }), block: sequencer({ name: "write" }).step(approve).step(write) } }
    })({ id: "writes" });
    const writer = mockGenerator({ name: "writer", script: [{ structuredOutput: { text: "mocked" } }] });

    const run = await testFlow({
      flow,
      action: "write",
      input: { topic: "tea" },
      userId: "u1",
      generators: { writer },
      unmockedGeneratorPolicy: "error"
    });
    const after = await run.answer({ action: "approve" });

    expect(after.status).toBe("completed");
    expect(writer.calls).toHaveLength(1);
  });

  it("resumes a developer's own ctx.suspend through the resume route", async () => {
    const seen: unknown[] = [];
    const wait = handler({
      name: "wait",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async (_input, ctx) => {
        seen.push(await ctx.suspend!({ reason: "external_event", message: "waiting on a webhook" }));
        return {};
      }
    });
    const flow = defineFlow({ kind: "hooks", actions: { run: { inputSchema: z.object({}), block: wait } } })({ id: "hooks" });
    const run = await testFlow({ flow, action: "run", input: {}, userId: "u1" });
    expect(run.status).toBe("suspended");

    const after = await run.resume({ action: "approve", data: { ok: true } });

    expect(after.status).toBe("completed");
    expect(seen).toHaveLength(1);
  });

  it("with durable: false, a stop fails the run", async () => {
    const run = await testFlow({ flow: refunds(), action: "refund", input: { amount: 5 }, userId: "u1", durable: false });

    expect(run.status).toBe("failed");
    expect(run.error?.message).toContain("durable execution");
  });
});

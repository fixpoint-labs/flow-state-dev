/**
 * Runs inside the consumer project the packed-install check builds, and does
 * what an adopter does to unit-test a step that waits for a person, with the
 * installed `@flow-state-dev/testing` alone: `testFlow` runs it, the run
 * stops, and `run.answer` answers it as a screen would.
 *
 * What it holds, each against the installed tarballs:
 *   - the run comes back `suspended`, with the stop (`kind`, `message`) on it;
 *   - `run.answer({ action: "approve" })` returns the run that followed,
 *     `completed`, and the block saw a yes; `reject` reaches it as a no;
 *   - a second answer is refused with the route's 409, and so is a stop a
 *     screen already answered through the installed engine's own answer
 *     route on the same stores, which only the route can know;
 *   - an `input` stop's answer is checked against its schema (400), then taken;
 *   - a generator after the answer returns the test's mock;
 *   - a developer's own `ctx.suspend` continues with `run.resume`;
 *   - no timer is left running once the calls return.
 *
 * Prints `test-a-stop: ok`, or `test-a-stop: FAIL at <step>: …` and exits 1.
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createInProcessFetch,
  disposeFlowApiRouter,
  resolveDurabilityProvider
} from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { z } from "zod";

const started = Date.now();
const fail = (step, detail) => {
  console.log(`test-a-stop: FAIL at ${step}: ${detail}`);
  process.exit(1);
};
const refusedWith = async (step, promise, status) => {
  try {
    await promise;
  } catch (err) {
    if (err?.status === status) return;
    fail(step, `refused with ${err?.status ?? "no status"}: ${err?.message}`);
  }
  fail(step, `was not refused (expected ${status})`);
};

function refunds(seen) {
  const draft = handler({
    name: "draft",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.object({ amount: z.number() }),
    execute: (input) => input
  });
  const approve = handler({
    name: "approve",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.object({ refunded: z.number() }),
    execute: async (input, ctx) => {
      const answer = await ctx.suspendForUser({ kind: "approval", prompt: `Refund ${input.amount}?` });
      const yes = !answer.cancelled && answer.approved;
      seen.push(yes ? "yes" : "no");
      return { refunded: yes ? input.amount : 0 };
    }
  });
  return defineFlow({
    kind: "refunds",
    actions: {
      refund: { inputSchema: z.object({ amount: z.number() }), block: sequencer({ name: "refund" }).step(draft).step(approve) }
    }
  })({ id: "refunds" });
}

// It stops, and the answer continues it.
{
  const seen = [];
  const run = await testFlow({ flow: refunds(seen), action: "refund", input: { amount: 5 }, userId: "u1" });
  if (run.status !== "suspended") fail("suspended", `status ${run.status}${run.error ? `: ${run.error.message}` : ""}`);
  if (run.suspension?.kind !== "approval" || run.suspension?.message !== "Refund 5?")
    fail("suspension", JSON.stringify(run.suspension));
  if (typeof run.answer !== "function") fail("answer", "the result has no answer()");
  const after = await run.answer({ action: "approve" });
  if (after.status !== "completed") fail("answer", `status ${after.status}`);
  if (seen.join() !== "yes") fail("answer", `the block saw ${seen.join() || "nothing"}`);
  await refusedWith("second answer", run.answer({ action: "approve" }), 409);
}

// A no reaches the block as a no.
{
  const seen = [];
  const run = await testFlow({ flow: refunds(seen), action: "refund", input: { amount: 5 }, userId: "u1" });
  const after = await run.answer({ action: "reject" });
  if (after.status !== "completed" || seen.join() !== "no") fail("reject", `status ${after.status}, saw ${seen.join()}`);
}

// A screen answers first, through the engine's own route; run.answer is then refused.
{
  const stores = createInMemoryStores();
  const flow = refunds([]);
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
      body: JSON.stringify({ suspensionId: run.suspension?.suspensionId, action: "approve" })
    });
    if (res.status !== 202) fail("screen answer", `the route answered ${res.status}: ${await res.text()}`);
    await res.text();
  } finally {
    await disposeFlowApiRouter(screen);
  }
  await refusedWith("answer after a screen's", run.answer({ action: "approve" }), 409);
}

// An input stop's answer is checked against its schema.
{
  const ask = handler({
    name: "ask",
    inputSchema: z.object({}),
    outputSchema: z.object({ name: z.string() }),
    execute: async (_input, ctx) => {
      const answer = await ctx.suspendForUser({ kind: "input", prompt: "Your name?", resumeSchema: z.object({ name: z.string() }) });
      return { name: answer.cancelled ? "" : answer.answer.name };
    }
  });
  const flow = defineFlow({ kind: "ask", actions: { ask: { inputSchema: z.object({}), block: ask } } })({ id: "ask" });
  const run = await testFlow({ flow, action: "ask", input: {}, userId: "u1" });
  if (run.status !== "suspended" || run.suspension?.kind !== "input") fail("input stop", `status ${run.status}`);
  await refusedWith("input schema", run.answer({ action: "submit", data: { name: 7 } }), 400);
  const after = await run.answer({ action: "submit", data: { name: "Ada" } });
  if (after.status !== "completed") fail("input answer", `status ${after.status}`);
}

// A generator after the answer runs on the test's mocks.
{
  const approve = handler({
    name: "approve",
    inputSchema: z.object({ topic: z.string() }),
    outputSchema: z.object({ topic: z.string() }),
    execute: async (input, ctx) => {
      await ctx.suspendForUser({ kind: "approval", prompt: `Write about ${input.topic}?` });
      return input;
    }
  });
  const write = generator({ name: "writer", model: "openai/gpt-6-luna", prompt: "Write", outputSchema: z.object({ text: z.string() }) });
  const flow = defineFlow({
    kind: "writes",
    actions: { write: { inputSchema: z.object({ topic: z.string() }), block: sequencer({ name: "write" }).step(approve).step(write) } }
  })({ id: "writes" });
  const writer = mockGenerator({ name: "writer", script: [{ structuredOutput: { text: "mocked" } }] });
  const run = await testFlow({ flow, action: "write", input: { topic: "tea" }, userId: "u1", generators: { writer }, unmockedGeneratorPolicy: "error" });
  const after = await run.answer({ action: "approve" });
  if (after.status !== "completed" || writer.calls.length !== 1)
    fail("mocks after the answer", `status ${after.status}, mock called ${writer.calls.length} time(s)`);
}

// A developer's own ctx.suspend continues with run.resume.
{
  const wait = handler({
    name: "wait",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async (_input, ctx) => {
      await ctx.suspend({ reason: "external_event", message: "waiting on a webhook" });
      return {};
    }
  });
  const flow = defineFlow({ kind: "hooks", actions: { run: { inputSchema: z.object({}), block: wait } } })({ id: "hooks" });
  const run = await testFlow({ flow, action: "run", input: {}, userId: "u1" });
  if (run.status !== "suspended") fail("ctx.suspend", `status ${run.status}`);
  const after = await run.resume({ action: "approve", data: { ok: true } });
  if (after.status !== "completed") fail("resume", `status ${after.status}`);
}

// Nothing the calls started keeps the process open.
const timers = process.getActiveResourcesInfo().filter((r) => r === "Timeout");
if (timers.length > 0) fail("timers", `${timers.length} timer(s) still running after the calls returned`);
console.log(`test-a-stop: ok (${Date.now() - started} ms)`);

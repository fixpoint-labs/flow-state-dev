/**
 * Goal check — continue-interrupted-run resumes rather than restarts.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract, including
 * why this manufactures the interruption in-process instead of killing a
 * second process (that's the sibling `goals/suspension/resumes-after-a-cold-restart`
 * goal's job — a different guarantee).
 *
 * Builds a durable sequencer inline (no kitchen-sink flow file needed — the
 * `goals` package already depends on `@flow-state-dev/core` and
 * `@flow-state-dev/engine` directly, so this runs from the repo root, no
 * subprocess/driver-file dance required):
 *
 *   earlyStep (counter A)  →  .work(bgWork) (counter B)  →  .waitForWork()  →
 *   gate (ctx.suspend())  →  finish (echoes the held-out note)
 *
 * Sequence:
 *   1. runAction to the first suspension (early handler + background work
 *      both complete; counters at 1).
 *   2. Simulate a crash: flip the stored record's status to "interrupted" —
 *      the same state the stale-request sweeper produces after a real crash
 *      (mirrors packages/engine/test/continuation-item.test.ts's
 *      runToInterrupted).
 *   3. continueRequest() with NO resumeContext — the crash-recovery re-entry.
 *      Assert exactly one `continuation` item (trigger "recovery",
 *      priorItemCount > 0) and that BOTH counters are still 1 (replayed, not
 *      re-executed). The gate re-suspends (nobody has approved yet), so the
 *      record is "suspended", not terminal.
 *   4. continueRequest() again, this time WITH a resumeContext approving the
 *      new suspension (the ordinary post-crash operator approval) — drives
 *      the SAME request id to "completed". Assert the terminal status, the
 *      unchanged id, and that the output carries the held-out note.
 *
 * Run: pnpm tsx goals/continue-interrupted-run/continues-not-restarts/run.mts
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { continueRequest, runAction } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ContinuationItem } from "@flow-state-dev/core/items";
import {
  approvalContext,
  approvePending,
  durableStores,
  loadFixture,
  registryFor,
  runGoal,
  stripIntentOverrides,
} from "../../lib/index.mts";

const fixture = loadFixture<{ note: string }>(import.meta.url, "note.json");

// This flow declares no generator/model intents (see goal.md's Model field),
// so clear any pinned intent-ladder overrides before the engine builds its
// execution context — otherwise createModelResolver throws trying to match a
// pinned intent against the (empty) declared set.
stripIntentOverrides();

function continuationItems(items: readonly { type: string }[] | undefined): ContinuationItem[] {
  return ((items ?? []) as ContinuationItem[]).filter((i) => i.type === "continuation");
}

await runGoal(async () => {
  const failures: string[] = [];
  let earlyRuns = 0;
  let bgRuns = 0;

  const earlyStep = handler({
    name: "earlyStep",
    inputSchema: z.any(),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => {
      earlyRuns += 1;
      return { ok: true };
    },
  });

  const bgWork = handler({
    name: "bgWork",
    inputSchema: z.any(),
    outputSchema: z.object({ done: z.boolean() }),
    execute: async () => {
      bgRuns += 1;
      return { done: true };
    },
  });

  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_i: unknown, ctx: { suspend?: (payload: unknown) => unknown }) =>
      ctx.suspend!({ reason: "human_approval", message: "Approve?" }),
  });

  const finish = handler({
    name: "finish",
    inputSchema: z.any(),
    outputSchema: z.object({ note: z.string().nullable() }),
    execute: async (i: { note?: string }) => ({ note: i?.note ?? null }),
  });

  const flow = defineFlow({
    kind: "goal-continue-interrupted",
    actions: {
      run: {
        block: sequencer({ name: "seq", durable: true })
          .step(earlyStep)
          .work(bgWork)
          .waitForWork()
          .step(gate)
          .step(finish),
        inputSchema: z.any(),
      },
    },
  })({ id: "goal-continue-interrupted" }) as FlowInstance;

  const { stores, provider, runtimeConfig } = durableStores();
  const registry = registryFor(flow);

  // 1. Run to the first suspension.
  const initial = await runAction({
    flow: flow as never,
    actionName: "run",
    input: {},
    userId: "goal-user",
    stores,
    runtimeConfig: runtimeConfig as never,
  });
  const requestId = initial.requestId!;
  if (earlyRuns !== 1) failures.push(`expected earlyStep to run once before suspension, ran ${earlyRuns} times`);
  if (bgRuns !== 1) failures.push(`expected bgWork to run once before suspension, ran ${bgRuns} times`);

  const beforeCrash = await stores.request.get(requestId);
  if (beforeCrash?.status !== "suspended") {
    return {
      failures: [...failures, `expected initial run to suspend, got status "${beforeCrash?.status}"`],
      evidence: "",
    };
  }
  const priorItemCount = (beforeCrash.items ?? []).length;
  if (priorItemCount <= 0) failures.push("expected the pre-crash item log to be non-empty");

  // 2. Simulate a crash: flip the record to "interrupted" (mirrors the
  //    engine's own crash-recovery test harness — see goal.md).
  await stores.request.set(
    requestId,
    { ...beforeCrash, status: "interrupted", interruptedAt: Date.now() },
    "any",
  );

  // 3. Crash-recovery re-entry: continueRequest with NO resumeContext.
  const { finished: recovered } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    runtimeConfig: runtimeConfig as never,
  });
  await recovered;

  const afterRecovery = await stores.request.get(requestId);
  const contItems = continuationItems(afterRecovery?.items);
  if (contItems.length !== 1) {
    return {
      failures: [
        ...failures,
        `expected exactly one continuation item after crash-recovery continue, found ${contItems.length}`,
      ],
      evidence: "",
    };
  }
  if (contItems[0].trigger !== "recovery") {
    failures.push(`expected the continuation item's trigger to be "recovery", got "${contItems[0].trigger}"`);
  }
  if (!(contItems[0].priorItemCount > 0)) {
    failures.push(`expected the continuation item's priorItemCount to be > 0, got ${contItems[0].priorItemCount}`);
  }
  if (earlyRuns !== 1) {
    failures.push(`earlyStep re-ran after crash-recovery continue (ran ${earlyRuns} times) — it was re-executed, not replayed`);
  }
  if (bgRuns !== 1) {
    failures.push(`bgWork re-ran after crash-recovery continue (ran ${bgRuns} times) — the completed background block was re-executed, not replayed`);
  }

  // 4. Resolve the re-suspended gate (ordinary post-crash operator approval)
  //    to drive the SAME request id to completion.
  const suspension = await approvePending(provider, requestId, { note: fixture.note });

  const { finished: resolved } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: approvalContext(suspension, { note: fixture.note }) as never,
    runtimeConfig: runtimeConfig as never,
  });
  const result = await resolved;

  if (result.requestId !== requestId) {
    failures.push(
      `resolving continue produced a DIFFERENT request id (${result.requestId}) — a restart, not a continuation`,
    );
  }
  const finalRecord = await stores.request.get(requestId);
  if (finalRecord?.status !== "completed") {
    failures.push(`expected terminal status "completed", got "${finalRecord?.status}"`);
  }
  if (earlyRuns !== 1) failures.push(`earlyStep re-ran during the resolving continue (ran ${earlyRuns} times)`);
  if (bgRuns !== 1) failures.push(`bgWork re-ran during the resolving continue (ran ${bgRuns} times)`);

  const output = result.output as { note?: string | null } | undefined;
  if (output?.note !== fixture.note) {
    failures.push(
      `resumed output note "${output?.note}" does not match the held-out fixture note "${fixture.note}"`,
    );
  }

  return {
    failures,
    evidence:
      `interrupted request ${requestId} continued (not restarted): exactly one "recovery" ` +
      `continuation item (priorItemCount ${contItems[0].priorItemCount}); earlyStep and bgWork each ` +
      `ran exactly once across both continue calls; the SAME request id reached "completed" carrying ` +
      `the held-out note "${fixture.note}".`,
  };
});

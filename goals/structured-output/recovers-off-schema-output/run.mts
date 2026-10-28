/**
 * Goal check — structured output recovers from off-schema model output (FIX-841).
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Builds `planAndExecute` from `@flow-state-dev/patterns/plan-and-execute` with
 * replanning on, runs it through `runAction` on GLM 5.2, and asserts the run
 * COMPLETED through plan-and-execute with substantive content — proving the
 * replan-loop model's off-schema output was recovered, not fatal. Pre-fix, the
 * run aborts with an `execution_error` (AI_NoObjectGeneratedError).
 *
 * Every generator, the coercion repair call included, resolves to GLM 5.2:
 * the resolver is wrapped with the same `forceModelResolver` that `fsdev
 * --model` uses, so this stays the strictest case (GLM coercing its own
 * output).
 *
 * Run: pnpm tsx goals/structured-output/recovers-off-schema-output/run.mts
 */
import { defineFlow, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { runAction, createInMemoryStores, createModelResolver } from "@flow-state-dev/engine";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { z } from "zod";
import { forceModelResolver } from "../../../packages/cli/src/model-override.ts";
import {
  goalSessionId,
  loadFixture,
  runGoal,
  silentLogger,
  stripIntentOverrides,
} from "../../lib/index.mts";

// A LITERAL, deliberately — not `goalModel()`, and not `DEFAULT_MODEL`.
//
// goal.md pins this model because it is the one that surfaced the bug ("do not
// substitute"). Routing it through `goalModel()` would let an ambient
// `GOAL_MODEL` silently swap in a more schema-compliant model, and the run
// would report PASS without ever exercising the off-schema recovery this goal
// exists to check. A contract-pinned model must never be overridable.
const MODEL = "vercel:zai/glm-5.2";

// Held-out fixture. Nothing below hardcodes the topic or the answer — only that
// the run completed through plan-and-execute with real content.
const fixture = loadFixture<{ message: string; minAnswerChars: number }>(
  import.meta.url,
  "goal.json",
);

// A bare `createModelResolver()` rejects a pinned intent ladder; clear it so
// the resolver auto-wires the gateway from the env. The forced wrapper below
// then sends every generator to MODEL anyway.
stripIntentOverrides();

await runGoal(async (failures) => {
  // The wiring kitchen-sink's removed `plan-and-execute` thinking style used,
  // minus the app's context, history and capabilities: replanning on (the LLM
  // evaluator is the replan-loop model whose off-schema output this goal is
  // about) and web search on the executor.
  const pae = planAndExecute({
    name: "so-pae",
    model: MODEL,
    search: true,
    enableReplanning: true,
  });
  const flow = defineFlow({
    kind: "so-pae",
    actions: { run: { block: pae as never, inputSchema: z.object({ goal: z.string() }) } },
  })({ id: "so-pae" });

  const res = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: { goal: fixture.message },
    userId: "goal-user",
    sessionId: goalSessionId("so-pae"),
    stores: createInMemoryStores(),
    runtimeConfig: {
      modelResolver: forceModelResolver(createModelResolver(), MODEL),
      logger: silentLogger,
    } as never,
  });

  // 1) The run completed — no execution_error. This is the headline: pre-fix it
  //    aborts here.
  if (res.error) {
    failures.push(`run did not complete: ${res.error.message}`);
  }

  // 2) It actually went through plan-and-execute (anti-game: not some other
  //    path). task-change / task-board-meta components are emitted only by the
  //    task-board substrate the pattern runs on.
  const planItems = (res.items as { type?: string; component?: string }[]).filter(
    (i) =>
      i.type === "component" &&
      (i.component === "task-change" || i.component === "task-board-meta"),
  );
  if (planItems.length === 0) {
    failures.push(
      "no plan-and-execute items (task-change / task-board-meta) — the replan loop did not run",
    );
  }

  // 3) The synthesized answer has real content (anti-game: not an empty message).
  const answer = typeof res.output === "string" ? res.output : "";
  if (answer.length < fixture.minAnswerChars) {
    failures.push(
      `answer too short (${answer.length} < ${fixture.minAnswerChars} chars): ${JSON.stringify(answer.slice(0, 200))}`,
    );
  }

  return {
    failures,
    evidence:
      `plan-and-execute completed on ${MODEL}: ${planItems.length} plan items, ` +
      `${answer.length}-char answer. Off-schema replan-loop output was recovered, not fatal.`,
  };
});

/**
 * Plan-and-execute fixture flow.
 *
 * Wraps `@flow-state-dev/patterns/plan-and-execute` in a minimal flow
 * shell so the scenario can drive the pattern through `runAction`. Uses
 * the pattern's default planner / executor / synthesizer — the test
 * mocks them by their derived block names (`pae-test-planner`,
 * `pae-test-executor`, `pae-test-synthesizer`).
 */
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { planAndExecute } from "@flow-state-dev/patterns/plan-and-execute";
import { z } from "zod";

const inputSchema = z.object({ goal: z.string() });

const paeBlock = planAndExecute({
  name: "pae-test",
  enableReplanning: false,
  outputSchema: z.string()
});

const pipeline = sequencer({ name: "pae-pipeline", inputSchema })
  .then(paeBlock);

const planAndExecuteFlow = defineFlow({
  kind: "test-pae",
  requireUser: true,
  actions: {
    run: {
      inputSchema,
      block: pipeline,
      userMessage: (input) => input.goal
    }
  }
});

export default planAndExecuteFlow({ id: "default" });

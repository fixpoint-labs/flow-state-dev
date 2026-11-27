/**
 * Supervisor + task-board fixture flow for the S1 regression scenario.
 *
 * Wraps `@flow-state-dev/patterns/supervisor` in a minimal flow shell so
 * the scenario drives the full pattern (planner → task-board → review →
 * synthesizer) through `runAction`. The pattern is the substrate where
 * the recent infinite-loop regression lived; running the actual factory
 * here reproduces the same composition that ships in apps.
 */
import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import { supervisor } from "@flow-state-dev/patterns/supervisor";
import { z } from "zod";

const inputSchema = z.object({ goal: z.string() });

const worker = generator({
  name: "test-worker",
  model: "intent/synthesize",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.string(),
  itemVisibility: { client: true, history: false },
  prompt: "You are a focused task executor. Complete the assigned task concisely.",
  user: (input) => `Task: ${input.goal}`
});

const supervisorBlock = supervisor({
  name: "test-supervisor",
  worker,
  maxConcurrency: 3,
  outputSchema: z.string()
});

const pipeline = sequencer({ name: "supervisor-pipeline", inputSchema })
  .step(supervisorBlock);

const supervisorFlow = defineFlow({
  kind: "test-supervisor",
  requireUser: true,
  actions: {
    run: {
      inputSchema,
      block: pipeline,
      userMessage: (input) => input.goal
    }
  }
});

export default supervisorFlow();

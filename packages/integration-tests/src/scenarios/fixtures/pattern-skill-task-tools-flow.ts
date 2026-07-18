/**
 * Pattern-skill `taskTools` dispatch regression fixture.
 *
 * Mirrors the shape that breaks in production (`competitor-analysis`
 * pattern skill's `discoverer` worker): a generator whose tool surface
 * comes from `uses: [taskToolsCapability]` rather than from the catalog.
 *
 * The flow keeps everything else minimal — no real task-board, no
 * concurrent workers, no nested capability resolution — so any tool
 * dispatch failure isolates to the capability-tool path itself.
 */
import { defineFlow, generator, sequencer } from "@flow-state-dev/core";
import { taskTools } from "@flow-state-dev/orchestration";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const cappedDiscoverer = generator({
  name: "capped-discoverer",
  model: "intent/chat",
  prompt:
    "You discover competitors and enqueue work via addTask. Call addTask once with a goal, then return a one-line summary.",
  inputSchema,
  user: (input) => input.message,
  outputSchema: z.string(),
  uses: [taskTools],
  itemVisibility: { client: true, history: true },
  maxIterations: 4
});

const pipeline = sequencer({ name: "pattern-skill-task-tools-pipeline", inputSchema })
  .step(cappedDiscoverer);

const flow = defineFlow({
  kind: "test-pattern-skill-task-tools",
  requireUser: true,
  actions: {
    run: {
      inputSchema,
      block: pipeline,
      userMessage: (input) => input.message
    }
  }
});

export default flow({ id: "default" });

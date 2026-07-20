/**
 * Pattern-skill `taskTools` + real `taskBoard` regression fixture.
 *
 * Next bisection step up from `pattern-skill-task-tools-flow.ts`. That
 * fixture proved capability-tool dispatch works in isolation; this one
 * adds the production-shape task-board around it: a discoverer worker
 * with `uses: [taskToolsCapability]` running inside a `taskBoard()` with
 * `concurrency: 4`, request-backed collection, and a seeded `discover`
 * task that mirrors what the skill registry creates.
 *
 * If `addTask` hangs here but not in the simpler fixture, the bug needs
 * task-board contention (4 workers polling `request.atomicState` while
 * the discoverer tries to mutate the same scope) to surface.
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { taskBoard, taskBoardStateSchema } from "@flow-state-dev/orchestration/task-board";
import { taskTools } from "@flow-state-dev/orchestration";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const searchTool = handler({
  name: "search",
  description: "Search the web for information.",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
  execute: async (input) => ({ results: [`Result for: ${input.query}`] })
});

const discoverer = generator({
  name: "tb-discoverer",
  model: "intent/chat",
  prompt:
    "Discover competitors. Call addTask once, then return a one-line summary.",
  inputSchema: z.object({
    taskId: z.string(),
    goal: z.string(),
    attempts: z.number(),
    input: z.unknown().optional(),
    feedback: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    deps: z.record(z.unknown()).optional()
  }),
  user: (input) => `Task: ${input.goal}`,
  outputSchema: z.string(),
  tools: [searchTool],
  uses: [taskTools],
  itemVisibility: { client: true, history: false },
  maxIterations: 12
});

const board = taskBoard({
  name: "skill_test_board",
  collection: {
    backing: "request",
    collectionId: "skill_test_board_collection",
    stateKey: "skill_test_board_collection"
  },
  workers: { discoverer },
  concurrency: 4,
  initialTasks: [
    {
      id: "discover",
      goal: "Discover competitors and enqueue analyzer tasks",
      assignee: "discoverer"
    }
  ]
});

const pipeline = sequencer({
  name: "pattern-skill-task-board-pipeline",
  inputSchema,
  stateSchema: taskBoardStateSchema
}).step(board.drain);

const flow = defineFlow({
  kind: "test-pattern-skill-task-board",
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

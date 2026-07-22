/**
 * `taskTools` capability + real `taskBoard` composition fixture.
 *
 * A discoverer worker with `uses: [taskTools]` runs inside a production-shape
 * `taskBoard()` (concurrency 4, request-backed collection, a seeded `discover`
 * task). It exercises the surviving primitives — the task-board substrate and
 * the agent-callable `taskTools` surface — composing without a hang: the worker
 * calls `addTask` and the board drains its seeded task to completion. This is
 * not a skill-mode test (skill pattern/fork modes were removed in FIX-918); the
 * board is wired directly.
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

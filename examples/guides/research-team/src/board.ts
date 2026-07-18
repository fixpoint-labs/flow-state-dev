import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { analyst, synthesizer } from "./workers";

/**
 * A static research board. Two analysts run in parallel; a synthesizer
 * depends on both and starts only once they finish. The dependency
 * graph is fixed at definition time via `initialTasks` + `deps`.
 *
 * `researchBoard.block` is a normal block — mount it as a step in a flow
 * action, or run it directly (see test/board.test.ts).
 */
export const researchBoard = taskBoard({
  name: "research-board",
  collection: { collectionId: "research" },
  concurrency: 3,
  dispatcher: "topological",
  workers: {
    "market-analyst": analyst("market"),
    "financial-analyst": analyst("financial"),
    synthesizer,
  },
  initialTasks: [
    { id: "market", goal: "market analysis", assignee: "market-analyst", input: { subject: "ACME Corp" } },
    { id: "financial", goal: "financial analysis", assignee: "financial-analyst", input: { subject: "ACME Corp" } },
    {
      id: "synth",
      goal: "combined brief",
      assignee: "synthesizer",
      deps: ["market", "financial"],
      input: { subject: "ACME Corp" },
    },
  ],
});

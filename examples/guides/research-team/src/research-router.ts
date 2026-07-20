import { router } from "@flow-state-dev/core";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { z } from "zod";
import { analyst, synthesizer } from "./workers";

export const researchRequestSchema = z.object({
  subject: z.string(),
  competitors: z.array(z.string()),
});

/**
 * Runtime fan-out with a router.
 *
 * The number of tasks isn't known at definition time — it depends on how
 * many competitors the request names. So instead of a static
 * `initialTasks` list, a router reads the request, computes one analyzer
 * task per competitor plus a synthesizer that depends on all of them,
 * and returns a task board seeded with exactly those tasks. The engine
 * then runs the returned board, which drains them.
 *
 * This answers "when does the board run": the router builds it and hands
 * it back as the block to execute. `routes: []` + `validateRoute: () =>
 * true` lets the router return a board it constructed per call. Seeding
 * through the board's `initialTasks` (rather than a manual `addTask` in
 * the router) keeps it replay-safe — the board's seed step is idempotent
 * by task id, so a re-run doesn't double-seed.
 */
export const researchRouter = router({
  name: "research-router",
  inputSchema: researchRequestSchema,
  outputSchema: z.unknown(),
  routes: [],
  validateRoute: () => true,
  execute: (request) => {
    const analyzerIds = request.competitors.map((_, i) => `analyze-${i}`);
    const initialTasks = [
      ...request.competitors.map((name, i) => ({
        id: analyzerIds[i],
        goal: `analyze ${name}`,
        assignee: "analyzer",
        input: { subject: name },
      })),
      {
        id: "synth",
        goal: `synthesize ${request.subject}`,
        assignee: "synthesizer",
        deps: analyzerIds,
        input: { subject: request.subject },
      },
    ];

    return taskBoard({
      name: "competitor-board",
      collection: { backing: "request", collectionId: "competitors" },
      concurrency: 4,
      dispatcher: "topological",
      workers: { analyzer: analyst("competitor"), synthesizer },
      initialTasks,
    }).drain;
  },
});

/**
 * Input schema for `parallelTasks` / `coordinator`.
 *
 * The factory accepts a plain `{ goal: string }` at the sequencer
 * boundary; the planner sub-block turns it into structured tasks.
 */
import { z } from "zod";

export const parallelTasksInputSchema = z.object({
  goal: z.string().describe("The goal to decompose into parallel sub-tasks")
});

export type ParallelTasksInput = z.infer<typeof parallelTasksInputSchema>;

export type SubTaskErrorStrategy = "skip" | "fail" | "retry";

/**
 * Task schema (FIX-443 §2).
 *
 * The Task schema is the canonical work-unit shape that every dispatcher,
 * worker, and pattern in the substrate operates on. `input` and `output`
 * are validated as `unknown`; the `Task<TInput, TOutput>` runtime type
 * narrows them at the consumer's call site.
 */
import { z } from "zod";
import { taskStatusSchema, type TaskStatus } from "./task-status";

/** The base Task schema. */
export const taskSchema = z.object({
  id: z.string(),
  goal: z.string(),

  status: taskStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  /**
   * Optional retry budget. When set and `attempts < maxAttempts`, a
   * call to `fail()` re-pends the task with the error captured as
   * `feedback` instead of going terminal. Default behavior (unset) is
   * single-attempt — `fail()` transitions straight to `errored`.
   */
  maxAttempts: z.number().int().positive().optional(),

  assignee: z.string().optional(),
  deps: z.array(z.string()).optional(),
  priority: z.number().optional(),
  leaseUntil: z.number().optional(),

  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  feedback: z.string().optional(),

  labels: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),

  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
});

/**
 * Generic Task type. Pattern code typically narrows `TInput` / `TOutput`
 * via `Task<MyInput, MyOutput>` to surface payload types at the worker
 * boundary.
 */
export type Task<TInput = unknown, TOutput = unknown> = Omit<
  z.infer<typeof taskSchema>,
  "input" | "output"
> & {
  input?: TInput;
  output?: TOutput;
};

export type { TaskStatus };

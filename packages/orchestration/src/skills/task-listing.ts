// FIX-2623.
/**
 * What a board's task list answers, in one place: the `listTasks` tool and
 * action build their output from it, and the board's task-list view
 * (`views/task-list-view.ts`) types its keyed entries by it. Schemas only; no
 * block is built here.
 */
import { z } from "zod";
import { taskHoldSchema, taskSchema, taskSpendViewSchema } from "../tasks";

/** A task's waiting state, as `getTask` and `listTasks` both answer it. */
export const waitingShape = {
  keptOpenBy: z.enum(["suspended", "filed", "steer"]).optional(),
  /** What the task waits on now, oldest first; absent when nothing does. Answer a question with `updateTask({ id, answers, message })`. */
  holds: z.array(taskHoldSchema).optional(),
};

// FIX-2623.
/**
 * One task as `listTasks` lists it: its status note, never its output. The
 * board's task-list view answers a list of these, keyed by `id`.
 */
export const listedTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  /** The short label the task was filed under, when it has one. */
  title: z.string().optional(),
  status: z.string(),
  assignee: z.string().optional(),
  attempts: z.number(),
  /** Its worker's last one-line progress note, when it reported one. */
  statusNote: z.string().optional(),
  /** The task whose request filed it, when a task did. */
  filedByTask: z.string().optional(),
  // The run working the task, or the one that last worked it: a
  // reader opens it from here (FIX-1668). Absent until a run starts.
  run: taskSchema.shape.run,
  // FIX-2288.
  /**
   * What the task's runs spent: the harness and model
   * running it and its tokens, `null` when it never ran in a request
   * of its own. On the board's action only: a model's tool reads none.
   */
  spend: taskSpendViewSchema.nullable().optional(),
  /**
   * When the row was last written (epoch ms), so a client holding the
   * row from another source too keeps the newer copy. Board action only.
   */
  updatedAt: z.number().optional(),
  /**
   * When the task was filed, when its run first started, and when it
   * ended (epoch ms), as the row records them, so a reader can show
   * how long a task has run and order tasks by when they ended. On
   * the board's action only, like `spend`; the last two are absent
   * until they happen.
   */
  createdAt: z.number().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  /** A request is waiting on this task's ending (`getTask` with `wait`). */
  waitedOn: z.literal(true).optional(),
  /**
   * A running row's lease deadline (epoch ms), as the board holds it,
   * so a reader tells a run that stopped answering by the board's own
   * rule, `leaseLapsed`. Absent while no claim holds the row. On the
   * board's action only, like `spend`.
   */
  leaseUntil: z.number().optional(),
  ...waitingShape,
  // FIX-2086.
  /** The latest completed follow-up in its chain, by id; read its output with getTask. */
  current: z.object({ id: z.string() }).optional(),
});
/** What `listTasks` answers: the rows, or the board's refusal. */
export const listTasksOutputSchema = z.union([
  z.object({ ok: z.literal(true), tasks: z.array(listedTaskSchema) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

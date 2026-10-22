/**
 * A task's steers (FIX-2086): words sent into an open task, kept on the task.
 *
 * The schema, the cap, and the pure decisions both backings share. A steer
 * changes no status, no claim, and no attempt count.
 */
import { z } from "zod";
import type { Task } from "./schema/task";

/** The most steers one task takes; the next is refused, naming the limit (D1). */
export const MAX_STEERS = 20;

/**
 * One steer on a task. Server-written by the `steer` verb, never by a patch;
 * each field but the take marks is written once.
 */
export const taskSteerSchema = z.object({
  /** Unique on its task. A replay that names the same key adds nothing. */
  id: z.string(),
  /** The words, as sent. */
  message: z.string(),
  /**
   * Who sent it: `"filer"`, the filer's model through its `updateTask` tool;
   * `"user"`, a person, from a screen or a line typed in the task's session.
   */
  from: z.enum(["filer", "user"]),
  /** The user who sent it, when a person did and their id is known. */
  by: z.string().optional(),
  /** When it was kept, in epoch ms. */
  at: z.number(),
  /** The attempt that last took it. **Absent** until one has. */
  takenBy: z.number().int().optional(),
  /**
   * The read that took it in that attempt (`takeSteers`). **Absent** when the
   * claim took it, as part of the brief.
   */
  takenIn: z.string().optional(),
});

/** One steer on a task. */
export type TaskSteer = z.infer<typeof taskSteerSchema>;

/** What a sender hands the `steer` verb. */
export interface SteerInput {
  readonly message: string;
  readonly from: TaskSteer["from"];
  /** The user, when a person sent it. */
  readonly by?: string;
  /**
   * A key naming this steer, so the same steer sent twice (a replay, an
   * upgrade step run again) adds one. A fresh id when absent.
   */
  readonly key?: string;
}

/** The steers on `task` no request of its current attempt has taken. Rule 6 settles only when this is empty. */
export function untakenSteers(task: Pick<Task, "steers" | "attempts">): TaskSteer[] {
  return (task.steers ?? []).filter((steer) => steer.takenBy !== task.attempts);
}

/** The steers `task`'s current attempt took in the read named `takenIn`. */
export function steersTakenIn(task: Pick<Task, "steers" | "attempts">, takenIn: string): TaskSteer[] {
  return (task.steers ?? []).filter((steer) => steer.takenBy === task.attempts && steer.takenIn === takenIn);
}

/**
 * What a `steer` writes on `task`, decided inside the write: the patch, or
 * `"unchanged"` for a key already kept, or `"limit"` past {@link MAX_STEERS}.
 * A task running nothing while it waits on work it filed now waits on the
 * steer instead: a turn is owed for it (D2).
 */
export function steerWrite(
  task: Task,
  input: SteerInput,
  id: string,
  at: number
): { patch: Partial<Task> } | "unchanged" | "limit" {
  const steers = task.steers ?? [];
  if (input.key !== undefined && steers.some((steer) => steer.id === input.key)) return "unchanged";
  if (steers.length >= MAX_STEERS) return "limit";
  const steer: TaskSteer = {
    id: input.key ?? id,
    message: input.message,
    from: input.from,
    ...(input.by !== undefined ? { by: input.by } : {}),
    at,
  };
  return {
    patch: {
      steers: [...steers, steer],
      ...(task.status === "in_progress" && task.waitingOn === "filed" ? { waitingOn: "steer" as const } : {}),
    },
  };
}

/**
 * The steers after `takenBy` attempt took every untaken one in the read named
 * `takenIn`, or `undefined` when none was untaken. One this attempt already
 * took is left, so the same read after a crash still finds it.
 */
export function takeSteersPatch(task: Task, takenIn: string): Partial<Task> | undefined {
  const steers = task.steers ?? [];
  if (!steers.some((steer) => steer.takenBy !== task.attempts)) return undefined;
  return {
    steers: steers.map((steer) => (steer.takenBy === task.attempts ? steer : { ...steer, takenBy: task.attempts, takenIn })),
  };
}

/**
 * The steers as the claim that starts `attempt` leaves them: every one taken
 * by it, for its brief. `undefined` on a row with none.
 */
export function steersForAttempt(steers: Task["steers"], attempt: number): Task["steers"] {
  if (steers === undefined || steers.length === 0) return steers;
  return steers.map(({ takenIn: _read, ...steer }) => ({ ...steer, takenBy: attempt }));
}

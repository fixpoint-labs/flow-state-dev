/**
 * The steer record on a task (FIX-2086): its schema and the most a task
 * takes. A leaf, so the task schema and the hold predicates read it without
 * importing the steer writes (`../steers`), which read the holds.
 */
import { z } from "zod";

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
   * `"user"`, a person, from a screen or a line typed in the task's session;
   * `"board"`, the board itself, closing a question at a deadline a host set
   * with "no answer came" (FIX-2133). Server-written, never input.
   */
  from: z.enum(["filer", "user", "board"]),
  /** The user who sent it, when a person did and their id is known. */
  by: z.string().optional(),
  /** When it was kept, in epoch ms. */
  at: z.number(),
  /**
   * The row hold this steer answers (FIX-2133): its id. A row hold is open
   * while no steer carries its id. **Absent** on a steer that answers nothing.
   */
  answers: z.string().optional(),
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

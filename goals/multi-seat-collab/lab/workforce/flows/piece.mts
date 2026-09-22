/**
 * The row's input contract — what the planner files onto a row and what the
 * worker reads back off it. The one piece both kinds need, so it sits beside
 * them under `flows/` rather than inside either kind's file.
 *
 * Deliberately not under `flows/workers/`: a file there is read as a kind by
 * its basename, and this is not one.
 */

import { z } from "zod";

/** One unit of work, as the planner files it and the row carries it. */
export const pieceInputSchema = z.object({
  /** What only a person can settle before this row can finish. */
  asks: z.string().min(1).optional(),
  /** The work this row implies for another desk, filed by whoever finishes it. */
  then: z.object({ goal: z.string().min(1), desk: z.string().min(1) }).optional(),
  /** On a row filed by a finishing seat: the row it follows. */
  follows: z.string().min(1).optional(),
});

export type PieceInput = z.infer<typeof pieceInputSchema>;

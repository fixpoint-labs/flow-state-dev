/**
 * The row's input contract — what the planner files onto a row and what the
 * worker reads back off it. The one piece both flows need, so it sits beside
 * them under `flows/` rather than inside either flow's file.
 *
 * Deliberately not under `flows/workers/`: a file there is read as a flow by
 * its basename, and this is not one.
 */

import { z } from "zod";

/** One unit of work, as the planner files it and the row carries it. */
export const pieceInputSchema = z.object({
  /** The desk the piece is for, in the vocabulary each worker's own `answersFor:` uses. */
  desk: z.string().min(1).optional(),
  /** What only a user can settle before this row can finish. */
  asks: z.string().min(1).optional(),
  /** On a row that follows another: the row it follows. */
  follows: z.string().min(1).optional(),
});

export type PieceInput = z.infer<typeof pieceInputSchema>;

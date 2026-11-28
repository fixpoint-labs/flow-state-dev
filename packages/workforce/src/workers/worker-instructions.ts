/**
 * A worker's instructions as two parts: its core instructions and the user's
 * additional instructions, which a turn reads after the core ones under their
 * own heading.
 *
 * A standard worker's core instructions are its file's and nobody replaces
 * them: the user's copy of it adds to them. A worker of the user's own keeps
 * its stored instructions as its core, which the user may replace.
 */
import type { WorkerManifest } from "../manifest";
import type { WorkerResourceState } from "./worker-row";

/** The heading the additional instructions sit under, after the core ones. */
export const ADDITIONAL_INSTRUCTIONS_HEADING = "## Additional instructions";

/** A worker's instructions, as a turn and the instructions view read them. */
export type WorkerInstructions = {
  /** Its core instructions, or `null` when it has none. */
  instructions: string | null;
  /** What the user added after them, or `null`. */
  additionalInstructions: string | null;
  /** Whether the core instructions are a standard worker's, which an edit can't replace. */
  fixed: boolean;
};

/** Whitespace is not instructions. */
export const textOrNull = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

// BP-030.
/**
 * The instructions of worker `row` (the user's stored row, or `undefined`
 * when they have none), with `file` when the id is a standard worker's.
 *
 * A copy of a standard worker stored before additional instructions existed
 * may carry instructions the user put in place of the file's. That text is
 * read as additional instructions, so nothing the user wrote is dropped,
 * until an edit saves the additional instructions. A copy whose stored
 * instructions match the file's carries none.
 */
export function instructionsOf(row: WorkerResourceState | undefined, file: WorkerManifest | undefined): WorkerInstructions {
  if (file === undefined) {
    return { instructions: textOrNull(row?.instructions), additionalInstructions: textOrNull(row?.additionalInstructions), fixed: false };
  }
  const core = textOrNull(file.body);
  const stored = textOrNull(row?.additionalInstructions);
  const legacy = textOrNull(row?.instructions);
  const carried = stored === null && legacy !== null && legacy.trim() !== (core ?? "").trim() ? legacy : null;
  return { instructions: core, additionalInstructions: stored ?? carried, fixed: true };
}

/** The instructions a turn reads: the core ones, then the additional ones under their heading. */
export function composedInstructions({ instructions, additionalInstructions }: WorkerInstructions): string | null {
  if (additionalInstructions === null) return instructions;
  const added = `${ADDITIONAL_INSTRUCTIONS_HEADING}\n\n${additionalInstructions}`;
  return instructions === null ? added : `${instructions}\n\n${added}`;
}

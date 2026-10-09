/**
 * Resume refusal for a value the record left out (FIX-1772). A block output or
 * tool result over the server's `maxRecordedValueBytes` is recorded as an
 * `omitted` placeholder: its size and a preview, not the value. A resumed
 * request that would have to hand that value on cannot rebuild it, so it fails
 * here rather than compute from the placeholder.
 */
import type { OmittedValue } from "../items/types";
import { FlowError } from "./flow-error";

/** The error code a resumed request fails with when it meets a placeholder. */
export const RECORDED_VALUE_OMITTED = "RECORDED_VALUE_OMITTED";

/** Structured details carried by {@link RecordedValueOmittedError}. */
export type RecordedValueOmittedDetails = {
  /** The block (or tool) whose recorded value was left out. */
  blockName: string;
  /** Its serialized size in bytes, or `null` when it could not be serialized. */
  bytes: number | null;
};

/**
 * Fatal, non-retryable resume error: the request needs a value its record
 * holds only as a placeholder. Running the block again could repeat its side
 * effects, so the request fails, naming the block. The fix is in the block:
 * return less from it (paths and sizes, ids, a reference), or move bulk data
 * between steps through a sequencer's `.map`.
 */
export class RecordedValueOmittedError extends FlowError {
  declare readonly details: RecordedValueOmittedDetails;

  constructor(blockName: string, omitted: Pick<OmittedValue, "bytes">) {
    const size = omitted.bytes === null ? "a value that could not be serialized" : `${omitted.bytes} bytes`;
    super(
      `Block "${blockName}" cannot resume: its recorded output (${size}) was over the record limit (maxRecordedValueBytes) and was saved as a placeholder, so this request cannot rebuild it. Return less from "${blockName}", or pass bulk data between steps with a sequencer's .map.`,
      {
        code: RECORDED_VALUE_OMITTED,
        retryable: false,
        blockName,
        scope: "block",
        details: { blockName, bytes: omitted.bytes }
      }
    );
    this.name = "RecordedValueOmittedError";
  }
}

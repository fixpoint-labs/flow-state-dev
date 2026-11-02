/**
 * When a request reached its terminal status. A completed run stamps
 * `completedAtMs`, a failed one `failedAtMs`, an aborted one `abortedAt`;
 * every reader that needs "when did it end" goes through here so none of them
 * forgets one of the three.
 */
import type { RequestRecord } from "./types";

/**
 * The time `record` ended, in ms since epoch, or `undefined` while it is still
 * running or held (`in_progress`, `suspended`), whatever an earlier stop of the
 * same request stamped, and on a record that carries no stamp.
 */
export function terminalAtMs(
  record: Pick<RequestRecord, "status" | "completedAtMs" | "failedAtMs" | "abortedAt">
): number | undefined {
  if (record.status === "in_progress" || record.status === "suspended") return undefined;
  return record.completedAtMs ?? record.failedAtMs ?? record.abortedAt;
}

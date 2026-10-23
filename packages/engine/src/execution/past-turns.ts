/**
 * Which of a session's request records count as its past turns: the status
 * set history (`createExecutionContext`) and session retention
 * (`retention.ts`) both read, and the parked rule both apply, so a turn
 * retention keeps is a turn a prompt can show.
 *
 * A past turn is a request that finished (`completed`) or that its host died
 * in (`interrupted`). Two kinds of `interrupted` record are not a turn of their
 * own:
 *
 * - **Parked.** An interrupted record that will run again under the same id
 *   (`drivenAgain` in `durability/stop-suspended.ts`: its last gate is pending,
 *   or resolved and owed a re-drive), like a `suspended` one. History leaves
 *   it out until it finishes; retention never deletes it.
 * - **Retried.** `/retry` runs the turn again under a new id with
 *   `metadata.retryOf` naming the original, which stays `interrupted`. The
 *   retry is the turn, so history leaves the original out while the retry is
 *   in the same read. Retention does not read `retryOf`, so the two can drift:
 *   once retention evicts the retry (or when the retry ended `failed`, a status
 *   no history read holds), nothing names the original, and history shows it
 *   again as a partial turn until it too is evicted.
 */
import { drivenAgain } from "../durability/stop-suspended";
import type { DurabilityProvider } from "../durability/types";
import type { RequestRecord } from "../stores/types";

/** The statuses a past turn reads in: finished, or cut short by its host dying. */
export const PAST_TURN_STATUSES: readonly RequestRecord["status"][] = ["completed", "interrupted"];

/**
 * The ids of the `interrupted` records in `records` that will run again
 * ({@link drivenAgain}). Each record must carry its item log, where its last
 * gate is named. Reads a gate only for an interrupted record. Without a
 * durability provider nothing can suspend, so none are parked.
 */
export async function parkedInterruptedIds(
  provider: Pick<DurabilityProvider, "loadSuspension"> | undefined,
  records: readonly Pick<RequestRecord, "id" | "status" | "items">[]
): Promise<Set<string>> {
  const parked = new Set<string>();
  if (provider === undefined) return parked;
  for (const record of records) {
    if (record.status === "interrupted" && (await drivenAgain(provider, record))) parked.add(record.id);
  }
  return parked;
}

/**
 * The ids of requests a retry re-ran: each `metadata.retryOf` among `records`,
 * plus the running request's own, when it is a retry.
 */
export function retriedIds(records: readonly RequestRecord[], currentMetadata: Record<string, unknown> | undefined): Set<string> {
  const retried = new Set<string>();
  for (const metadata of [...records.map((r) => r.metadata), currentMetadata]) {
    const retryOf = metadata?.retryOf;
    if (typeof retryOf === "string") retried.add(retryOf);
  }
  return retried;
}

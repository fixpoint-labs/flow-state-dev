/**
 * Which of a session's request records count as its past turns: the one
 * definition history (`createExecutionContext`) and session retention
 * (`retention.ts`) share, so what a prompt can show and what retention bounds
 * stay the same set.
 *
 * A past turn is a request that finished (`completed`) or that its host died
 * in (`interrupted`). Two kinds of `interrupted` record are not a turn of their
 * own:
 *
 * - **Parked.** An interrupted record that still holds a pending gate is a run
 *   a resume drives again under the same id, like a `suspended` one
 *   (`PARKED` in `durability/stop-suspended.ts`). History leaves it out until
 *   it finishes; retention never deletes it.
 * - **Retried.** `/retry` runs the turn again under a new id with
 *   `metadata.retryOf` naming the original, which stays `interrupted`. The
 *   retry is the turn, so history leaves the original out.
 */
import type { DurabilityProvider } from "../durability/types";
import type { RequestRecord } from "../stores/types";

/** The statuses a past turn reads in: finished, or cut short by its host dying. */
export const PAST_TURN_STATUSES: readonly RequestRecord["status"][] = ["completed", "interrupted"];

/**
 * The ids of the `interrupted` records in `records` that still hold a pending
 * gate. Reads the gates only when an interrupted record is present, once per
 * session. Without a durability provider nothing can suspend, so none are
 * parked.
 */
export async function parkedInterruptedIds(
  provider: Pick<DurabilityProvider, "listSuspended"> | undefined,
  records: readonly RequestRecord[]
): Promise<Set<string>> {
  const parked = new Set<string>();
  const interrupted = records.filter((r) => r.status === "interrupted");
  if (provider === undefined || interrupted.length === 0) return parked;
  const ids = new Set(interrupted.map((r) => r.id));
  const sessions = new Map<string, { userId: string; sessionId: string | undefined }>();
  for (const r of interrupted) sessions.set(`${r.userId}\u0000${r.sessionId ?? ""}`, { userId: r.userId, sessionId: r.sessionId });
  for (const { userId, sessionId } of sessions.values()) {
    const pending = await provider.listSuspended({ userId, ...(sessionId !== undefined ? { sessionId } : {}), status: "pending" });
    for (const gate of pending) if (ids.has(gate.requestId)) parked.add(gate.requestId);
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

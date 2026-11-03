/**
 * `useSubscription(topics, read, options)` (FIX-2428): run a screen's read
 * again when something under `topics` changes.
 *
 * It subscribes through the provider's client (`client.subscribe`), which
 * owns the one socket and the timer: push on a host that has it, and a read
 * every `pollIntervalMs` wherever push can miss a change. The read goes
 * through the coalesced read, so a burst of notices is one read in flight
 * and at most one waiting.
 *
 * `read` gets the notice that woke it, or `null` for a connect, a reconnect
 * or a timer tick. A waiting read that stands for several different notices
 * gets `null` too, so a read that acts on a notice's kind reads everything
 * then.
 */
import { useEffect, useMemo, useRef } from "react";
import type { WireNotice, WireTopic } from "@flow-state-dev/client";
import { coalescedReads } from "../internal/coalescedReads";
import { useClient } from "../internal/useClient";

/** Options for {@link useSubscription}. */
export type UseSubscriptionOptions = {
  /**
   * Read at this pace wherever push can miss a change: the host has no push,
   * the socket is down, or its bus doesn't cross processes. Omit for no
   * timer: the read then runs on a notice, a connect and a reconnect.
   */
  pollIntervalMs?: number;
  /** `false` subscribes nothing. Default `true`. */
  enabled?: boolean;
};

/** One key per distinct topic list, so an equal list keeps the subscription. */
function topicsKey(topics: readonly WireTopic[]): string {
  return JSON.stringify(
    topics.map((t) => [t.scope, t.scope === "session" ? t.id : "", t.resource ?? ""])
  );
}

function sameNotice(a: WireNotice | null, b: WireNotice | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && topicsKey([a.topic]) === topicsKey([b.topic]);
}

/**
 * Run `read` when something under `topics` changes. `read` may return a
 * promise; the next read waits for it.
 */
export function useSubscription(
  topics: readonly WireTopic[],
  read: (notice: WireNotice | null) => unknown,
  options: UseSubscriptionOptions = {}
): void {
  const client = useClient();
  const readRef = useRef(read);
  readRef.current = read;
  const key = topicsKey(topics);
  // The latest list for this key: a new array of the same topics keeps it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => topics, [key]);
  const { pollIntervalMs, enabled = true } = options;

  useEffect(() => {
    if (!enabled || stable.length === 0) return;
    let next: { notice: WireNotice | null } | undefined;
    const reads = coalescedReads(async () => {
      const notice = next?.notice ?? null;
      next = undefined;
      await readRef.current(notice);
    });
    const subscription = client.subscribe(stable, {
      onChange: (notice) => {
        next = next === undefined || sameNotice(next.notice, notice) ? { notice } : { notice: null };
        reads.request();
      },
      ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {})
    });
    return () => {
      subscription.close();
      reads.close();
    };
  }, [client, stable, pollIntervalMs, enabled]);
}

/**
 * The one read both panels make (FIX-1477 S5, S6).
 *
 * `Roster` and `BoardColumns` differ in what they draw and agree on how they
 * fetch: one page of a collection's per-item state, for one session, fenced on
 * its identity. Internal on purpose — exporting it would let a host mount the
 * same read twice and pay for it twice, which is the shape the navigator's own
 * reads module exists to prevent.
 *
 * The fence answers two hazards a collection read has, and an "is this still
 * the ref I want?" comparison answers only the first: a response can outlive
 * the ref it was started for (the host swaps its transport, or the panel is
 * re-pointed at another board), and two reads of the SAME ref can race — a
 * mount read against a host's refresh, where both name one ref and agree with
 * any identity check. Only the sequence number `begin()` hands out separates
 * those.
 */
import { useCallback, useEffect, useState } from "react";
import type { ResourceClient } from "@flow-state-dev/client";
import { useReadFence } from "../../hooks/useReadFence";

/**
 * The panels read one method and no more, and the type says which.
 *
 * A host passes the resource client it already holds — with its own `fetcher`,
 * so every request carries whatever credential that transport adds. A panel
 * that built its own client would read through no credential and fail against
 * any deployment that authenticates (BR-29).
 */
export type PanelRowSource = Pick<ResourceClient, "listCollectionItems">;

/** One row as a panel receives it: its topic, and the collection's projection of its state. */
export type PanelRow<TClient = unknown> = {
  readonly topic: string;
  readonly clientData: TClient;
};

export type PanelRows<TClient = unknown> = {
  readonly rows: readonly PanelRow<TClient>[];
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Re-read the collection. Safe to call from a host affordance. */
  readonly refresh: () => void;
};

/** Stable empty list, so a stale hold hands back the same reference each render. */
const EMPTY: PanelRow<never>[] = [];

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/**
 * One page of a collection's rows, for one session.
 *
 * Deliberately one page and no `loadMore`: both panels draw a standing list
 * that a person scans, not a feed they page through, and a cursor the host
 * cannot see is worse than a limit it can. A collection larger than `limit`
 * renders its first page; raising the limit is the host's call.
 */
export function usePanelRows<TClient = unknown>(
  source: PanelRowSource,
  sessionId: string,
  ref: string,
  limit: number | undefined,
  failureMessage: string
): PanelRows<TClient> {
  const [rows, setRows] = useState<readonly PanelRow<TClient>[]>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);

  const fence = useReadFence([source, sessionId, ref, limit], () => {
    setRows(EMPTY);
    setError(null);
    setIsLoading(true);
    setHeldIdentity(null);
  });
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const read = useCallback(async () => {
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    setIsLoading(true);
    setError(null);
    setHeldIdentity(fence.identity);
    try {
      const page = await source.listCollectionItems(
        sessionId,
        ref,
        limit === undefined ? {} : { limit }
      );
      if (!stillCurrent()) return;
      setRows(
        page.items.map((item) => ({
          topic: item.topic,
          clientData: item.clientData as TClient
        }))
      );
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, failureMessage));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, source, sessionId, ref, limit, failureMessage]);

  useEffect(() => {
    void read();
  }, [read]);

  return {
    rows: holdsCurrent ? rows : EMPTY,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}

"use client";

import { useEffect, useMemo } from "react";
import { type SessionView, useResourceCollectionList } from "@flow-state-dev/react";
import type { ThesisRecord } from "@/src/flows/portfolio/thesis-schema";

/**
 * Read the household's per-position theses (FIX-760) from the user-scoped
 * `theses` resource collection. A thesis is an FSD resource (not a relational
 * table), so this is just `useResourceCollectionList` — the collection is
 * `client: { live: true }`, so a `saveThesis`/`deleteThesis`/`adoptThesis`
 * mutation streams back as a `resource_change` and the list updates with NO
 * manual refetch (the API-route + `useApiQuery` + stream-settle backstop the
 * table version needed are gone).
 *
 * The full household list is returned; consumers filter client-side by ticker
 * (the holding-row "has a thesis?" check, the report standing-thesis card). A
 * thesis is keyed `theses/{ticker}` (upper-case), so a per-ticker lookup is a
 * cheap array find on the caller side.
 *
 * `loading` is true until the FULL household list is in (initial read + every
 * remaining page) — distinct from a loaded-but-empty household — so a consumer
 * (the report's adopt button) suppresses an overwrite-adopt until it actually
 * knows whether a thesis exists. `refetch` is retained for callers that want an
 * explicit re-pull, though the live stream makes it unnecessary in practice.
 */
export function useTheses(session: SessionView): {
  theses: ThesisRecord[];
  loading: boolean;
  refetch: () => void;
} {
  const { items, isLoading, refetch, loadMore, pagination } =
    useResourceCollectionList<ThesisRecord>(session, "theses", { limit: 200 });

  // Page through the whole household. A truncated first page would make a
  // consumer treat a ticker beyond it as "no thesis" — hiding the holding
  // indicator and letting the report panel offer Adopt, which would overwrite the
  // existing record. A household holds dozens of positions, so this is normally a
  // single page; the loop only matters at the tail.
  useEffect(() => {
    if (pagination?.hasMore) loadMore();
  }, [pagination, loadMore]);

  const theses = useMemo(
    () =>
      items
        .map((item) => item.clientData)
        .filter((data): data is ThesisRecord => data != null),
    [items],
  );
  // Not "done loading" until the initial read lands AND no more pages remain, so
  // a per-ticker "has a thesis?" check is never made against a partial list.
  return { theses, loading: isLoading || pagination?.hasMore === true, refetch };
}

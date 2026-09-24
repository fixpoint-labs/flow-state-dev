/**
 * The navigator's two reads (FIX-1477 S2, S3).
 *
 * Internal on purpose. Three public hooks would let three consumers each
 * trigger their own flow-list read, which is the one-read-per-host rule lost
 * by export rather than by bug — so the navigator mounts them once and nothing
 * else can.
 *
 * Both are fenced on their identity, which includes the client they read
 * through: a host that rebuilds its transport on a token or `baseUrl` change
 * must not have the previous backend's rows land afterwards.
 */
import { useCallback, useEffect, useState } from "react";
import {
  sessionQueryFor,
  type Client,
  type FlowListEntry,
  type SessionClient,
  type SessionSummary
} from "@flow-state-dev/client";
import { useReadFence } from "../../hooks/useReadFence";
import type { FlowNavigatorLeaf } from "./grouping";

/**
 * The navigator reads two methods and no more, and the types say which. A host
 * passes the clients it already holds — with its own `fetcher`, so every
 * request carries whatever credential that transport adds.
 */
export type FlowNavigatorFlowSource = Pick<Client, "listFlows">;
export type FlowNavigatorSessionSource = Pick<SessionClient, "listSessions">;

/** Stable empty lists, so a stale hold hands back the same reference each render. */
const EMPTY_FLOWS: FlowListEntry[] = [];
const EMPTY_SESSIONS: SessionSummary[] = [];

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;
}

export type FlowInventory = {
  readonly flows: readonly FlowListEntry[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
};

/**
 * The flow list, read once for the host however many sections render it.
 *
 * Read here rather than per section, and per kind row not at all: the flow
 * list is what tells a row how deep it goes, so a row that read it for itself
 * would turn one request into one per row.
 */
export function useFlowInventory(source: FlowNavigatorFlowSource): FlowInventory {
  const [flows, setFlows] = useState<readonly FlowListEntry[]>(EMPTY_FLOWS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);

  const fence = useReadFence([source], () => {
    setFlows(EMPTY_FLOWS);
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
      const next = await source.listFlows();
      if (!stillCurrent()) return;
      setFlows(next);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, "Failed to load flows"));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, source]);

  useEffect(() => {
    void read();
  }, [read]);

  return {
    flows: holdsCurrent ? flows : EMPTY_FLOWS,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}

export type LeafSessions = {
  readonly sessions: readonly SessionSummary[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
};

/**
 * The session list for ONE leaf.
 *
 * Reads only while its leaf is open, which is what keeps a kind row holding
 * forty instances from costing forty requests: the fetch lives at the level
 * that is a leaf, a collection's kind row is not one, and a closed leaf asks
 * for nothing. Closing is part of the read's identity, so it retires a read
 * still in flight exactly as unmounting would.
 *
 * The fence answers the two hazards a leaf read has, and an "is this still the
 * open leaf?" comparison answers only the first of them. A response can outlive
 * the leaf it was started for — the host swaps its session client, or this hook
 * is re-pointed at another address — and two reads of the SAME leaf can race,
 * a mount read against a host's refresh, where both name one leaf and agree
 * with any identity check. Only the sequence number `begin()` hands out
 * separates those.
 */
export function useLeafSessions(
  source: FlowNavigatorSessionSource,
  leaf: FlowNavigatorLeaf,
  userId: string | undefined,
  /**
   * Ask the listing for the sessions a dispatcher ran work in as well
   * (FIX-1440). Part of the read's identity: turning it on is a different
   * question, so the answer to the previous one is retired rather than merged.
   */
  includeDispatchRuns: boolean,
  /** Whether the leaf is open. A closed leaf reads nothing and holds nothing. */
  isOpen: boolean
): LeafSessions {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>(EMPTY_SESSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heldIdentity, setHeldIdentity] = useState<readonly unknown[] | null>(null);

  const { address, cardinality } = leaf;

  const fence = useReadFence(
    [source, address, cardinality, userId, includeDispatchRuns, isOpen],
    () => {
      setSessions(EMPTY_SESSIONS);
      setError(null);
      setIsLoading(true);
      setHeldIdentity(null);
    }
  );
  const holdsCurrent = heldIdentity !== null && fence.holds(heldIdentity);

  const read = useCallback(async () => {
    if (!isOpen) return;
    const stillCurrent = fence.begin();
    if (stillCurrent === null) return;
    setIsLoading(true);
    setError(null);
    setHeldIdentity(fence.identity);
    try {
      const next = await source.listSessions({
        // The branch itself is `client`'s, written once there. This passes the
        // one entry it already knows about, which is all the helper reads.
        ...sessionQueryFor(address, [{ id: address, cardinality }]),
        ...(userId === undefined ? {} : { userId }),
        // Omitted unless asked for, so the request this hook has always sent
        // is the request it still sends by default.
        ...(includeDispatchRuns ? { include: "dispatch-runs" as const } : {})
      });
      if (!stillCurrent()) return;
      setSessions(next);
    } catch (err) {
      if (!stillCurrent()) return;
      setError(describe(err, "Failed to load sessions"));
    } finally {
      if (stillCurrent()) setIsLoading(false);
    }
  }, [fence, isOpen, source, address, cardinality, userId, includeDispatchRuns]);

  useEffect(() => {
    void read();
  }, [read]);

  return {
    sessions: holdsCurrent ? sessions : EMPTY_SESSIONS,
    isLoading: holdsCurrent ? isLoading : true,
    error: holdsCurrent ? error : null,
    refresh: () => void read()
  };
}

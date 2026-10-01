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
 * must not have the previous backend's rows land afterwards. The fenced read
 * itself is the package's internal `useFencedRead`
 * (`internal/useFencedRead.ts`), shared with the workforce panels, so a fix to
 * how these reads guard against late or racing responses is made there.
 */
import { useState } from "react";
import {
  sessionQueryFor,
  type Client,
  type FlowListEntry,
  type SessionClient,
  type SessionSummary
} from "@flow-state-dev/client";
import { useFencedRead } from "../../internal/useFencedRead";
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
  const { data, isLoading, error, refresh } = useFencedRead<readonly FlowListEntry[]>(
    [source],
    EMPTY_FLOWS,
    "Failed to load flows",
    () => source.listFlows()
  );
  return { flows: data, isLoading, error, refresh };
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
 * for nothing. Each opening is a visit of its own, carried in the read's
 * identity, so closing retires a read still in flight and a `refresh` captured
 * on an earlier visit reads nothing once the leaf has closed and reopened —
 * what unmounting the list used to guarantee.
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
  const { address, cardinality } = leaf;

  // One token per opening, `null` while closed. `isOpen` alone repeats — every
  // visit is `true` — so a closure from a finished visit would agree with the
  // next one; the fence compares whatever it is handed, and a fresh object
  // never matches an old one. Adjusted during render rather than in an effect,
  // so the read that opens the leaf is already fenced on its own visit.
  const [visit, setVisit] = useState<{ open: boolean; token: object | null }>(() => ({
    open: isOpen,
    token: isOpen ? {} : null
  }));
  if (visit.open !== isOpen) setVisit({ open: isOpen, token: isOpen ? {} : null });

  const { data, isLoading, error, refresh } = useFencedRead<readonly SessionSummary[]>(
    [source, address, cardinality, userId, includeDispatchRuns, visit.token],
    EMPTY_SESSIONS,
    "Failed to load sessions",
    () =>
      source.listSessions({
        // The branch itself is `client`'s, written once there. This passes the
        // one entry it already knows about, which is all the helper reads.
        ...sessionQueryFor(address, [{ id: address, cardinality }]),
        ...(userId === undefined ? {} : { userId }),
        // Omitted unless asked for, so the request this hook has always sent
        // is the request it still sends by default.
        ...(includeDispatchRuns ? { include: "dispatch-runs" as const } : {})
      }),
    // A closed leaf asks for nothing, a refresh included. The visit token in
    // the identity is what starts a fresh read when it opens.
    { enabled: visit.token !== null }
  );
  return { sessions: data, isLoading, error, refresh };
}

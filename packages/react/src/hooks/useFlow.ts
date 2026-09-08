/**
 * Flow-level hook for session browsing, creation, and auto-creation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createClient,
  createSessionClient,
  type FlowListEntry,
  type SessionDetail,
  type SessionSummary
} from "@flow-state-dev/client";
import { useFlowContext } from "../context/FlowContext";

/**
 * Options for the useFlow hook.
 */
export type UseFlowOptions = {
  flowKind?: string;
  userId?: string;
  baseUrl?: string;
  autoCreateSession?: boolean;
  /**
   * When `true` (the default), the mount fetch selects the most-recent
   * session if none is active yet. Pass `false` when the consumer drives
   * selection itself (e.g. keying the active session off input metadata) so
   * the hook doesn't auto-load a session the consumer didn't ask for.
   */
  autoSelectSession?: boolean;
};

/**
 * Return type for the useFlow hook.
 */
export type UseFlowResult = {
  readonly flowKind?: string;
  readonly userId: string;
  readonly flows: FlowListEntry[];
  readonly sessions: SessionSummary[];
  readonly activeSessionId?: string;
  readonly isLoading: boolean;
  createSession: (
    metadata?: Record<string, unknown>
  ) => Promise<SessionDetail>;
  ensureSession: (
    metadata?: Record<string, unknown>
  ) => Promise<SessionDetail>;
  /** Set the active session, or pass `undefined` to clear it (no session
   *  shown). */
  selectSession: (sessionId: string | undefined) => void;
  /** Re-fetch the session list (e.g. after metadata changes). */
  refreshSessions: () => Promise<void>;
};

/**
 * The listing filter for the instance this hook addresses. A collection
 * member's sessions are filed under its exact id (`flowId`) — its rows record
 * the definition's kind, not the address, so a kind filter would find
 * nothing. A singleton keeps the kind filter: its id is its kind, and the
 * kind filter also finds sessions saved before owners were recorded, which
 * an exact owner filter never matches. Until the flow list has loaded the
 * address is read as a singleton, which is what every flow was.
 */
function sessionFilter(
  address: string,
  flows: readonly FlowListEntry[]
): { flowKind: string } | { flowId: string } {
  const entry = flows.find((flow) => flow.id === address);
  return entry?.cardinality === "collection" ? { flowId: address } : { flowKind: address };
}

/**
 * Reactive hook for listing flows/sessions and managing session lifecycle.
 */
export function useFlow(options: UseFlowOptions = {}): UseFlowResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const userId = options.userId ?? context.userId ?? "devuser";
  const baseUrl = options.baseUrl ?? context.baseUrl;

  const [flows, setFlows] = useState<FlowListEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<
    string | undefined
  >();
  const [isLoading, setIsLoading] = useState(false);

  const sessionClient = useMemo(
    () => createSessionClient({ baseUrl }),
    [baseUrl]
  );

  const client = useMemo(
    () =>
      createClient({
        flowKind: flowKind ?? "unknown-flow",
        userId,
        baseUrl
      }),
    [flowKind, userId, baseUrl]
  );

  const createSession = useCallback(
    async (
      metadata?: Record<string, unknown>
    ): Promise<SessionDetail> => {
      if (!flowKind?.trim()) {
        throw new Error("useFlow.createSession requires flowKind");
      }

      const created = await sessionClient.createSession({
        flowKind,
        userId,
        metadata
      });

      const updated = await sessionClient.listSessions({
        ...sessionFilter(flowKind, flows),
        userId
      });
      setSessions(updated);
      setActiveSessionId(created.id);

      return created;
    },
    [flowKind, flows, userId, sessionClient]
  );

  const ensureSession = useCallback(
    async (
      metadata?: Record<string, unknown>
    ): Promise<SessionDetail> => {
      if (sessions.length > 0) {
        const existing = sessions[0]!;
        setActiveSessionId(existing.id);
        return sessionClient.getSession(existing.id);
      }

      return createSession(metadata);
    },
    [sessions, sessionClient, createSession]
  );

  const selectSession = useCallback((sessionId: string | undefined) => {
    setActiveSessionId(sessionId);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!flowKind?.trim()) return;
    const updated = await sessionClient.listSessions({
      ...sessionFilter(flowKind, flows),
      userId
    });
    setSessions(updated);
  }, [flowKind, flows, userId, sessionClient]);

  // Fetch flows + sessions on mount, auto-create if requested and none exist.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        // Flows first: the session filter depends on what the address is.
        const nextFlows = await client.listFlows();
        const nextSessions: SessionSummary[] = flowKind?.trim()
          ? await sessionClient.listSessions({
              ...sessionFilter(flowKind, nextFlows),
              userId
            })
          : [];

        if (cancelled) return;

        setFlows(nextFlows);
        setSessions(nextSessions);

        if (nextSessions.length > 0) {
          if (options.autoSelectSession !== false) {
            setActiveSessionId((prev) => prev ?? nextSessions[0]!.id);
          }
        } else if (options.autoCreateSession && flowKind?.trim()) {
          const created = await sessionClient.createSession({
            flowKind,
            userId
          });
          if (cancelled) return;

          setActiveSessionId(created.id);

          const updated = await sessionClient.listSessions({
            ...sessionFilter(flowKind, nextFlows),
            userId
          });
          if (cancelled) return;

          setSessions(updated);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    client,
    sessionClient,
    flowKind,
    userId,
    options.autoCreateSession,
    options.autoSelectSession,
  ]);

  return {
    flowKind,
    userId,
    flows,
    sessions,
    activeSessionId,
    isLoading,
    createSession,
    ensureSession,
    selectSession,
    refreshSessions
  };
}

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
  selectSession: (sessionId: string) => void;
  /** Re-fetch the session list (e.g. after metadata changes). */
  refreshSessions: () => Promise<void>;
};

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
        flowKind,
        userId
      });
      setSessions(updated);
      setActiveSessionId(created.id);

      return created;
    },
    [flowKind, userId, sessionClient]
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

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!flowKind?.trim()) return;
    const updated = await sessionClient.listSessions({ flowKind, userId });
    setSessions(updated);
  }, [flowKind, userId, sessionClient]);

  // Fetch flows + sessions on mount, auto-create if requested and none exist.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        const [nextFlows, nextSessions] = await Promise.all([
          client.listFlows(),
          flowKind?.trim()
            ? sessionClient.listSessions({
                flowKind,
                userId
              })
            : Promise.resolve<SessionSummary[]>([])
        ]);

        if (cancelled) return;

        setFlows(nextFlows);
        setSessions(nextSessions);

        if (nextSessions.length > 0) {
          setActiveSessionId((prev) => prev ?? nextSessions[0]!.id);
        } else if (options.autoCreateSession && flowKind?.trim()) {
          const created = await sessionClient.createSession({
            flowKind,
            userId
          });
          if (cancelled) return;

          setActiveSessionId(created.id);

          const updated = await sessionClient.listSessions({
            flowKind,
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
  }, [client, sessionClient, flowKind, userId, options.autoCreateSession]);

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

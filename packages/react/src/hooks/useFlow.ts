/**
 * Flow-level hook for session browsing, creation, and auto-creation.
 */
import { useCallback, useEffect, useState } from "react";
import {
  sessionQueryFor,
  type FlowListEntry,
  type SessionDetail,
  type SessionSummary
} from "@flow-state-dev/client";
import { useFlowContext } from "../context/FlowContext";
import { useClient } from "../internal/useClient";

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
  /** True on the first paint and while the flow/session list is being read. */
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
 * Reactive hook for listing flows/sessions and managing session lifecycle.
 */
export function useFlow(options: UseFlowOptions = {}): UseFlowResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const fsd = useClient({ userId: options.userId, baseUrl: options.baseUrl });
  const userId = fsd.userId;

  const [flows, setFlows] = useState<FlowListEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<
    string | undefined
  >();
  const [isLoading, setIsLoading] = useState(true);

  const createSession = useCallback(
    async (
      metadata?: Record<string, unknown>
    ): Promise<SessionDetail> => {
      if (!flowKind?.trim()) {
        throw new Error("useFlow.createSession requires flowKind");
      }

      const created = await fsd.flow(flowKind).createSession({ metadata });

      const updated = await fsd.sessions.list({
        ...sessionQueryFor(flowKind, flows),
        userId
      });
      setSessions(updated);
      setActiveSessionId(created.id);

      return created;
    },
    [flowKind, flows, userId, fsd]
  );

  const ensureSession = useCallback(
    async (
      metadata?: Record<string, unknown>
    ): Promise<SessionDetail> => {
      if (sessions.length > 0) {
        const existing = sessions[0]!;
        setActiveSessionId(existing.id);
        return fsd.sessions.get(existing.id);
      }

      return createSession(metadata);
    },
    [sessions, fsd, createSession]
  );

  const selectSession = useCallback((sessionId: string | undefined) => {
    setActiveSessionId(sessionId);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!flowKind?.trim()) return;
    const updated = await fsd.sessions.list({
      ...sessionQueryFor(flowKind, flows),
      userId
    });
    setSessions(updated);
  }, [flowKind, flows, userId, fsd]);

  // Fetch flows + sessions on mount, auto-create if requested and none exist.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    void (async () => {
      try {
        // Flows first: the session filter depends on what the address is.
        const nextFlows = await fsd.flows();
        const nextSessions: SessionSummary[] = flowKind?.trim()
          ? await fsd.sessions.list({
              ...sessionQueryFor(flowKind, nextFlows),
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
          const created = await fsd.flow(flowKind).createSession();
          if (cancelled) return;

          setActiveSessionId(created.id);

          const updated = await fsd.sessions.list({
            ...sessionQueryFor(flowKind, nextFlows),
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
    fsd,
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

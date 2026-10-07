/**
 * Flow-level hook for session browsing, creation, and auto-creation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createClient,
  createSessionClient,
  sessionQueryFor,
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
  /**
   * The worker this hook's sessions run, on a flow whose sessions each run
   * one worker. Lists only that worker's sessions, and creates new ones with
   * it, so the server links each new session to it.
   */
  worker?: string;
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
 * Reactive hook for listing flows/sessions and managing session lifecycle.
 */
export function useFlow(options: UseFlowOptions = {}): UseFlowResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const userId = options.userId ?? context.userId ?? "devuser";
  const baseUrl = options.baseUrl ?? context.baseUrl;
  const apiPath = context.apiPath;
  const worker = options.worker;
  // Spread into every listing and create, so a hook with no worker sends
  // exactly what it always has.
  const workerFilter = useMemo(
    (): { worker?: string } => (worker === undefined ? {} : { worker }),
    [worker]
  );

  const [flows, setFlows] = useState<FlowListEntry[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<
    string | undefined
  >();
  const [isLoading, setIsLoading] = useState(false);

  const sessionClient = useMemo(
    () => createSessionClient({ baseUrl, apiPath }),
    [baseUrl, apiPath]
  );

  const client = useMemo(
    () =>
      createClient({
        flowKind: flowKind ?? "unknown-flow",
        userId,
        baseUrl,
        apiPath
      }),
    [flowKind, userId, baseUrl, apiPath]
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
        metadata,
        ...workerFilter
      });

      const updated = await sessionClient.listSessions({
        ...sessionQueryFor(flowKind, flows),
        userId,
        ...workerFilter
      });
      setSessions(updated);
      setActiveSessionId(created.id);

      return created;
    },
    [flowKind, flows, userId, sessionClient, workerFilter]
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
      ...sessionQueryFor(flowKind, flows),
      userId,
      ...workerFilter
    });
    setSessions(updated);
  }, [flowKind, flows, userId, sessionClient, workerFilter]);

  // Fetch flows + sessions on mount, auto-create if requested and none exist.
  // The worker the active session was chosen for. When the worker changes, the
  // old selection is another worker's session: clear it before the new
  // listing lands, so nothing sends to it in between, and let the listing
  // below pick from the new worker's sessions (or create one).
  const selectedForWorker = useRef(worker);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    if (selectedForWorker.current !== worker) {
      selectedForWorker.current = worker;
      setActiveSessionId(undefined);
    }

    void (async () => {
      try {
        // Flows first: the session filter depends on what the address is.
        const nextFlows = await client.listFlows();
        const nextSessions: SessionSummary[] = flowKind?.trim()
          ? await sessionClient.listSessions({
              ...sessionQueryFor(flowKind, nextFlows),
              userId,
              ...workerFilter
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
            userId,
            ...workerFilter
          });
          if (cancelled) return;

          setActiveSessionId(created.id);

          const updated = await sessionClient.listSessions({
            ...sessionQueryFor(flowKind, nextFlows),
            userId,
            ...workerFilter
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
    worker,
    workerFilter,
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

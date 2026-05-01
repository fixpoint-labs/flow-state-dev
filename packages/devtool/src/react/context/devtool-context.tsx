/**
 * DevTool context — owns the flow-API clients and the active flow/session
 * selection for the panel. The provider is parametrised so the same panel
 * works in two environments:
 *
 *  - The standalone `fsdev dev` shell, which reads/writes userId in
 *    localStorage and runs an interrupted-request sweep on mount.
 *  - Embedded hosts (e.g. kitchen-sink) where the host owns the userId,
 *    no localStorage write happens, and the recovery sweep is skipped by
 *    default to avoid surprising side effects.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Client, FlowListEntry, RecoveryClient, SessionClient } from "@flow-state-dev/client";
import {
  createDevToolClient,
  createDevToolRecoveryClient,
  createDevToolSessionClient,
  type DevToolConfig,
} from "../lib/client";
import { writeUserId } from "../config";

/** Whether the SettingsSheet exposes the userId editor. */
export type UserIdControl = "host" | "internal";

type DevToolState = {
  config: DevToolConfig;
  client: Client;
  sessionClient: SessionClient;
  recoveryClient: RecoveryClient;
  activeFlowKind: string | null;
  activeSessionId: string | null;
  flows: FlowListEntry[];
  flowsLoading: boolean;
  flowsError: string | null;
};

type Action =
  | { type: "SET_CONFIG"; config: DevToolConfig; baseUrl: string | undefined }
  | { type: "SET_ACTIVE_FLOW"; flowKind: string | null }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string | null }
  | { type: "SET_FLOWS"; flows: FlowListEntry[] }
  | { type: "SET_FLOWS_LOADING"; loading: boolean }
  | { type: "SET_FLOWS_ERROR"; error: string | null };

function buildClients(config: DevToolConfig, baseUrl: string | undefined) {
  return {
    client: createDevToolClient(config, baseUrl),
    sessionClient: createDevToolSessionClient(baseUrl),
    recoveryClient: createDevToolRecoveryClient(baseUrl),
  };
}

function reducer(state: DevToolState, action: Action): DevToolState {
  switch (action.type) {
    case "SET_CONFIG": {
      const clients = buildClients(action.config, action.baseUrl);
      return { ...state, config: action.config, ...clients };
    }
    case "SET_ACTIVE_FLOW":
      return { ...state, activeFlowKind: action.flowKind };
    case "SET_ACTIVE_SESSION":
      return { ...state, activeSessionId: action.sessionId };
    case "SET_FLOWS":
      return { ...state, flows: action.flows, flowsLoading: false, flowsError: null };
    case "SET_FLOWS_LOADING":
      return { ...state, flowsLoading: action.loading };
    case "SET_FLOWS_ERROR":
      return { ...state, flowsError: action.error, flowsLoading: false };
    default:
      return state;
  }
}

type DevToolContextValue = DevToolState & {
  baseUrl: string | undefined;
  userIdControl: UserIdControl;
  dispatch: React.Dispatch<Action>;
  refreshFlows: () => Promise<void>;
  setConfig: (config: DevToolConfig) => void;
  setActiveFlow: (flowKind: string | null) => void;
  setActiveSession: (sessionId: string | null) => void;
};

const DevToolContext = createContext<DevToolContextValue | null>(null);

function createInitialState(initialConfig: DevToolConfig, baseUrl: string | undefined): DevToolState {
  return {
    config: initialConfig,
    ...buildClients(initialConfig, baseUrl),
    activeFlowKind: null,
    activeSessionId: null,
    flows: [],
    flowsLoading: false,
    flowsError: null,
  };
}

export type DevToolProviderProps = {
  /** Initial DevTool config. Required — parent (panel or shell) constructs it. */
  initialConfig: DevToolConfig;
  /** Optional API base URL forwarded to all flow-API clients. */
  baseUrl?: string;
  /** When true, sweeps interrupted requests on mount. Default false (embedded-safe). */
  autoRecoverInterrupted?: boolean;
  /** When "host", SettingsSheet hides the userId field. Default "internal". */
  userIdControl?: UserIdControl;
  children: ReactNode;
};

export function DevToolProvider({
  initialConfig,
  baseUrl,
  autoRecoverInterrupted = false,
  userIdControl = "internal",
  children,
}: DevToolProviderProps) {
  const [state, dispatch] = useReducer(reducer, null, () =>
    createInitialState(initialConfig, baseUrl),
  );

  const refreshFlows = useCallback(async () => {
    dispatch({ type: "SET_FLOWS_LOADING", loading: true });
    dispatch({ type: "SET_FLOWS_ERROR", error: null });
    try {
      const flows = await state.client.listFlows();
      dispatch({ type: "SET_FLOWS", flows });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch flows";
      dispatch({ type: "SET_FLOWS_ERROR", error: message });
    }
  }, [state.client]);

  const setConfig = useCallback(
    (config: DevToolConfig) => {
      // Only the standalone shell persists userId to localStorage. When the
      // host owns the identity, treat `setConfig` as in-memory only so we
      // don't pollute the host app's storage.
      if (userIdControl === "internal") {
        writeUserId(config.userId);
      }
      dispatch({ type: "SET_CONFIG", config, baseUrl });
    },
    [userIdControl, baseUrl],
  );

  const setActiveFlow = useCallback((flowKind: string | null) => {
    dispatch({ type: "SET_ACTIVE_FLOW", flowKind });
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    dispatch({ type: "SET_ACTIVE_SESSION", sessionId });
  }, []);

  useEffect(() => {
    void refreshFlows();
  }, [refreshFlows]);

  // Sync external `initialConfig`/`baseUrl` changes into state. The reducer's
  // initializer only runs on mount, so without this the standalone shell's
  // focus-driven re-read of localStorage (or a host swapping the userId
  // prop) would be silently ignored. Skipped when nothing changed to avoid
  // rebuilding the clients on every render.
  useEffect(() => {
    if (state.config.userId === initialConfig.userId) return;
    dispatch({ type: "SET_CONFIG", config: initialConfig, baseUrl });
  }, [initialConfig, baseUrl, state.config.userId]);

  // Sweep interrupted requests for the current user once on devtool mount.
  // Off by default for embedded panels — the host app may not want a panel
  // mount to mutate request state. The standalone shell opts in.
  useEffect(() => {
    if (!autoRecoverInterrupted) return;
    const userId = state.config.userId;
    if (userId.trim().length === 0) return;
    void state.recoveryClient.checkInterrupted({ userId }).catch((err) => {
      console.warn("[devtool] checkInterrupted failed", err);
    });
  }, [autoRecoverInterrupted, state.recoveryClient, state.config.userId]);

  const value = useMemo(
    () => ({
      ...state,
      baseUrl,
      userIdControl,
      dispatch,
      refreshFlows,
      setConfig,
      setActiveFlow,
      setActiveSession,
    }),
    [state, baseUrl, userIdControl, dispatch, refreshFlows, setConfig, setActiveFlow, setActiveSession],
  );

  return <DevToolContext.Provider value={value}>{children}</DevToolContext.Provider>;
}

export function useDevTool(): DevToolContextValue {
  const ctx = useContext(DevToolContext);
  if (!ctx) {
    throw new Error("useDevTool must be used within DevToolProvider");
  }
  return ctx;
}

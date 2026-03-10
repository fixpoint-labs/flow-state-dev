import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Client, FlowListEntry, SessionClient } from "@flow-state-dev/client";
import { createDevToolClient, createDevToolSessionClient, type DevToolConfig } from "@/lib/client";
import { readUserId, writeUserId } from "@/config";

type DevToolState = {
  config: DevToolConfig;
  client: Client;
  sessionClient: SessionClient;
  activeFlowKind: string | null;
  activeSessionId: string | null;
  flows: FlowListEntry[];
  flowsLoading: boolean;
  flowsError: string | null;
};

type Action =
  | { type: "SET_CONFIG"; config: DevToolConfig }
  | { type: "SET_ACTIVE_FLOW"; flowKind: string | null }
  | { type: "SET_ACTIVE_SESSION"; sessionId: string | null }
  | { type: "SET_FLOWS"; flows: FlowListEntry[] }
  | { type: "SET_FLOWS_LOADING"; loading: boolean }
  | { type: "SET_FLOWS_ERROR"; error: string | null };

function buildClients(config: DevToolConfig) {
  return {
    client: createDevToolClient(config),
    sessionClient: createDevToolSessionClient(),
  };
}

function reducer(state: DevToolState, action: Action): DevToolState {
  switch (action.type) {
    case "SET_CONFIG": {
      const clients = buildClients(action.config);
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
  dispatch: React.Dispatch<Action>;
  refreshFlows: () => Promise<void>;
  setConfig: (config: DevToolConfig) => void;
  setActiveFlow: (flowKind: string | null) => void;
  setActiveSession: (sessionId: string | null) => void;
};

const DevToolContext = createContext<DevToolContextValue | null>(null);

function createInitialState(): DevToolState {
  const config: DevToolConfig = {
    userId: readUserId(),
  };
  const clients = buildClients(config);
  return {
    config,
    ...clients,
    activeFlowKind: null,
    activeSessionId: null,
    flows: [],
    flowsLoading: false,
    flowsError: null,
  };
}

export function DevToolProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null, createInitialState);

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

  const setConfig = useCallback((config: DevToolConfig) => {
    writeUserId(config.userId);
    dispatch({ type: "SET_CONFIG", config });
  }, []);

  const setActiveFlow = useCallback((flowKind: string | null) => {
    dispatch({ type: "SET_ACTIVE_FLOW", flowKind });
  }, []);

  const setActiveSession = useCallback((sessionId: string | null) => {
    dispatch({ type: "SET_ACTIVE_SESSION", sessionId });
  }, []);

  useEffect(() => {
    void refreshFlows();
  }, [refreshFlows]);

  const value = useMemo(
    () => ({ ...state, dispatch, refreshFlows, setConfig, setActiveFlow, setActiveSession }),
    [state, dispatch, refreshFlows, setConfig, setActiveFlow, setActiveSession],
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

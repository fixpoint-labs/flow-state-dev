/**
 * Flow-level session browser hook wrappers over client APIs.
 */
import {
  createActionClient,
  createSessionClient,
  type FlowListEntry,
  type SessionDetail,
  type SessionSummary
} from "@flow-state-dev/client";
import { getFlowContext } from "../context/FlowContext";

/**
 * Options for creating flow-agent wrappers.
 */
export type UseFlowAgentOptions = {
  flowKind?: string;
  userId?: string;
  baseUrl?: string;
};

/**
 * Session browser API surface returned from flow-agent wrappers.
 */
export type UseFlowAgentResult = {
  readonly flowKind?: string;
  readonly userId: string;
  readonly sessions: SessionSummary[];
  readonly flows: FlowListEntry[];
  refreshSessions: () => Promise<void>;
  refreshFlows: () => Promise<void>;
  createSession: (metadata?: Record<string, unknown>) => Promise<SessionDetail>;
};

/**
 * Returns flow and session listing helpers with local in-memory snapshots.
 */
export function useFlowAgent(options: UseFlowAgentOptions = {}): UseFlowAgentResult {
  const context = getFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const userId = options.userId ?? context.userId ?? "devuser";
  const baseUrl = options.baseUrl ?? context.baseUrl;

  const sessionClient = createSessionClient({
    baseUrl
  });
  const actionClient = createActionClient({
    flowKind: flowKind ?? "unknown-flow",
    userId,
    baseUrl
  });

  let sessions: SessionSummary[] = [];
  let flows: FlowListEntry[] = [];

  const refreshSessions = async (): Promise<void> => {
    sessions = await sessionClient.listSessions({
      flowKind,
      userId
    });
  };

  const refreshFlows = async (): Promise<void> => {
    flows = await actionClient.listFlows();
  };

  const createSession = async (
    metadata?: Record<string, unknown>
  ): Promise<SessionDetail> => {
    if (flowKind === undefined || flowKind.trim().length === 0) {
      throw new Error(
        "useFlowAgent.createSession requires flowKind (option or FlowContext)"
      );
    }

    const created = await sessionClient.createSession({
      flowKind,
      userId,
      metadata
    });
    await refreshSessions();
    return created;
  };

  return {
    flowKind,
    userId,
    get sessions() {
      return sessions;
    },
    get flows() {
      return flows;
    },
    refreshSessions,
    refreshFlows,
    createSession
  };
}

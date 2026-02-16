/**
 * Session-focused hook wrapper for action execution, state snapshots, and request streams.
 */
import {
  createActionClient,
  createSessionClient,
  type ExecuteActionResponse,
  type SessionDetail,
  type SessionStateSnapshotResponse
} from "@flow-state-dev/client";
import { getFlowContext } from "../context/FlowContext";
import {
  useRequestStream,
  type UseRequestStreamResult
} from "./useRequestStream";

/**
 * Options for creating session wrappers.
 */
export type UseSessionOptions = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  baseUrl?: string;
};

/**
 * Session wrapper API surface.
 */
export type UseSessionResult = {
  readonly flowKind: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly session: SessionDetail | null;
  readonly snapshot: SessionStateSnapshotResponse | null;
  refresh: () => Promise<void>;
  sendAction: (
    action: string,
    input: unknown
  ) => Promise<ExecuteActionResponse>;
  streamRequest: (requestId: string) => UseRequestStreamResult;
};

/**
 * Creates session-level helpers scoped to one flow/session/user tuple.
 */
export function useSession(options: UseSessionOptions): UseSessionResult {
  const context = getFlowContext();
  const flowKind = requireValue(options.flowKind ?? context.flowKind, "flowKind");
  const sessionId = requireValue(
    options.sessionId ?? context.sessionId,
    "sessionId"
  );
  const userId = requireValue(options.userId ?? context.userId, "userId");
  const baseUrl = options.baseUrl ?? context.baseUrl;

  const sessionClient = createSessionClient({
    baseUrl
  });
  const actionClient = createActionClient({
    flowKind,
    userId,
    baseUrl
  });

  let session: SessionDetail | null = null;
  let snapshot: SessionStateSnapshotResponse | null = null;

  const refresh = async (): Promise<void> => {
    const [nextSession, nextSnapshot] = await Promise.all([
      sessionClient.getSession(sessionId),
      sessionClient.getSessionState(sessionId)
    ]);
    session = nextSession;
    snapshot = nextSnapshot;
  };

  const sendAction = async (
    action: string,
    input: unknown
  ): Promise<ExecuteActionResponse> => {
    const response = await actionClient.sendAction(action, input, {
      sessionId
    });

    if (response.status === "completed") {
      await refresh();
    }

    return response;
  };

  const streamRequest = (requestId: string): UseRequestStreamResult =>
    useRequestStream({
      flowKind,
      requestId,
      baseUrl,
      onCompletedRefetch: async () => {
        await refresh();
        return snapshot ?? undefined;
      }
    });

  return {
    flowKind,
    sessionId,
    userId,
    get session() {
      return session;
    },
    get snapshot() {
      return snapshot;
    },
    refresh,
    sendAction,
    streamRequest
  };
}

function requireValue(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new Error(`useSession requires ${field} (option or FlowContext)`);
  }

  return normalized;
}

import { useCallback, useState } from "react";

export type ReplayMode = "full" | "cursor" | "reconnect" | null;

export type ReplayState = {
  mode: ReplayMode;
  requestId: string | null;
  startingAfter?: number;
  lastEventId?: string;
};

export type UseReplayResult = {
  replayState: ReplayState;
  isReplaying: boolean;
  replayFull: (requestId: string) => void;
  replayFromCursor: (requestId: string, afterSequence: number) => void;
  simulateReconnect: (requestId: string, lastEventId: string) => void;
  clearReplay: () => void;
};

export function useReplay(): UseReplayResult {
  const [replayState, setReplayState] = useState<ReplayState>({
    mode: null,
    requestId: null,
  });

  const replayFull = useCallback((requestId: string) => {
    setReplayState({ mode: "full", requestId });
  }, []);

  const replayFromCursor = useCallback((requestId: string, afterSequence: number) => {
    setReplayState({ mode: "cursor", requestId, startingAfter: afterSequence });
  }, []);

  const simulateReconnect = useCallback((requestId: string, lastEventId: string) => {
    setReplayState({ mode: "reconnect", requestId, lastEventId });
  }, []);

  const clearReplay = useCallback(() => {
    setReplayState({ mode: null, requestId: null });
  }, []);

  return {
    replayState,
    isReplaying: replayState.mode !== null,
    replayFull,
    replayFromCursor,
    simulateReconnect,
    clearReplay,
  };
}

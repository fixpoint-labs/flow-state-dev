import { useCallback, useEffect, useState } from "react";
import { readActiveSession, writeActiveSession } from "@/config";

export function useActiveSession(flowKind: string | null) {
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(() =>
    flowKind ? readActiveSession(flowKind) : null,
  );

  useEffect(() => {
    if (flowKind) {
      setActiveSessionIdState(readActiveSession(flowKind));
    } else {
      setActiveSessionIdState(null);
    }
  }, [flowKind]);

  const setActiveSessionId = useCallback(
    (sessionId: string | null) => {
      setActiveSessionIdState(sessionId);
      if (flowKind) {
        writeActiveSession(flowKind, sessionId);
      }
    },
    [flowKind],
  );

  return { activeSessionId, setActiveSessionId };
}

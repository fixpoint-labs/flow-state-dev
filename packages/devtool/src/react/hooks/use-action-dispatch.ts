import { useCallback, useState } from "react";
import type { ExecuteActionResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { dispatchDevToolAction } from "../lib/client";

export type UseActionDispatchResult = {
  sendAction: (flowKind: string, sessionId: string, action: string, input: unknown) => Promise<ExecuteActionResponse | null>;
  isSending: boolean;
  error: string | null;
  lastResponse: ExecuteActionResponse | null;
};

export function useActionDispatch(): UseActionDispatchResult {
  const { config, baseUrl } = useDevTool();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<ExecuteActionResponse | null>(null);

  const sendAction = useCallback(
    async (flowKind: string, sessionId: string, action: string, input: unknown): Promise<ExecuteActionResponse | null> => {
      setIsSending(true);
      setError(null);
      try {
        const result = await dispatchDevToolAction(flowKind, sessionId, action, input, {
          userId: config.userId,
          baseUrl,
        });
        setLastResponse(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send action";
        setError(message);
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [config, baseUrl],
  );

  return { sendAction, isSending, error, lastResponse };
}

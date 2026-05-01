import { useCallback, useState } from "react";
import type { ExecuteActionResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

export type UseActionDispatchResult = {
  sendAction: (flowKind: string, sessionId: string, action: string, input: unknown) => Promise<ExecuteActionResponse | null>;
  isSending: boolean;
  error: string | null;
  lastResponse: ExecuteActionResponse | null;
};

export function useActionDispatch(): UseActionDispatchResult {
  const { config } = useDevTool();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<ExecuteActionResponse | null>(null);

  const sendAction = useCallback(
    async (flowKind: string, sessionId: string, action: string, input: unknown): Promise<ExecuteActionResponse | null> => {
      setIsSending(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/flows/${encodeURIComponent(flowKind)}/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(action)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input, userId: config.userId }),
          },
        );
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Action failed (${response.status}): ${body}`);
        }
        const result = (await response.json()) as ExecuteActionResponse;
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
    [config],
  );

  return { sendAction, isSending, error, lastResponse };
}

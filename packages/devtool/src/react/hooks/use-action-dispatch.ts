import { useCallback, useState } from "react";
import type { ExecuteActionResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";
import { dispatchDevToolAction } from "../lib/client";

export type UseActionDispatchResult = {
  /**
   * Dispatch against an exact flow instance id — never a kind. A dispatch that
   * throws resolves to `{ error }` with its message, so a caller that shows the
   * result in place (a Tasks-tab row) can say why.
   */
  sendAction: (
    flowId: string,
    sessionId: string,
    action: string,
    input: unknown
  ) => Promise<ExecuteActionResponse | { error: string }>;
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
    async (
      flowId: string,
      sessionId: string,
      action: string,
      input: unknown
    ): Promise<ExecuteActionResponse | { error: string }> => {
      setIsSending(true);
      setError(null);
      try {
        const result = await dispatchDevToolAction(flowId, sessionId, action, input, {
          userId: config.userId,
          baseUrl,
          bearerToken: config.bearerToken,
        });
        setLastResponse(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to send action";
        setError(message);
        return { error: message };
      } finally {
        setIsSending(false);
      }
    },
    [config, baseUrl],
  );

  return { sendAction, isSending, error, lastResponse };
}

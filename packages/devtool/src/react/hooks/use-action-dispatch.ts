import { useCallback, useState } from "react";
import type { ExecuteActionResponse } from "@flow-state-dev/client";
import { useDevTool } from "../context/devtool-context";

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
  const { client } = useDevTool();
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
        // Dispatched against the exact instance, as the DevTool's user.
        const sent = await client.flow(flowId).send(action, input, { sessionId });
        const result = sent.response;
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
    [client],
  );

  return { sendAction, isSending, error, lastResponse };
}

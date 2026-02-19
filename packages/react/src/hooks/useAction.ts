/**
 * Low-level action execution hook with loading/error state tracking.
 */
import { useCallback, useMemo, useState } from "react";
import {
  createClient,
  type ExecuteActionResponse
} from "@flow-state-dev/client";
import { useFlowContext } from "../context/FlowContext";

/**
 * Options for useAction.
 */
export type UseActionOptions = {
  flowKind?: string;
  action: string;
  userId?: string;
  baseUrl?: string;
};

/**
 * Return type for useAction.
 */
export type UseActionResult = {
  execute: (
    input: unknown,
    sessionId?: string
  ) => Promise<ExecuteActionResponse>;
  readonly loading: boolean;
  readonly error?: Error;
};

/**
 * Low-level escape-hatch hook for executing a single named action.
 */
export function useAction(options: UseActionOptions): UseActionResult {
  const context = useFlowContext();
  const flowKind = options.flowKind ?? context.flowKind;
  const userId = options.userId ?? context.userId;
  const baseUrl = options.baseUrl ?? context.baseUrl;

  if (!flowKind?.trim()) {
    throw new Error("useAction requires flowKind (option or FlowProvider)");
  }

  if (!userId?.trim()) {
    throw new Error("useAction requires userId (option or FlowProvider)");
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const client = useMemo(
    () => createClient({ flowKind: flowKind!, userId: userId!, baseUrl }),
    [flowKind, userId, baseUrl]
  );

  const execute = useCallback(
    async (
      input: unknown,
      sessionId?: string
    ): Promise<ExecuteActionResponse> => {
      setLoading(true);
      setError(undefined);

      try {
        return await client.sendAction(options.action, input, {
          sessionId
        });
      } catch (cause) {
        const normalized =
          cause instanceof Error ? cause : new Error(String(cause));
        setError(normalized);
        throw normalized;
      } finally {
        setLoading(false);
      }
    },
    [client, options.action]
  );

  return { execute, loading, error };
}
